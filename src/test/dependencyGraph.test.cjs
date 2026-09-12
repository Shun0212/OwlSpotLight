const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function harness(provider = true, sideBySide = true, sitePath = file => file) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owl-graph-'));
    const file = path.join(root, 'app.py');
    await fs.writeFile(file, 'def run():\n    helper()\n\ndef helper():\n    pass\n');
    const decorations = [];
    const messages = [], commands = [], opened = [], reveals = [], configurationListeners = [], selectionListeners = [], activeEditorListeners = [], visibleEditorListeners = [];
    const configuration = { 'graph.sideBySide': sideBySide, highlightColors: {} };
    let receive, dispose;
    let documentSymbols = [];
    let hierarchyKind;
    // VS Code's URI.fsPath lowercases Windows drive letters.
    const uri = file => ({ scheme: 'file', fsPath: process.platform === 'win32'
        ? file.replace(/^[A-Z]:/, drive => drive.toLowerCase()) : file });
    const pos = line => ({ line, character: 4 });
    const range = (start, end) => ({ start: pos(start), end: pos(end) });
    const hierarchy = name => ({ name, kind: hierarchyKind, uri: uri(file), range: range(name === 'run' ? 0 : 3, name === 'run' ? 1 : 4), selectionRange: range(name === 'run' ? 0 : 3, name === 'run' ? 0 : 3) });
    const panel = { webview: { html: '', cspSource: 'file:', asWebviewUri: u => 'file://' + u.fsPath,
        postMessage: msg => messages.push(msg), onDidReceiveMessage: fn => { receive = fn; } },
        onDidDispose: fn => { dispose = fn; }, reveal: (...args) => reveals.push(args), dispose: () => dispose() };
    const vscode = {
        Uri: { file: uri, joinPath: (u, ...parts) => uri(path.join(u.fsPath, ...parts)) },
        ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
        OverviewRulerLane: {Left: 1, Right: 4},
        TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
        SymbolKind: { Method: 5, Function: 11, Class: 4 },
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        Position: class { constructor(line, character) { this.line = line; this.character = character; } },
        Range: class { constructor(start, end) { this.start = start; this.end = end; } },
        window: { createWebviewPanel: () => panel,
            visibleTextEditors: [],
            onDidChangeTextEditorSelection: fn => { selectionListeners.push(fn); return { dispose() {} }; },
            onDidChangeActiveTextEditor: fn => { activeEditorListeners.push(fn); return { dispose() {} }; },
            onDidChangeVisibleTextEditors: fn => { visibleEditorListeners.push(fn); return { dispose() {} }; },
            createTextEditorDecorationType: options => ({options, dispose() {} }),
            showTextDocument: async (doc, options) => {
                opened.push(options);
                const editor = { document: doc, viewColumn: options.viewColumn, selection: { active: options.selection.start }, setDecorations(type, ranges) { decorations.push({options:type.options, ranges}); }, revealRange() {} };
                vscode.window.visibleTextEditors = [editor];
                for (const listener of selectionListeners) {listener({ textEditor: editor });}
                return editor;
            } },
        workspace: {
            getConfiguration: () => ({ get: (key, fallback) => configuration[key] ?? fallback,
                inspect: () => ({}), update: async (key, value) => {
                    configuration[key] = value;
                    for (const listener of configurationListeners) {listener({ affectsConfiguration: name => name === 'owlspotlight.' + key });}
                } }),
            onDidChangeConfiguration: fn => { configurationListeners.push(fn); return { dispose() {} }; },
            openTextDocument: async documentUri => ({ uri: documentUri, lineCount: 5,
            lineAt: n => ({ lineNumber: n, text: ['def run():', '    helper()', '', 'def helper():', '    pass'][n] || '' }) }) },
        commands: { executeCommand: async (command, ...args) => {
            commands.push(command);
            if (command === 'vscode.executeDocumentSymbolProvider') {return documentSymbols;}
            if (command === 'vscode.prepareCallHierarchy') {return provider ? [hierarchy(args[1].line === 0 ? 'run' : 'helper')] : undefined;}
            if (command === 'vscode.provideIncomingCalls') {return [];}
            if (command === 'vscode.provideOutgoingCalls') {return args[0].name === 'run' ? [{ to: hierarchy('helper'), fromRanges: [{start: {line: 1, character: 4}, end: {line: 1, character: 10}}] }] : [];}
        } }
    };
    const load = Module._load;
    Module._load = function(name, ...args) { return name === 'vscode' ? vscode : load.call(this, name, ...args); };
    delete require.cache[require.resolve('../../out/dependencyGraph')];
    delete require.cache[require.resolve('../../out/graphSettings')];
    delete require.cache[require.resolve('../../out/highlightColors')];
    const module = require('../../out/dependencyGraph');
    const settings = require('../../out/graphSettings');
    Module._load = load;
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (_, options) => {
        const req = JSON.parse(options.body); requests.push(req);
        const node = (id, line, name) => ({ id, file, line, endLine: line + 1, name, queryScore: .7, similarity: .8, unresolved: 0 });
        return { ok: true, json: async () => ({ center: req.line === 1 ? 'run' : 'helper',
            nodes: [node('run', 1, 'run'), node('helper', 4, 'helper')],
            edges: [{ source: 'run', target: 'helper', kind: 'call', evidence: 'static',
                sites: [{ file: sitePath(file), line: 2, column: 4, endLine: 2, endColumn: 10 }] }], embeddingsAvailable: true }) };
    };
    await module.openDependencyGraph({ extensionUri: uri(path.resolve(__dirname, '../..')) },
        { directory: root, file, line: 1, query: 'authentication', file_ext: '.py' }, 'http://127.0.0.1/dependency_graph');
    return { decorations, root, file, module, settings, panel, receive: msg => receive(msg), messages, requests, commands, opened, reveals, configuration,
        setHierarchyKind: value => { hierarchyKind = value; },
        setDocumentSymbols: value => { documentSymbols = value; },
        emitSelection: async (line, source = file, viewColumn = 2) => {
            const editor = { document: { uri: uri(source), lineCount: 30, lineAt: n => ({text: n === 0 ? 'def run():' : 'def helper():'}) }, viewColumn, selection: { active: pos(line) }, setDecorations() {} };
            for (const listener of selectionListeners) {listener({ textEditor: editor });}
            // Wait for realpath used by the extension's asynchronous selection listener.
            await new Promise(resolve => setTimeout(resolve, 20));
        },
        cleanup: async () => { dispose(); global.fetch = originalFetch; await fs.rm(root, { recursive: true }); } };
}

