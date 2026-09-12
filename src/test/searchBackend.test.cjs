const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function fixture(initial = 'ask', choice = 'node-onnx', workspaceOverride = false) {
    let backend = initial;
    const calls = [], notices = [];
    const config = { get: (_key, fallback) => backend ?? fallback, inspect: () => ({ workspaceValue: workspaceOverride ? backend : undefined }),
        update: async (key, value, target) => { calls.push({ key, value, target }); backend = value; } };
    const vscode = { ConfigurationTarget: { Global: 1, Workspace: 2 }, workspace: { getConfiguration: () => config },
        window: { showQuickPick: async options => { calls.push('choose'); return options.find(option => option.backend === choice); },
            showWarningMessage: message => notices.push(message) },
        commands: { executeCommand: async (...args) => calls.push(args) } };
    const exports = {};
    const context = vm.createContext({ exports, require: name => { assert.equal(name, 'vscode'); return vscode; } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../out/searchBackend.js'), 'utf8'), context);
    return { api: exports, calls, notices, backend: () => backend };
}

test('first setup chooses Node without Python work; persisted choices do not prompt again', async () => {
    const f = fixture();
    assert.equal(await f.api.chooseSearchBackend(), 'node-onnx');
    assert.equal(await f.api.chooseSearchBackend(), 'node-onnx');
    assert.equal(f.calls.filter(x => x === 'choose').length, 1);
    assert.equal(f.backend(), 'node-onnx');
    assert.equal(f.calls.some(Array.isArray), false);
});
test('Python choice persists and cancellation leaves the first-setup choice pending', async () => {
    const full = fixture('ask', 'python');
    assert.equal(await full.api.chooseSearchBackend(), 'python');
    // Explicit unmatched choice models dismissal, without default parameter substitution.
    const cancelled = fixture('ask', 'cancelled');
    assert.equal(await cancelled.api.chooseSearchBackend(), undefined);
    assert.equal(cancelled.backend(), 'ask');
    assert.equal(cancelled.notices.length, 0);
});
test('setup failure stops only the owned server and switches a workspace override once', async () => {
    const f = fixture('python', 'python', true);
    await Promise.all([f.api.fallbackToSimpleMode('uv missing'), f.api.fallbackToSimpleMode('duplicate failure')]);
    assert.equal(f.backend(), 'node-onnx');
    assert.equal(f.notices.length, 1);
    assert.equal(f.calls[0][0], 'owlspotlight.stopServer');
    assert.equal(f.calls[0][1].ownedOnly, true);
    assert.equal(f.calls[1].target, 2);
    assert.equal(f.calls.includes('choose'), false);
});

test('actual Python setup command falls back when uv is missing, before asking about torch', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../extension.ts'), 'utf8');
    const start = source.indexOf('const setupEnvDisposable =');
    const end = source.indexOf('context.subscriptions.push(setupEnvDisposable)', start);
    let command;
    const fallbacks = [];
    const context = vm.createContext({
        vscode: { commands: { registerCommand: (_name, handler) => { command = handler; } },
            workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) }, window: { showErrorMessage() {} } },
        chooseSearchBackend: async () => 'python', searchBackend: () => 'python', isSimpleMode: () => false, isSetupRunning: false,
        context: { extensionPath: '/fixture' }, path, os: { platform: () => 'darwin' }, resolveUvExecutable: () => undefined,
        owlOutputChannel: {}, fallbackToSimpleMode: async reason => fallbacks.push(reason),
    });
    vm.runInContext(ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 }), context);
    assert.equal(await command(), false);
    assert.deepEqual(fallbacks, ['uv was not found.']);
});

test('a failed Python installer process switches to Node; dismissing the torch picker does not', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../extension.ts'), 'utf8');
    const start = source.indexOf('const setupEnvDisposable =');
    const end = source.indexOf('context.subscriptions.push(setupEnvDisposable)', start);
    for (const cancelled of [false, true]) {
        let command;
        const failures = [];
        let launched = false;
        const context = vm.createContext({
            vscode: { commands: { registerCommand: (_name, handler) => { command = handler; } },
                workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
                window: { showQuickPick: async () => cancelled ? undefined : ({ value: 'cpu', label: 'CPU' }), showInformationMessage() {}, showErrorMessage() {} } },
            chooseSearchBackend: async () => 'python', searchBackend: () => 'python', isSimpleMode: () => false,
            isSetupRunning: false, setupProcess: undefined, context: { extensionPath: '/fixture' }, path,
            os: { platform: () => 'darwin' }, resolveUvExecutable: () => '/fixture/uv',
            getTorchInstallOptions: () => ({ options: [], gpuInfo: { available: false }, autoReason: 'CPU' }),
            owlOutputChannel: { show() {}, appendLine() {}, append() {} }, process: { env: {} },
            withUtf8PythonEnvironment: () => ({}), fallbackToSimpleMode: async reason => failures.push(reason),
            cp: { spawn: () => { launched = true; const child = new (require('node:events').EventEmitter)(); queueMicrotask(() => child.emit('close', 1)); return child; } },
        });
        vm.runInContext(ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 }), context);
        const result = await command({ startServerAfterSetup: false });
        assert.equal(result, cancelled ? undefined : false);
        assert.equal(launched, !cancelled);
        assert.equal(failures.length, cancelled ? 0 : 1);
    }
});

test('setup readiness falls back on timeout, but not on a successful start or dismissed setup', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../extension.ts'), 'utf8');
    const start = source.indexOf('    private async setupAndStartServer(');
    const end = source.indexOf('       async resolveWebviewView(', start);
    const method = source.slice(start, end).replace('private async', 'async');
    for (const scenario of ['ready', 'timeout', 'cancelled']) {
        let simple = false;
        const failures = [];
        const messages = [];
        const context = vm.createContext({
            chooseSearchBackend: async () => 'python', isSimpleMode: () => simple,
            simpleMode: { settings: () => ({ type: 'backendSettings', backend: 'node-onnx' }) },
            path, os: { platform: () => 'darwin' }, fs: { existsSync: () => scenario !== 'cancelled' },
            vscode: { commands: { executeCommand: async () => undefined } },
            resolveActiveServerPort: async () => scenario === 'ready' ? 8000 : undefined,
            setTimeout: callback => callback(), fallbackToSimpleMode: async reason => { failures.push(reason); simple = true; },
        });
        vm.runInContext(ts.transpile(`class Provider { ${method} }; globalThis.Provider = Provider;`, { target: ts.ScriptTarget.ES2022 }), context);
        const provider = new context.Provider();
        provider._context = { extensionPath: '/fixture' }; provider.notifyServerStatus = () => {};
        const result = await provider.setupAndStartServer({ webview: { postMessage: message => messages.push(message) } });
        assert.equal(result, scenario !== 'cancelled');
        assert.equal(failures.length, scenario === 'timeout' ? 1 : 0);
        assert.equal(simple, scenario === 'timeout');
    }
});
