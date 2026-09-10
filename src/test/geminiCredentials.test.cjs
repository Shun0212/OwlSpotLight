const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture(fail = false) {
    let legacy = 'synthetic-legacy-key';
    const secrets = new Map();
    const vscode = { ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }, workspace: {
        workspaceFolders: [], getConfiguration: () => ({ get: () => legacy || '', inspect: () => ({ globalValue: legacy }),
            update: async (name, value) => { legacy = value; } })
    } };
    const context = { exports: {}, require: name => name === 'vscode' ? vscode : require(name) };
    vm.runInNewContext(fs.readFileSync(require.resolve('../../out/geminiCredentials'), 'utf8'), context);
    const store = new context.exports.GeminiCredentials({ get: async key => secrets.get(key), delete: async key => secrets.delete(key), store: async (key, value) => {
        if (fail) { throw new Error('Secret storage unavailable'); }
        secrets.set(key, value);
    } });
    return { store, secrets, legacy: () => legacy };
}
test('legacy key migrates before plaintext removal and concurrent reads are serialized', async () => {
    const f = fixture();
    assert.deepEqual(await Promise.all([f.store.get(), f.store.get()]), ['synthetic-legacy-key', 'synthetic-legacy-key']);
    assert.equal(f.legacy(), undefined);
    await f.store.set('synthetic-new-key');
    assert.equal(await f.store.get(), 'synthetic-new-key');
    assert.equal(f.legacy(), undefined);
});
test('failed secret storage preserves the existing key', async () => {
    const f = fixture(true);
    await assert.rejects(f.store.get(), /unavailable/);
    assert.equal(f.legacy(), 'synthetic-legacy-key');
});

test('migration preserves project precedence without reusing another project key', async () => {
    const secrets = new Map();
    const configuration = { globalValue: 'global-key', workspaceValue: 'project-one-key' };
    let root = '/workspace/one';
    const vscode = { ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }, workspace: {
        get workspaceFolders() { return [{ uri: { toString: () => root } }]; },
        getConfiguration: () => ({ inspect: () => ({ ...configuration }), update: async (name, value, target) => {
            delete configuration[{ 1: 'globalValue', 2: 'workspaceValue', 3: 'workspaceFolderValue' }[target]];
        } })
    } };
    const context = { exports: {}, require: name => name === 'vscode' ? vscode : require(name) };
    vm.runInNewContext(fs.readFileSync(require.resolve('../../out/geminiCredentials'), 'utf8'), context);
    const store = new context.exports.GeminiCredentials({ get: async key => secrets.get(key),
        store: async (key, value) => secrets.set(key, value), delete: async key => secrets.delete(key) });
    assert.equal(await store.get(), 'project-one-key');
    assert.deepEqual(configuration, {});
    root = '/workspace/two';
    assert.equal(await store.get(), 'global-key');
    root = '/workspace/one';
    assert.equal(await store.get(), 'project-one-key');
});