test('graph merges static and provider edges, expands a selected function, and opens its source', async () => {
    const h = await harness();
    try {
        await h.receive({ type: 'ready' });
        const graph = h.messages.find(m => m.type === 'graph');
        assert.equal(graph.nodes.length, 2);
        assert.equal(graph.edges.length, 1);
        assert.equal(graph.edges[0].evidence, 'provider');
        assert.ok(h.commands.includes('vscode.provideIncomingCalls'));
        assert.ok(h.commands.includes('vscode.provideOutgoingCalls'));
        await h.receive({ type: 'expand', id: 'helper', similar: true });
        assert.equal(h.requests[1].line, 4);
        assert.equal(h.requests[1].similar, true);
        await h.receive({ type: 'open', id: 'helper' });
        assert.equal(h.opened.at(-1).selection.start.line, 3);
        await h.receive({ type: 'open', id: '/outside' });
        assert.equal(h.opened.length, 2);
        assert.equal(h.module.isInside(h.root, h.root + '-other/app.py'), false);
    } finally { await h.cleanup(); }
});

test('unavailable language provider preserves static graph and reports unresolved status', async () => {
    const h = await harness(false);
    try {
        await h.receive({ type: 'ready' });
        const graph = h.messages.find(m => m.type === 'graph');
        assert.equal(graph.edges[0].evidence, 'static');
        assert.match(graph.status, /unavailable or unresolved/);
        assert.match(h.panel.webview.html, /Content-Security-Policy/);
        assert.ok(!h.panel.webview.html.includes('authentication')); // query arrives through a text-only message
    } finally { await h.cleanup(); }
});


test('node previews use fixed left/right groups, reuse the code column, and obey the saved toggle', async () => {
    const h = await harness(true, false);
    try {
        await h.receive({ type: 'ready' });
        assert.equal(h.opened.length, 0);
        await h.receive({ type: 'select', id: 'helper' });
        assert.equal(h.opened.length, 0);
        await h.receive({ type: 'setSideBySide', enabled: true, id: 'helper' });
        assert.equal(h.configuration['graph.sideBySide'], true);
        assert.equal(h.opened.at(-1).viewColumn, 2);
        assert.equal(h.opened.at(-1).preserveFocus, true);
        assert.equal(h.reveals.at(-1)[0], 1);
        await h.receive({ type: 'select', id: 'run' });
        assert.equal(h.opened.at(-1).viewColumn, 2);
        assert.equal(h.commands.filter(c => c === 'vscode.setEditorLayout').length, 1);
        await h.receive({ type: 'setSideBySide', enabled: false, id: 'run' });
        const count = h.opened.length;
        await h.receive({ type: 'select', id: 'helper' });
        assert.equal(h.opened.length, count);
        assert.equal(h.configuration['graph.sideBySide'], false);
    } finally { await h.cleanup(); }
});

