import { getHighlightColors, deriveBorderColor } from './highlightColors';
import { graphSettings, graphSideBySide, updateGraphSideBySide } from './graphSettings';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { randomBytes } from 'crypto';

interface GraphNode {
    id: string; file: string; line: number; endLine: number; name: string;
    className?: string; symbolKind?: string; queryScore: number | null; similarity: number | null;
    unresolved: number | null; colorIndex?: number;
}
interface CallSite { file: string; line: number; column: number; endLine: number; endColumn: number }
interface GraphEdge {
    sites?: CallSite[];
    source: string; target: string; kind: 'call' | 'similar'; evidence: 'static' | 'provider' | 'embedding'; score?: number;
}
interface GraphData {
    center: string; nodes: GraphNode[]; edges: GraphEdge[]; truncated?: boolean; embeddingsAvailable?: boolean;
}
interface GraphRequest { directory: string; file: string; line: number; query: string; file_ext: string }
const MAX_NODES = 80;
let currentGraph: { root: string; show: (request: GraphRequest) => Promise<void>; close: () => void } | undefined;

export function closeDependencyGraph(): void { currentGraph?.close(); }

export function isInside(root: string, file: string): boolean {
    const relative = path.relative(root, file);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function deadline<T>(work: Thenable<T>, milliseconds = 8000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([Promise.resolve(work), new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Language provider timed out')), milliseconds);
        })]);
    } finally { clearTimeout(timer); }
}

export async function openDependencyGraph(context: vscode.ExtensionContext, request: GraphRequest, endpoint: string): Promise<void> {
    const root = await fs.promises.realpath(request.directory);
    const file = await fs.promises.realpath(request.file);
    if (!isInside(root, file) || !Number.isInteger(request.line) || request.line < 1) {
        throw new Error('Invalid graph location');
    }
    if (currentGraph?.root === root) {
        await currentGraph.show({ ...request, directory: root, file });
        return;
    }
    const resource = vscode.Uri.file(root);
    const panel = vscode.window.createWebviewPanel('owlspotlight.dependencyGraph', 'OwlSpotlight · Graph', vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
    const nonce = randomBytes(16).toString('hex');
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'dependencyGraph.js'));
    const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'dependencyGraph.css'));
    panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${style}"></head><body>
