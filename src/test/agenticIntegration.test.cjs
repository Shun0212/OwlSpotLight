const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const { normalizeGeminiModel } = require('../../out/queryExpansion');
const { normalizeAgentSearchLimit } = require('../../out/agenticSearch');

// Execute the actual extension Search handler with transport and VS Code stubs.
function fixture(agent, overrides = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../extension.ts'), 'utf8');
    const start = source.lastIndexOf("if (msg.command === 'search') {");
    const end = source.indexOf("if (msg.command === 'getClassStats')", start);
    const messages = [], requests = [];
    const cancellation = { cancelled: false, serverStarted: false, controller: new AbortController() };
    const config = { get: (key, fallback) => ({ enableAgenticSearch: true, geminiModel: 'gemini-3.8-flash', agenticMaxSearches: 3 })[key] ?? fallback };
    const context = vm.createContext({
        AbortController, isSimpleMode: () => false,
        vscode: { workspace: { getConfiguration: () => config, workspaceFolders: [{ uri: { fsPath: '/fixture' } }] } },
        webviewView: { webview: { postMessage: message => messages.push(message) } },
        resolveActiveServerPort: async () => 8000,
        getServerUrl: route => route,
        normalizeSearchTarget: target => target,
        normalizeGeminiModel, normalizeAgentSearchLimit,
        createCodeReader: require('../../out/agentCode').createCodeReader,
        resolveSearchIncludeFiles: async () => ['src/auth.py'],
        translateJapaneseToEnglish: async () => { throw new Error('Agentic search must use the original query'); },
        fetch: async (route, options) => {
            if (route === '/index_status') { return { ok: true }; }
            requests.push(JSON.parse(options.body));
            return { ok: true, json: async () => ({ results: [{ file: '/fixture/src/auth.py', lineno: 1, code: 'def validate(): pass' }] }) };
        },
        runAgenticSearch: agent,
        ...overrides
    });
    vm.runInContext(ts.transpile(`async function run(msg, cancellation) { ${source.slice(start, end)} }`, { target: ts.ScriptTarget.ES2022 }), context);
    const message = { command: 'search', text: '認証', lang: '.py', scope: 'changed', searchTarget: 'changed_functions', searchMode: 'semantic', diffRangeMode: 'custom', diffBaseRef: 'abc', diffHeadRef: 'def', firstParent: false };
    return { messages, requests, cancellation, run: patch => context.run({ ...message, ...patch }, cancellation) };
}

test('agent tool calls preserve scope, language, files and Git range across modes', async () => {
    const f = fixture(async options => {
        assert.equal(options.query, '認証');
        assert.equal(options.model, 'gemini-3.8-flash');
        assert.equal(options.rewriteOptions.searchTarget, 'changed_functions');
        await options.search('authentication', 'bm25');
        const results = await options.search('validate', 'keyword');
        options.onProgress({ steps: [], status: 'Reviewing' });
        return { results, steps: [], summary: 'Done', stopReason: 'finished' };
    });
    await f.run();
    assert.equal(f.requests.length, 2);
    for (const request of f.requests) {
        assert.equal(request.directory, '/fixture');
        assert.equal(request.file_ext, '.py');
        assert.equal(request.scope, 'changed');
        assert.equal(request.search_target, 'changed_functions');
        assert.deepEqual(request.include_files, ['src/auth.py']);
        assert.equal(request.diff_range_mode, 'custom');
        assert.equal(request.diff_base_ref, 'abc');
        assert.equal(request.diff_head_ref, 'def');
        assert.equal(request.first_parent, false);
    }
    assert.deepEqual(f.requests.map(r => r.search_mode), ['bm25', 'keyword']);
    assert.equal(f.messages.filter(m => m.type === 'results').length, 1);
    assert.equal(f.messages.filter(m => m.type === 'agentTrace').length, 2);
    assert.equal(f.cancellation.serverStarted, false);
});

test('Stop between agent lookups prevents further server requests and late results', async () => {
    const f = fixture(async options => {
        await options.search('one', 'keyword');
        f.cancellation.cancelled = true;
        f.cancellation.controller.abort();
        await assert.rejects(options.search('two', 'keyword'), { name: 'AbortError' });
        return { results: [{ code: 'late result' }], steps: [], summary: 'Stopped' };
    });
    await f.run();
    assert.equal(f.requests.length, 1);
    assert.equal(f.messages.some(m => m.type === 'results' || m.type === 'error'), false);
});

test('agentic off keeps a single ordinary search and diff target maps to commit results', async () => {
    let invoked = false;
    const f = fixture(async options => {
        invoked = true;
        assert.equal(options.rewriteOptions.searchTarget, 'diff_commits');
        return { results: [], steps: [], summary: 'No match' };
    });
    await f.run({ agenticEnabled: false, searchMode: 'keyword' });
    assert.equal(invoked, false);
    assert.equal(f.requests.length, 1);
    await f.run({ searchTarget: 'diff_hunks' });
    assert.equal(invoked, true);
});

test('Node mode reuses Gemini tool searches with no HTTP transport', async () => {
    const requests = [];
    const f = fixture(async options => {
        const results = await options.search('authentication', 'bm25');
        assert.equal(results[0].function_name, 'verify');
        return { results, steps: [], summary: 'Local result', stopReason: 'finished' };
    }, { isSimpleMode: () => true,
        resolveActiveServerPort: () => { throw new Error('Must not probe HTTP'); },
        fetch: () => { throw new Error('Must not fetch HTTP'); },
        simpleMode: { search: async request => { requests.push(request); return { results: [{ function_name: 'verify', symbol_kind: 'function' }] }; } } });
    await f.run();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].scope, 'changed');
    assert.equal(requests[0].diff_base_ref, 'abc');
    assert.equal(f.messages.some(message => message.type === 'results'), true);
});