test('rapid node selections preview only the latest requested location', async () => {
    const h = await harness();
    try {
        await h.receive({ type: 'ready' });
        const before = h.opened.length;
        await Promise.all([h.receive({ type: 'select', id: 'helper' }), h.receive({ type: 'select', id: 'run' })]);
        assert.equal(h.opened.length, before + 1);
        assert.equal(h.opened.at(-1).selection.start.line, 0);
    } finally { await h.cleanup(); }
});


test('right editor cursor updates graph selection without reopening code, and unknown/left locations do not select a wrong node', async () => {
    const h = await harness();
    try {
        await h.receive({ type: 'ready' });
        const opened = h.opened.length;
        await h.emitSelection(3);
        assert.equal(h.messages.filter(m => m.type === 'selection').at(-1).id, 'helper');
        assert.equal(h.opened.length, opened);
        await h.emitSelection(0);
        assert.equal(h.messages.filter(m => m.type === 'selection').at(-1).id, 'run');
        const count = h.messages.length;
        await h.emitSelection(3, h.file, 1);
        assert.equal(h.messages.length, count);
        await h.emitSelection(15);
        assert.equal(h.messages.filter(m => m.type === 'selection').at(-1).id, '');
        await h.receive({ type: 'setSideBySide', enabled: false, id: 'run' });
        const disabledCount = h.messages.length;
        await h.emitSelection(3);
        assert.equal(h.messages.length, disabledCount);
    } finally { await h.cleanup(); }
});


test('graph display defaults on and is independent of editor synchronization; palette follows existing highlights', async () => {
    const h = await harness();
    try {
        assert.equal(h.settings.graphOnResultClick(), true);
        await h.settings.updateGraphOnResultClick(false);
        assert.equal(h.settings.graphOnResultClick(), false);
        assert.equal(h.settings.graphSideBySide(), true);
        h.configuration.highlightColors = { standaloneFunction: 'rgba(200,100,50,0.18)', classMethod: '#336699', jumpLine: 'url(unsafe)' };
        const { palette } = h.settings.graphSettings();
        assert.equal(palette.low, '#c86432');
        assert.equal(palette.middle, '#336699');
        assert.equal(palette.selected, '#ffc800');
        assert.equal(h.settings.graphSettings().fills.function.alpha, 0.18);
        assert.equal(h.settings.graphSettings().fills.classBody.alpha, 0.08);
        assert.equal(h.settings.graphSettings().palette.high, '#00c864');
        h.configuration.highlightColors.standaloneFunction = 'rgba(200,100,50,0)';
        assert.equal(h.settings.graphSettings().fills.function.alpha, 0);
        h.configuration.highlightColors.standaloneFunction = 'rgba(200,100,50,0.7)';
        assert.equal(h.settings.graphSettings().fills.function.alpha, 0.7);
    } finally { await h.cleanup(); }
});


test('browsing a new right-editor method adds and selects its provider symbol without losing existing nodes', async () => {
    const h = await harness();
    try {
        await h.receive({ type: 'ready' });
        const at = line => ({ line, character: 4 });
        h.setDocumentSymbols([{ name: 'Service', kind: 4, range: {start: at(7), end: at(18)}, selectionRange: {start: at(7),end: at(7)},
            children: [{name: 'additional', kind: 5, range: {start: at(9),end: at(14)},selectionRange: {start: at(9),end: at(9)},children: []}] }]);
        await h.emitSelection(11);
        const added = h.messages.filter(m => m.type === 'upsertNode').at(-1).node;
        assert.equal(added.name, 'additional');
        assert.equal(added.className, 'Service');
        assert.equal(added.symbolKind, 'method');
        assert.equal(h.messages.filter(m => m.type === 'selection').at(-1).id, added.id);
        assert.equal(h.requests.length, 1); // source navigation does not rebuild the graph
    } finally { await h.cleanup(); }
});