<header><details id="graphControls"><summary aria-label="Graph controls" title="Graph controls">⚙</summary><div class="controls-panel"><h1>Code Graph <span>Current workspace</span></h1><p id="query"></p>
<div class="toolbar"><label for="color">Score</label><select id="color" aria-label="Similarity score"><option value="queryScore">Query similarity</option><option value="similarity">Selected function similarity</option><option value="none">Hide scores</option></select>
<label><input type="checkbox" id="similar"> Show similar functions (top 5)</label>
<button id="expand">Expand selected</button><button id="source">Open source</button><button id="reset">Reset</button><button id="zoomOut" aria-label="Zoom out">−</button><button id="fit">Fit graph</button><button id="zoomIn" aria-label="Zoom in">+</button></div>
<details class="graph-settings"><summary>Settings</summary><label><input type="checkbox" id="sideBySide"> Sync graph and source code</label></details>
<p id="status" role="status">Loading…</p></div></details></header>
<main><div id="canvas" tabindex="0" aria-label="Graph canvas"><svg id="graph" xmlns="http://www.w3.org/2000/svg" aria-label="Code dependency graph"></svg></div>
</main>
<footer><div class="score-legend"><span>Matching colors link functions and code</span></div><div class="edge-legend"><span>→ Calls</span><span>⇢ Static estimate</span><span>··· Similar code</span></div><span class="navigation-hint">Drag to pan · Wheel to zoom</span></footer><div id="graphError" role="alert" hidden></div>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    let disposed = false;
    let busy = false;
    let initial = '';
    let generation = 0;
    let ready = false;
    let queuedRequest: GraphRequest | undefined;
    let layoutReady = false;
    let latestSelection = 0;
    let previewQueue: Promise<void> = Promise.resolve();
    let syncingPreview = false;
    let editorSyncVersion = 0;
    let synchronizedSelection: string | undefined;
    let sourceDecorations: vscode.TextEditorDecorationType[] = [];
    const clearSource = () => { sourceDecorations.forEach(d => d.dispose()); sourceDecorations = []; };
    const abort = new AbortController();
    const settingsListener = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('owlspotlight.graph.sideBySide') || event.affectsConfiguration('owlspotlight.highlightColors')) {
            if (event.affectsConfiguration('owlspotlight.graph.sideBySide')) {
                layoutReady = false; ++latestSelection;
                if (!graphSideBySide(resource)) { clearSource(); }
            }
            if (event.affectsConfiguration('owlspotlight.highlightColors')) {
                const right = vscode.window.visibleTextEditors.find(editor => editor.viewColumn === vscode.ViewColumn.Two);
                if (right && synchronizedSelection) { highlightSource(right, nodes.get(synchronizedSelection)); }
            }
            post({ type: 'settings', ...graphSettings(resource) });
        }
    });
    panel.onDidDispose(() => {
        disposed = true; abort.abort(); settingsListener.dispose(); selectionListener.dispose(); activeEditorListener.dispose(); visibleEditorsListener.dispose(); clearSource();
        if (currentGraph === session) { currentGraph = undefined; }
    });
    const post = (message: object) => { if (!disposed) { void panel.webview.postMessage(message); } };
    const addNode = (node: GraphNode): GraphNode | undefined => {
        const existing = [...nodes.values()].find(n => n.file === node.file &&
            n.line <= node.line && n.endLine >= node.line && (n.name === node.name || n.id === node.id));
        if (existing) {
            if (node.className) { existing.className = node.className; }
            if (node.symbolKind && node.symbolKind !== 'function') { existing.symbolKind = node.symbolKind; }
            existing.endLine = Math.max(existing.endLine, node.endLine);
            return existing;
        }
        if (nodes.size >= MAX_NODES) { return undefined; }
        node.colorIndex = nodes.size % 10;
        nodes.set(node.id, node);
        return node;
    };
    const addEdge = (edge: GraphEdge) => {
        if (!nodes.has(edge.source) || !nodes.has(edge.target)) { return; }
        const key = `${edge.source}:${edge.target}:${edge.kind}`;
        const previous = edges.get(key);
        if (previous?.evidence !== 'provider') { edges.set(key, { ...edge, sites: edge.sites?.length ? edge.sites : previous?.sites }); }
    };
    async function ensureLayout() {
        if (!layoutReady) {
            await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.42 }, { size: 0.58 }] });
            layoutReady = true;
        }
        panel.reveal(vscode.ViewColumn.One, true);
    }
    function highlightSource(editor: vscode.TextEditor, node: GraphNode | undefined) {
        clearSource();
        if (!node) { return; }
        const settings = graphSettings(resource);
        const colors = getHighlightColors(resource);
        const backgroundColor = node.symbolKind === 'class' ? colors.classBody
            : node.className || node.symbolKind === 'method' ? colors.classMethod : colors.standaloneFunction;
        const startLine = Math.max(0, Math.min(node.line - 1, editor.document.lineCount - 1));
        const endLine = Math.max(startLine, Math.min(node.endLine - 1, editor.document.lineCount - 1));
        const decorate = (background: string, start: number, end: number, border = false) => {
            const decoration = vscode.window.createTextEditorDecorationType({
                backgroundColor: background, isWholeLine: true,
                ...(border ? { border: `1px solid ${deriveBorderColor(background)}` } : {})
            });
            sourceDecorations.push(decoration);
            editor.setDecorations(decoration, [new vscode.Range(new vscode.Position(start, 0),
                new vscode.Position(end, editor.document.lineAt(end).text.length))]);
        };
        // Use the same kind-based colors and block outlines as ordinary search navigation.
        const owner = node.symbolKind === 'class' ? node : [...nodes.values()].find(candidate =>
            candidate.symbolKind === 'class' && candidate.file === node.file && candidate.name === node.className);
        if (owner) {
            const classStart = Math.max(0, Math.min(owner.line - 1, editor.document.lineCount - 1));
            const classEnd = Math.max(classStart, Math.min(owner.endLine - 1, editor.document.lineCount - 1));
            decorate(colors.classBody, classStart, classEnd);
            decorate(colors.classHeader, classStart, classStart, true);
        }
        if (node.symbolKind !== 'class') { decorate(backgroundColor, startLine, endLine, true); }
        decorate(colors.jumpLine, startLine, startLine);
        // Mark resolved call sites, while leaving the enclosing function tint intact.
        // Incoming calls in this file remain visible when their callee is selected.
        for (const target of nodes.values()) {
            const ranges: vscode.Range[] = [];
            for (const edge of edges.values()) {
                if (edge.kind !== 'call' || edge.target !== target.id ||
                    (edge.source !== node.id && edge.target !== node.id)) { continue; }
                for (const site of edge.sites || []) {
                    if (site.file !== editor.document.uri.fsPath || site.line < 1 ||
                        site.endLine > editor.document.lineCount || site.endLine < site.line) { continue; }
                    const line = editor.document.lineAt(site.endLine - 1).text;
                    const nameStart = target.name ? line.lastIndexOf(target.name, site.endColumn - target.name.length) : -1;
                    const start = nameStart >= 0 && (site.line !== site.endLine || nameStart >= site.column)
                        ? new vscode.Position(site.endLine - 1, nameStart) : new vscode.Position(site.line - 1, site.column);
                    const end = nameStart >= 0 && start.line === site.endLine - 1 && start.character === nameStart
                        ? new vscode.Position(site.endLine - 1, nameStart + target.name.length)
                        : new vscode.Position(site.endLine - 1, site.endColumn);
                    ranges.push(new vscode.Range(start, end));
                }
            }
            if (!ranges.length) { continue; }
            const callColor = settings.functionColors[target.colorIndex || 0];
            const callRgb = [1, 3, 5].map(i => parseInt(callColor.slice(i, i + 2), 16));
            const call = vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(' + callRgb.join(',') + ',' + Math.min(settings.fills.selection.alpha, 0.25) + ')',
                textDecoration: 'underline solid ' + callColor, borderRadius: '2px',
                overviewRulerColor: callColor, overviewRulerLane: vscode.OverviewRulerLane.Right
            });
            sourceDecorations.push(call);
            editor.setDecorations(call, ranges);
        }
    }

    async function syncFromEditor(editor: vscode.TextEditor | undefined) {
        if (disposed || syncingPreview || !graphSideBySide(resource) || !editor || editor.viewColumn !== vscode.ViewColumn.Two) { return; }
        const version = ++editorSyncVersion;
        const line = editor.selection.active.line + 1;
        const actual = await fs.promises.realpath(editor.document.uri.fsPath).catch(() => '');
        if (disposed || version !== editorSyncVersion || syncingPreview) { return; }
        let node: GraphNode | undefined = [...nodes.values()].filter(n => n.file === actual && n.line <= line && n.endLine >= line)
            .sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0];
        // A right-hand function not yet in this neighborhood can join the graph
        // without discarding the existing layout or fetching a full call graph.
        if (!node && actual && isInside(root, actual) && nodes.size < MAX_NODES) {
            const symbols = await deadline(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider', editor.document.uri)).catch(() => []);
            if (disposed || version !== editorSyncVersion || syncingPreview) { return; }
            const candidates: Array<{ symbol: vscode.DocumentSymbol; owner?: string }> = [];
            const visit = (list: vscode.DocumentSymbol[], owner?: string) => {
                for (const symbol of list) {
                    if (!symbol.range || !symbol.selectionRange) { continue; }
                    if (symbol.range.start.line <= line - 1 && symbol.range.end.line >= line - 1 &&
                        [vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor, vscode.SymbolKind.Class].includes(symbol.kind)) {
                        candidates.push({ symbol, owner });
                    }
                    if (symbol.children) { visit(symbol.children, symbol.kind === vscode.SymbolKind.Class ? symbol.name : owner); }
                }
            };
            visit(symbols || []);
            const match = candidates.sort((a, b) => (a.symbol.range.end.line - a.symbol.range.start.line) - (b.symbol.range.end.line - b.symbol.range.start.line))[0];
            if (match) {
                const symbol = match.symbol;
                node = addNode({ id: `${actual}:${symbol.selectionRange.start.line + 1}:${symbol.name}`,
                    file: actual, line: symbol.selectionRange.start.line + 1, endLine: symbol.range.end.line + 1,
                    name: symbol.name, className: match.owner,
                    symbolKind: symbol.kind === vscode.SymbolKind.Class ? 'class' : match.owner ? 'method' : 'function',
                    queryScore: null, similarity: null, unresolved: null });
                if (node) { post({ type: 'upsertNode', node }); }
            }
        }
        const id = node?.id || '';
        if (id === synchronizedSelection) { return; }
        ++latestSelection;
        synchronizedSelection = id;
        highlightSource(editor, node);
        post({ type: 'selection', id, reveal: true });
    }
    const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => { void syncFromEditor(event.textEditor); });
    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => { void syncFromEditor(editor); });
    const visibleEditorsListener = vscode.window.onDidChangeVisibleTextEditors(editors => {
        const right = editors.find(editor => editor.viewColumn === vscode.ViewColumn.Two);
        if (right) { void syncFromEditor(right); }
        else if (!syncingPreview && graphSideBySide(resource)) {
            clearSource();
            synchronizedSelection = '';
            post({ type: 'selection', id: '' });
        }
    });
    function preview(node: GraphNode, automatic: boolean, site?: CallSite): Promise<void> {
        const ticket = ++latestSelection;
        ++editorSyncVersion;
        previewQueue = previewQueue.catch(() => {}).then(async () => {
            if (disposed || ticket !== latestSelection || (automatic && !graphSideBySide(resource))) { return; }
            const actual = await fs.promises.realpath(node.file);
            if (!isInside(root, actual)) { throw new Error('Source is outside the graph workspace'); }
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(actual));
            if (disposed || ticket !== latestSelection) { return; }
            syncingPreview = true;
            try {
                await ensureLayout();
                if (disposed || ticket !== latestSelection) { return; }
                const position = new vscode.Position(Math.min((site?.line || node.line) - 1, doc.lineCount - 1), site?.column || 0);
                const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Two,
                    selection: new vscode.Range(position, position), preview: true, preserveFocus: automatic });
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                highlightSource(editor, node);
                synchronizedSelection = node.id;
            } finally { syncingPreview = false; }
        });
        return previewQueue;
    }
    async function enrich(node: GraphNode): Promise<string> {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(node.file));
        const symbols = await deadline(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider', doc.uri)).catch(() => []);
        const candidates: vscode.DocumentSymbol[] = [];
        const visit = (list: vscode.DocumentSymbol[]) => {
            for (const symbol of list) {
                if (symbol.range && symbol.selectionRange && symbol.range.start.line <= node.line - 1 && symbol.range.end.line >= node.line - 1) { candidates.push(symbol); }
                if (symbol.children) { visit(symbol.children); }
            }
        };
        visit(symbols || []);
        const symbol = candidates.sort((a, b) => (a.range.end.line - a.range.start.line) - (b.range.end.line - b.range.start.line))[0];
        const textLine = doc.lineAt(Math.min(node.line - 1, doc.lineCount - 1));
        const position = symbol?.selectionRange.start || new vscode.Position(textLine.lineNumber, Math.max(0, textLine.text.indexOf(node.name)));
        const items = await deadline(vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', doc.uri, position));
        if (!items?.length) { return 'Call Hierarchy unavailable or unresolved. Static estimates are shown; missing edges are unknown.'; }
        const warnings: string[] = [];
        const ownerSymbols = new Map<string, Promise<vscode.DocumentSymbol[] | undefined>>();
        ownerSymbols.set(node.file, Promise.resolve(symbols));
        const convert = async (item: vscode.CallHierarchyItem): Promise<GraphNode | undefined> => {
            if (item.uri.scheme !== 'file') { return undefined; }
            const target = await fs.promises.realpath(item.uri.fsPath).catch(() => '');
            if (!target || !isInside(root, target)) { return undefined; }
            let className: string | undefined;
            if (item.kind === vscode.SymbolKind.Method || item.kind === vscode.SymbolKind.Constructor) {
                if (!ownerSymbols.has(target)) {
                    ownerSymbols.set(target, deadline(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                        'vscode.executeDocumentSymbolProvider', item.uri)).catch(() => []));
                }
                const findOwner = (list: vscode.DocumentSymbol[]) => {
                    for (const symbol of list) {
                        if (!symbol.range || symbol.range.start.line > item.selectionRange.start.line || symbol.range.end.line < item.selectionRange.start.line) { continue; }
                        if (symbol.kind === vscode.SymbolKind.Class) { className = symbol.name; }
                        if (symbol.children) { findOwner(symbol.children); }
                    }
                };
                findOwner(await ownerSymbols.get(target) || []);
            }
            return addNode({ id: `${target}:${item.selectionRange.start.line + 1}:${item.name}`, file: target,
                line: item.selectionRange.start.line + 1, endLine: item.range.end.line + 1, name: item.name, className,
                symbolKind: item.kind === vscode.SymbolKind.Method || item.kind === vscode.SymbolKind.Constructor ? 'method' : item.kind === vscode.SymbolKind.Class ? 'class' : 'function',
                queryScore: null, similarity: null, unresolved: null });
        };
        for (const item of items.slice(0, 3)) {
            const results = await Promise.allSettled([
                deadline(vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item)),
                deadline(vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', item))
            ]);
            if (disposed) { return ''; }
            for (let direction = 0; direction < results.length; direction++) {
                const result = results[direction];
                if (result.status === 'rejected' || (result.value === null || result.value === undefined)) { warnings.push(direction === 0 ? 'Callers unresolved.' : 'Callees unresolved.'); continue; }
                if (result.value.length > MAX_NODES) { warnings.push('Some calls omitted by the node limit.'); }
                for (const call of result.value.slice(0, MAX_NODES)) {
                    const target = await convert('from' in call ? call.from : call.to);
                    if (target) { addEdge({ source: direction === 0 ? target.id : node.id,
                        target: direction === 0 ? node.id : target.id, kind: 'call', evidence: 'provider',
                        sites: (call.fromRanges || []).map(range => ({ file: direction === 0 ? target.file : node.file,
                            line: range.start.line + 1, column: range.start.character,
                            endLine: range.end.line + 1, endColumn: range.end.character })) }); }
                }
            }
        }
        return `Language provider checked. ${warnings.join(' ')} External workspace calls are omitted.`;
    }
    async function expand(filePath: string, line: number, similar: boolean, reset = false) {
        if (busy || disposed) { return; }
        busy = true;
        post({ type: 'busy', busy: true });
        const current = ++generation;
        let selected = [...nodes.values()].find(n => n.file === filePath && n.line === line);
        const warnings: string[] = [];
        try {
            if (reset) { nodes.clear(); edges.clear(); }
            for (const [key, edge] of edges) { if (edge.kind === 'similar') { edges.delete(key); } }
            for (const node of nodes.values()) { node.similarity = null; }
            try {
                const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...request, directory: root, file: filePath, line, similar }),
                    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
                if (!response.ok) {
                    const error = await response.json() as { detail?: string | { message?: string } };
                    throw new Error(typeof error.detail === 'string' ? error.detail : error.detail?.message || `Graph server: ${response.status}`);
                }
                const data = await response.json() as GraphData & { cancelled?: boolean };
                if (data.cancelled) { throw new Error('Graph operation cancelled'); }
                if (disposed) { return; }
                const ids = new Map<string, string>();
                // Add the requested center first, even when the graph reaches its limit.
                data.nodes.sort((a, b) => Number(b.id === data.center) - Number(a.id === data.center));
                for (const node of data.nodes) {
                    node.file = await fs.promises.realpath(node.file).catch(() => '');
                    if (!node.file || !isInside(root, node.file)) { continue; }
                    const merged = addNode(node);
                    if (merged) {
                        merged.queryScore = node.queryScore; merged.similarity = node.similarity; merged.unresolved = node.unresolved;
                        if (node.className) { merged.className = node.className; }
                        if (node.symbolKind && (!merged.symbolKind || node.symbolKind !== 'function')) { merged.symbolKind = node.symbolKind; }
                        ids.set(node.id, merged.id);
                    }
                }
                for (const edge of data.edges) { addEdge({ ...edge, source: ids.get(edge.source) || edge.source, target: ids.get(edge.target) || edge.target }); }
                selected = nodes.get(ids.get(data.center) || data.center);
                if (data.truncated) { warnings.push('Neighborhood truncated.'); }
                if (!data.embeddingsAvailable) { warnings.push('No current embeddings: run a semantic search to enable similarity.'); }
            } catch (error) { warnings.push(String(error instanceof Error ? error.message : error)); }
            if (!selected || !nodes.has(selected.id)) {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
                const safeLine = Math.min(Math.max(1, line), doc.lineCount);
                selected = addNode({ id: `${filePath}:${safeLine}`, file: filePath, line: safeLine, endLine: safeLine,
                    name: doc.lineAt(safeLine - 1).text.trim().slice(0, 70) || path.basename(filePath),
                    queryScore: null, similarity: null, unresolved: null });
            }
            if (selected) {
                if (!initial || reset) { initial = selected.id; }
                try { warnings.push(await enrich(selected)); }
                catch (error) { warnings.push(`Call Hierarchy unresolved: ${error instanceof Error ? error.message : String(error)}`); }
            }
            if (current === generation) {
                post({ type: 'graph', nodes: [...nodes.values()], edges: [...edges.values()], selected: selected?.id,
                    initial, reset, query: request.query, root, status: `${nodes.size}/${MAX_NODES} nodes. ${warnings.join(' ')}${nodes.size >= MAX_NODES ? ' Node limit reached; reset to explore another neighborhood.' : ''}` });
                synchronizedSelection = undefined;
                await syncFromEditor(vscode.window.visibleTextEditors.find(editor => editor.viewColumn === vscode.ViewColumn.Two));
            }
        } catch (error) { post({ type: 'error', message: String(error) }); }
        finally {
            busy = false; post({ type: 'busy', busy: false });
            if (queuedRequest && !disposed) {
                const next = queuedRequest; queuedRequest = undefined;
                await session.show(next);
            }
        }
    }
    const session = { root, close: () => panel.dispose(), show: async (next: GraphRequest) => {
        if (busy) { queuedRequest = next; ++latestSelection; return; }
        request = next;
        panel.reveal(vscode.ViewColumn.One);
        if (graphSideBySide(resource)) {
            await preview({ id: '', file: next.file, line: next.line, endLine: next.line, name: '',
                queryScore: null, similarity: null, unresolved: null }, true);
        }
        if (ready) { await expand(next.file, next.line, false, true); }
    } };
    currentGraph = session;
    panel.webview.onDidReceiveMessage(async message => {
        try {
            if (message.type === 'ready') {
                ready = true;
                post({ type: 'settings', ...graphSettings(resource) });
                await session.show(request);
            }
            if (message.type === 'setSideBySide' && typeof message.enabled === 'boolean') {
                await updateGraphSideBySide(message.enabled, resource);
                post({ type: 'settings', ...graphSettings(resource) });
                const selected = nodes.get(message.id);
                if (message.enabled && selected) { await preview(selected, true); }
                return;
            }
            if (message.type === 'reset') { await expand(request.file, request.line, !!message.similar, true); }
            if (message.type === 'openCall') {
                const edge = edges.get(`${message.source}:${message.target}:call`);
                const caller = edge && nodes.get(edge.source);
                const sites = edge?.sites?.filter(site => caller && site.file === caller.file && site.line >= caller.line && site.line <= caller.endLine);
                if (!caller || !sites?.length) { post({ type: 'error', message: 'Call location is unavailable for this relation.' }); return; }
                const site = sites.length === 1 ? sites[0] : (await vscode.window.showQuickPick(
                    sites.map(site => ({ label: `${path.basename(site.file)}:${site.line}`, description: `Column ${site.column + 1}`, site })),
                    { placeHolder: 'Choose a call location' }))?.site;
                if (site) { await preview(caller, false, site); post({ type: 'selection', id: caller.id }); }
                return;
            }
            const node = nodes.get(message.id);
            if (!node) { return; }
            if (message.type === 'expand') { await expand(node.file, node.line, !!message.similar); }
            if (message.type === 'select' && graphSideBySide(resource)) { await preview(node, true); }
            if (message.type === 'open') { await preview(node, false); }
        } catch (error) { post({ type: 'error', message: String(error) }); }
    });
}
