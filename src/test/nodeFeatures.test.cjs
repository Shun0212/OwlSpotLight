const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SearchEngine } = require('../../out/nodeSearch/engine');
const { collectHunks, collectChangedSymbols } = require('../../out/nodeSearch/git');
const { MODEL_PROFILES } = require('../../out/nodeSearch/models');
const { writeMcpRuntime } = require('../../out/codexSetup');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owl-features-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init');
    return { root, git };
}
function options(root) {
    const p = MODEL_PROFILES[1];
    return { cacheDir: path.join(root, 'cache'), modelName: p.id, revision: p.revision, dtype: 'q8', batchSize: 2, localFilesOnly: true };
}

test('Git history includes the initial commit and custom changed-functions use the selected snapshot', async t => {
    const { root, git } = await fixture(t);
    const file = '日本語 file.py';
    await fs.writeFile(path.join(root, file), 'def first():\n    return 1\n\ndef second():\n    return 2\n');
    git('add', '.'); git('commit', '-m', 'Initial'); const base = git('rev-parse', 'HEAD');
    await fs.writeFile(path.join(root, file), 'def first():\n    return 44\n\ndef second():\n    return 2\n');
    git('add', '.'); git('commit', '-m', 'Change first'); const head = git('rev-parse', 'HEAD');
    await fs.writeFile(path.join(root, file), 'def worktree_only():\n    return 999\n');
    const request = { directory: root, query: '44', file_ext: '.py', diff_range_mode: 'custom', diff_base_ref: base, diff_head_ref: head };
    const functions = await collectChangedSymbols(request);
    assert.deepEqual(functions.map(s => s.name), ['first']);
    assert.equal(functions[0].code, 'def first():\n    return 44');
    assert.equal(functions[0].snapshot_ref, head);
    const branch = await collectHunks({ ...request, diff_range_mode: 'branch' });
    assert.ok(branch.some(h => h.commit_hash === base));
    assert.ok(branch.some(h => h.commit_hash === head));
    const engine = new SearchEngine(options(root), () => {});
    const data = await engine.search({ ...request, scope: 'changed', search_target: 'diff_hunks', search_mode: 'keyword' });
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].commit_hash, head);
    assert.match(data.results[0].code, /\+    return 44/);
});

test('working-tree diff handles unborn repositories, ignores files and skips symlinks', async t => {
    const { root } = await fixture(t);
    await fs.writeFile(path.join(root, 'new.py'), 'def fresh():\n    return 123\n');
    await fs.writeFile(path.join(root, 'skip.py'), 'def excluded(): pass');
    await fs.writeFile(path.join(root, '.owlignore'), 'skip.py\n');
    await fs.symlink(path.join(root, 'new.py'), path.join(root, 'linked.py'));
    const request = { directory: root, query: 'fresh', file_ext: '.py', diff_range_mode: 'working_tree' };
    assert.deepEqual((await collectHunks(request)).map(h => h.path), ['new.py']);
    assert.deepEqual((await collectChangedSymbols(request)).map(s => s.name), ['fresh']);
    assert.deepEqual(await collectHunks({ ...request, include_files: [] }), []);
});

test('local graph resolves unambiguous calls and class statistics without an embedding model', async t => {
    const { root } = await fixture(t);
    const file = path.join(root, 'auth.py');
    await fs.writeFile(file, 'def normalize(value):\n    return value.strip()\n\nclass Auth:\n    def verify(self, value):\n        return normalize(value)\n\ndef login(value):\n    return normalize(value)\n');
    const engine = new SearchEngine(options(root), () => {});
    const graph = await engine.graph({ directory: root, query: '', file, line: 5, file_ext: '.py', similar: false });
    assert.equal(graph.nodes.find(n => n.id === graph.center).name, 'verify');
    assert.ok(graph.edges.some(e => e.source === graph.center && graph.nodes.find(n => n.id === e.target)?.name === 'normalize'));
    assert.equal(graph.edges[0].evidence, 'static');
    const stats = await engine.stats({ directory: root, query: '', file_ext: '.py' });
    assert.equal(stats.classes[0].name, 'Auth');
    assert.equal(stats.classes[0].method_count, 1);
    assert.equal(stats.standalone_functions.length, 2);
});

test('Node MCP launcher supports search/read with an invalid Python path and no HTTP server', async t => {
    const { root } = await fixture(t);
    await fs.writeFile(path.join(root, 'auth.py'), 'def verify_password(password):\n    return password == "fixture"\n');
    const launcher = writeMcpRuntime(root, root, '/no/python', path.resolve(__dirname, '../../out/nodeSearch/mcp.js'), 'http://127.0.0.1:1', 'en', options(root));
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [launcher], stderr: 'pipe' });
    t.after(() => client.close());
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['owlspotlight.search_code', 'owlspotlight.read_code']);
    const response = await client.callTool({ name: 'owlspotlight.search_code', arguments: { query: 'verify_password', search_mode: 'keyword' } });
    assert.equal(response.isError, undefined);
    const result = JSON.parse(response.content[0].text);
    assert.equal(result.results[0].function_name, 'verify_password');
    const read = await client.callTool({ name: 'owlspotlight.read_code', arguments: { file_path: 'auth.py' } });
    assert.match(JSON.parse(read.content[0].text).lines[0], /def verify_password/);
    const outside = await client.callTool({ name: 'owlspotlight.read_code', arguments: { file_path: '../outside.py' } });
    assert.equal(outside.isError, true);
});
