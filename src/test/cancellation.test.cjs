const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../extension.ts'), 'utf8');

test('shared Stop aborts the planner and targets only the sidebar HTTP operation', async () => {
    const start = source.indexOf('    public async cancelOperation()');
    const end = source.indexOf('\n\tpublic notifyServerStatus', start);
    const method = source.slice(start, end).replace('public async', 'async');
    const calls = [];
    const context = vm.createContext({ AbortController, AbortSignal, isSimpleMode: () => false, resolveActiveServerPort: async () => 8000,
        getServerUrl: (route, port) => `${port}${route}`, fetch: async (url, options) => {
            calls.push({ url, options }); return { ok: true, json: async () => ({ operation_id: 'observed-external' }) };
        } });
    vm.runInContext(ts.transpile(`class Provider { ${method} }; globalThis.Provider = Provider;`, { target: ts.ScriptTarget.ES2022 }), context);
    const provider = new context.Provider();
    provider.notifyError = error => { throw new Error(error); };
    provider._view = { webview: { postMessage() {} } };
    provider._operationCancellation = { controller: new AbortController(), serverStarted: false, operationId: 'sidebar', serverPort: 8123 };
    await provider.cancelOperation();
    assert.equal(provider._operationCancellation.controller.signal.aborted, true);
    assert.equal(calls.length, 0);
    provider._operationCancellation.serverStarted = true;
    await provider.cancelOperation();
    assert.equal(calls[0].url, '8123/cancel_embedding');
    assert.deepEqual(JSON.parse(calls[0].options.body), { operation_id: 'sidebar' });
    provider._operationCancellation = undefined;
    await provider.cancelOperation();
    assert.equal(calls[1].url, '8000/index_progress');
    assert.deepEqual(JSON.parse(calls[2].options.body), { operation_id: 'observed-external' });
});

test('translation supplies a deadline and abort signal and never falls back after cancellation', async () => {
    const start = source.indexOf('async function translateWithGemini(');
    const end = source.indexOf('// インデントベース', start);
    const controller = new AbortController();
    const calls = [];
    const warnings = [];
    const context = vm.createContext({ DEFAULT_GEMINI_TRANSLATION_MODEL: 'test-model', console,
        vscode: { window: { showWarningMessage: message => warnings.push(message) } },
        GoogleGenAI: class { models = { generateContent: async params => {
            calls.push(params);
            controller.abort();
            params.config.abortSignal.throwIfAborted();
        } }; }
    });
    const body = source.slice(start, end).replace("await import('@google/genai')", '({ GoogleGenAI: globalThis.GoogleGenAI })');
    vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
    await assert.rejects(context.translateWithGemini('認証', 'synthetic-key', 'test-model', controller.signal), { name: 'AbortError' });
    assert.equal(calls[0].config.abortSignal, controller.signal);
    assert.equal(calls[0].config.httpOptions.timeout, 60000);
    assert.deepEqual(warnings, []);
});
