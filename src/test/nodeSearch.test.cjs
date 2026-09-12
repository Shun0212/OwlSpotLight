const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { collectSymbols, SearchEngine } = require('../../out/nodeSearch/engine');
const { tokenizeBatch, normalize, EmbeddingCache } = require('../../out/nodeSearch/embedding');
const { NodeSearchClient } = require('../../out/nodeSearch/client');
const { MODEL_PROFILES } = require('../../out/nodeSearch/models');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owl-node-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, 'auth.py'), 'def verify_password(password, digest):\n    return bcrypt.checkpw(password, digest)\n');
    await fs.writeFile(path.join(root, 'sort.py'), 'def sort_numbers(values):\n    return sorted(values)\n');
    return root;
}
const options = cacheDir => ({ cacheDir, modelName: MODEL_PROFILES[1].id, revision: MODEL_PROFILES[1].revision, dtype: 'q8', batchSize: 2, localFilesOnly: true });

test('long token batches preserve CLS/SEP, pad and mask correctly', () => {
    const tokenizer = { pad_token_id: 0, encode: (text, options) => options ? new Array(Number(text)).fill(7) : [101, 102] };
    const batch = tokenizeBatch(tokenizer, ['2000', '1']);
    assert.deepEqual(batch.dims, [2, 1024]);
    assert.equal(batch.ids[0], 101n); assert.equal(batch.ids[1023], 102n);
    assert.equal(batch.ids[1026], 102n); assert.equal(batch.ids[1027], 0n);
    assert.equal(batch.mask[1026], 1n); assert.equal(batch.mask[1027], 0n);
});

test('ignore rules, nested rules, file scope, symlinks and deletions are honored', async t => {
    const root = await fixture(t);
    await fs.mkdir(path.join(root, 'nested'));
    await fs.writeFile(path.join(root, '.owlignore'), 'sort.py\n');
    await fs.writeFile(path.join(root, 'nested', '.gitignore'), '*.py\n!keep.py\n');
    await fs.writeFile(path.join(root, 'nested', 'skip.py'), 'def skip(): pass');
    await fs.writeFile(path.join(root, 'nested', 'keep.py'), 'def keep(): pass');
    await fs.symlink(path.join(root, 'auth.py'), path.join(root, 'linked.py'));
    const request = { directory: root, query: 'verify', file_ext: '.py' };
    assert.deepEqual((await collectSymbols(request)).map(x => path.basename(x.file_path)), ['auth.py', 'keep.py']);
    assert.deepEqual(await collectSymbols({ ...request, include_files: [] }), []);
    assert.equal((await collectSymbols({ ...request, include_files: ['auth.py'] })).length, 1);
    await fs.unlink(path.join(root, 'auth.py'));
    assert.equal((await collectSymbols(request)).length, 1);
});

test('semantic cache reuses unchanged blocks, invalidates edits, and separates models', async t => {
    const root = await fixture(t);
    let encoded = [];
    const embedder = { namespace: 'fixture-model', dimensions: 2, encode: async texts => {
        encoded.push(...texts); return texts.map(text => normalize(Float32Array.from(/password|bcrypt/.test(text) ? [1, 0] : [0, 1])));
    } };
    const cache = path.join(root, 'cache');
    const engine = new SearchEngine(options(cache), () => {}, embedder);
    const request = { directory: root, query: 'password verification', file_ext: '.py' };
    assert.match((await engine.search(request)).results[0].file_path, /auth.py$/);
    assert.equal(encoded.length, 3);
    encoded = [];
    await engine.search(request); assert.deepEqual(encoded, [request.query]);
    encoded = [];
    await fs.writeFile(path.join(root, 'auth.py'), 'def password_changed(): pass');
    await engine.search(request); assert.equal(encoded.length, 2);
    assert.notEqual(new EmbeddingCache(cache, 'model1', 2).directory, new EmbeddingCache(cache, 'model2', 2).directory);
    const cache2 = new EmbeddingCache(cache, 'broken', 2);
    await fs.mkdir(cache2.directory, { recursive: true });
    await fs.writeFile(path.join(cache2.directory, 'invalid.f32'), Buffer.alloc(8));
    assert.equal(await cache2.get('invalid'), undefined);
});

test('BM25 and literal searches work without loading ONNX, including no matches', async t => {
    const root = await fixture(t);
    const engine = new SearchEngine(options(path.join(root, 'cache')), () => {}, {
        namespace: 'no-model', dimensions: 2, encode: async () => { throw new Error('Must not load ONNX'); }
    });
    const request = { directory: root, query: 'password', search_mode: 'bm25' };
    assert.match((await engine.search(request)).results[0].file_path, /auth.py$/);
    assert.deepEqual((await engine.search({ ...request, query: 'nonexistent_thing_9328' })).results, []);
    assert.equal((await engine.search({ ...request, search_mode: 'keyword', query: 'bcrypt.checkpw' })).results.length, 1);
    assert.deepEqual((await engine.search({ ...request, search_mode: 'keyword', query: 'no exact match' })).results, []);
});

test('worker cancellation settles, restarts, rejects concurrency and reports missing model', async t => {
    const root = await fixture(t);
    const client = new NodeSearchClient(options(path.join(root, 'cache')));
    t.after(() => client.dispose());
    const controller = new AbortController();
    const request = { directory: root, query: 'password', search_mode: 'bm25' };
    const search = client.search(request, () => {}, controller.signal);
    await assert.rejects(client.search(request, () => {}), /already running/);
    controller.abort();
    await assert.rejects(search, /exited|stopped/);
    assert.equal((await client.search(request, () => {})).results.length, 1);
    await assert.rejects(client.search({ ...request, search_mode: 'semantic' }, () => {}), /missing or corrupt/);
    assert.equal((await client.search(request, () => {})).results.length, 1);
});


test('mixed-language searches can switch between all languages and one extension', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, 'client.js'), 'function verifyToken(token) { return token.valid; }');
    await fs.writeFile(path.join(root, 'client.ts'), 'function verifySession(token: string) { return token; }');
    await fs.writeFile(path.join(root, 'notes.txt'), 'function ignored() {}');
    const request = { directory: root, query: 'verify', file_ext: 'auto' };
    const extensions = async req => new Set((await collectSymbols(req)).map(x => path.extname(x.file_path)));
    assert.deepEqual(await extensions(request), new Set(['.py', '.js', '.ts']));
    assert.deepEqual(await extensions({ ...request, file_ext: '.js' }), new Set(['.js']));
    assert.deepEqual(await extensions(request), new Set(['.py', '.js', '.ts']));
    await fs.unlink(path.join(root, 'client.js'));
    assert.deepEqual(await extensions(request), new Set(['.py', '.ts']));
});