test('call navigation uses the caller location and colors are stable across selection', async () => {
    const h = await harness();
    try {
        await h.receive({type:'ready'});
        const graph = h.messages.find(m => m.type === 'graph');
        assert.notEqual(graph.nodes[0].colorIndex, graph.nodes[1].colorIndex);
        assert.equal(new Set(h.settings.graphSettings().functionColors).size, 10);
        await h.receive({type:'select', id:'helper'});
        await h.receive({type:'openCall', source:'run', target:'helper'});
        assert.equal(h.opened.at(-1).selection.start.line, 1);
        assert.equal(h.opened.at(-1).selection.start.character, 4);
        const body = h.decorations.findLast(d => d.options.border);
        assert.ok(body);
        assert.equal(body.options.isWholeLine, true);
        assert.equal(body.options.backgroundColor, 'rgba(255,140,0,0.18)');
        assert.equal(body.options.border, '1px solid rgba(255,140,0,0.45)');
        assert.deepEqual(body.ranges.map(r => [r.start.line, r.start.character, r.end.line, r.end.character]),
            [[0, 0, 1, 12]]);
        assert.ok(h.decorations.some(d => d.options.isWholeLine && d.options.backgroundColor === 'rgba(255,200,0,0.35)'));
        const call = h.decorations.find(d => !d.options.isWholeLine && d.options.backgroundColor &&
            d.ranges.some(r => r.start.line === 1 && r.start.character === 4 && r.end.character === 10));
        assert.ok(call, 'call identifier remains highlighted inside the function');
        assert.equal(call.options.backgroundColor, 'rgba(0,140,255,0.25)');
        assert.equal(call.options.fontWeight, undefined);
        assert.equal(call.options.textDecoration, 'underline solid #008cff');
        h.decorations.length = 0;
        await h.receive({type:'select', id:'helper'});
        assert.ok(h.decorations.some(d => !d.options.isWholeLine && d.options.backgroundColor &&
            d.ranges.some(r => r.start.line === 1)), 'selecting the callee also marks its incoming call in the same file');
        const count = h.opened.length;
        await h.receive({type:'openCall', source:'outside', target:'helper'});
        assert.equal(h.opened.length, count);
    } finally { await h.cleanup(); }
});


for (const provider of [false, true]) {
    test(`Windows call colors survive URI drive casing and server path separators (provider: ${provider})`,
        { skip: process.platform !== 'win32' }, async () => {
        const h = await harness(provider, true, file => file.replace(/\\/g, '/').toUpperCase());
        try {
            await h.receive({ type: 'ready' });
            for (const id of ['run', 'helper']) {
                h.decorations.length = 0;
                await h.receive({ type: 'select', id });
                const call = h.decorations.find(d => d.options.textDecoration === 'underline solid #008cff');
                assert.ok(call, `call to helper has its graph color when ${id} is selected`);
                assert.deepEqual(call.ranges.map(r => [r.start.line, r.start.character, r.end.character]), [[1, 4, 10]]);
            }
            await h.receive({ type: 'openCall', source: 'run', target: 'helper' });
            assert.equal(h.opened.at(-1).selection.start.line, 1);
            assert.ok(!h.messages.some(m => m.type === 'error'));
        } finally { await h.cleanup(); }
    });
}

test('call sites belonging to another file are not colored or opened in the caller', async () => {
    const h = await harness(false, true, file => path.join(path.dirname(file), 'other.py'));
    try {
        await h.receive({ type: 'ready' });
        assert.ok(!h.decorations.some(d => d.options.textDecoration));
        const opened = h.opened.length;
        await h.receive({ type: 'openCall', source: 'run', target: 'helper' });
        assert.equal(h.opened.length, opened);
        assert.match(h.messages.at(-1).message, /Call location is unavailable/);
    } finally { await h.cleanup(); }
});

test('late method ownership updates an existing node and survives another static expansion', async () => {
    const h = await harness();
    try {
        await h.receive({type:'ready'});
        const initial = h.messages.filter(m=>m.type==='graph').at(-1).nodes.find(n=>n.name==='helper');
        const originalColor = initial.colorIndex;
        h.setHierarchyKind(5);
        h.setDocumentSymbols([{name:'Service',kind:4,range:{start:{line:2},end:{line:4}},
            selectionRange:{start:{line:2},end:{line:2}},children:[]}]);
        await h.receive({type:'expand',id:'run'});
        let helper = h.messages.filter(m=>m.type==='graph').at(-1).nodes.find(n=>n.name==='helper');
        assert.equal(helper.className,'Service');
        assert.equal(helper.symbolKind,'method');
        assert.equal(helper.colorIndex,originalColor);
        h.setHierarchyKind(undefined);
        h.setDocumentSymbols([]);
        await h.receive({type:'expand',id:'run'});
        helper = h.messages.filter(m=>m.type==='graph').at(-1).nodes.find(n=>n.name==='helper');
        assert.equal(helper.className,'Service');
        assert.equal(helper.symbolKind,'method');
        assert.equal(h.messages.filter(m=>m.type==='graph').at(-1).nodes.filter(n=>n.name==='helper').length,1);
    } finally { await h.cleanup(); }
});
