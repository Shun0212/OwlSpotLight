// Real CPU inference through the same worker used by the extension.
// OWL_ONNX_SMOKE_CACHE can preserve downloads between runs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { NodeSearchClient } = require('../out/nodeSearch/client');
const { MODEL_PROFILES } = require('../out/nodeSearch/models');
(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owl-onnx-smoke-'));
    const cacheDir = process.env.OWL_ONNX_SMOKE_CACHE || path.join(os.tmpdir(), 'owlspotlight-onnx-smoke-cache');
    const profile = MODEL_PROFILES.find(p => p.id === process.env.OWL_ONNX_SMOKE_MODEL) || MODEL_PROFILES[1];
    const client = new NodeSearchClient({ cacheDir, modelName: profile.id, revision: profile.revision, dtype: process.env.OWL_ONNX_SMOKE_DTYPE || 'q8', batchSize: 2, localFilesOnly: process.env.OWL_ONNX_SMOKE_OFFLINE === '1' });
    try {
        await fs.writeFile(path.join(root, 'auth.py'), 'import bcrypt\ndef verify_password(plaintext, hashed_password):\n    return bcrypt.checkpw(plaintext.encode(), hashed_password)\n');
        await fs.writeFile(path.join(root, 'sort.py'), 'def sort_numbers(numbers):\n    return sorted(numbers)\n');
        await fs.writeFile(path.join(root, 'storage.py'), 'import json\ndef save_json(data, filename):\n    with open(filename, "w") as output:\n        json.dump(data, output)\n');
        const queries = [['validate a user password against its stored hash', 'auth.py'], ['sort a list of numbers in ascending order', 'sort.py'], ['save data to a JSON file on disk', 'storage.py']];
        for (const [query, expected] of queries) {
            const start = Date.now();
            const data = await client.search({ directory: root, query, file_ext: '.py' }, p => {
                if (p.phase.startsWith('Downloading')) process.stderr.write(`${p.phase}: ${p.current}%\n`);
            });
            console.log(JSON.stringify({ model: profile.label, query, ms: Date.now() - start, results: data.results.map(r => ({ file: path.basename(r.file_path), function: r.function_name, lines: [r.lineno, r.end_lineno], similarity: r.similarity })) }));
            assert.equal(path.basename(data.results[0].file_path), expected);
            assert.ok(data.results.every(r => r.symbol_kind === 'function' && r.function_name && r.end_lineno >= r.lineno));
            assert.equal(data.results.find(r => path.basename(r.file_path) === 'auth.py').function_name, 'verify_password');
        }
        const graph = await client.request('graph', { directory: root, query: queries[0][0], file: path.join(root, 'auth.py'), line: 2, file_ext: '.py', similar: true }, () => {});
        assert.equal(graph.nodes.find(n => n.id === graph.center).name, 'verify_password');
        assert.ok(graph.edges.some(edge => edge.kind === 'similar' && Number.isFinite(edge.score)));
        assert.ok(graph.nodes.some(node => Number.isFinite(node.queryScore)));
        assert.deepEqual((await client.search({ directory: root, query: 'quantum_unicorn_9483', search_mode: 'keyword' }, () => {})).results, []);
        console.log('ONNX worker smoke passed (semantic top-1: 3/3; literal no-match: 0 results).');
    } finally { await client.dispose(); await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
