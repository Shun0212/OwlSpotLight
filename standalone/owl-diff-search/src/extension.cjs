'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { WorkerClient, findPython, runProcess, managedPython, exists } = require('./worker.cjs');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;' }[ch]));
}

function html(webview, extensionUri) {
  const nonce = crypto.randomBytes(18).toString('base64');
  const resource = name => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name));
  return [
    '<!doctype html><html lang="ja"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src ' +
      webview.cspSource + '; script-src \'nonce-' + nonce + '\';">',
    '<link rel="stylesheet" href="' + escapeHtml(resource('style.css')) + '">',
    '<title>Owl Diff Search</title></head><body>',
    '<header><div class="eyebrow">OWL DIFF SEARCH</div><h1>変更を、意図から探す</h1>',
    '<p>Git の差分だけを検索します。</p></header>',
    '<section class="setup"><span id="engineStatus">ローカル検索</span>',
    '<button id="setup" class="secondary" type="button">検索エンジンを準備</button>',
    '<p>自然言語検索は初回準備が必要です。Keyword / BM25 は Git と Python で使えます。</p></section>',
    '<form id="searchForm"><fieldset id="controls">',
    '<label for="repo">リポジトリ</label><select id="repo"></select>',
    '<label for="query">どんな変更を探しますか？</label>',
    '<textarea id="query" rows="3" placeholder="例: リトライ処理を追加した変更" maxlength="8000"></textarea>',
    '<label for="comparison">比較方法</label><select id="comparison">',
    '<option value="working">作業中の変更</option><option value="range">2つのコミットを比較</option>',
    '<option value="history">コミット履歴を検索</option></select>',
    '<p id="scopeHint" class="hint"></p>',
    '<div class="ref-row"><label for="base">Base</label><input id="base" placeholder="空欄 = HEAD">',
    '<button type="button" id="pickBase" class="secondary" aria-label="Base を履歴から選択">選択</button></div>',
    '<div class="ref-row"><label for="head">Head</label><input id="head" placeholder="空欄 = HEAD">',
    '<button type="button" id="pickHead" class="secondary" aria-label="Head を履歴から選択">選択</button></div>',
    '<div class="columns"><div><label for="target">検索対象</label><select id="target">',
    '<option value="hunks">差分 (Unified diff)</option><option value="functions">変更された関数</option>',
    '</select></div><div><label for="mode">検索方法</label><select id="mode">',
    '<option value="hybrid">Hybrid</option><option value="semantic">Semantic</option>',
    '<option value="bm25">BM25</option><option value="keyword">Keyword</option></select></div></div>',
    '<p id="modeHint" class="hint"></p>',
    '<details><summary>ファイル条件・件数</summary>',
    '<label for="include">対象ファイル（カンマ区切り）</label>',
    '<input id="include" placeholder="**/*.py, **/*.ts">',
    '<label for="exclude">除外ファイル（カンマ区切り）</label>',
    '<input id="exclude" placeholder="**/tests/**, **/*.lock">',
    '<label class="check"><input id="untracked" type="checkbox" checked>未追跡ファイルも含む</label>',
    '<label for="limit">最大表示件数</label><select id="limit"><option>30</option><option>50</option>',
    '<option>100</option><option>200</option></select></details></fieldset>',
    '<div class="actions"><button id="search" type="submit">差分を検索</button>',
    '<button id="cancel" type="button" class="secondary" disabled>中止</button></div>',
    '<p class="hint">Ctrl / Cmd + Enter で検索。検索文を空にすると差分一覧を表示します。</p></form>',
    '<div id="status" role="status" aria-live="polite">検索を始めてください。</div>',
    '<div id="error" role="alert" hidden></div>',
    '<div id="warnings" class="hint" hidden></div>',
    '<main id="results" aria-label="検索結果" aria-busy="false"></main>',
    '<footer>コードはローカルで処理されます。<button id="logs" type="button" class="link">ログ</button></footer>',
    '<script nonce="' + nonce + '" src="' + escapeHtml(resource('main.js')) + '"></script>',
    '</body></html>'
  ].join('\n');
}

async function activate(context) {
  const output = vscode.window.createOutputChannel('Owl Diff Search');
  const storage = context.globalStorageUri.fsPath;
  await fs.mkdir(storage, { recursive: true });
  let client;
  let sequence = 0;
  let busy = false;
  let currentResults = new Map();
  let lastResponse;
  let setupToken;
  const snapshotTexts = new Map();
  const configuration = () => vscode.workspace.getConfiguration('owlDiff');
  const log = text => output.append(text);

  function trusted() {
    if (!vscode.workspace.isTrusted) throw new Error('この拡張は信頼済みワークスペースで利用できます。');
  }
  function folders() {
    return (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file');
  }
  function folder(index) {
    const selected = folders()[Number(index) || 0];
    if (!selected) throw new Error('Git リポジトリのフォルダーを VS Code で開いてください。');
    return selected;
  }
  async function getClient() {
    trusted();
    if (!client || client.disposed) {
      let git = 'git';
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      try {
        const api = gitExtension && (gitExtension.isActive ? gitExtension.exports : await gitExtension.activate());
        git = api?.getAPI(1)?.git?.path || git;
      } catch { /* Git on PATH remains available. */ }
      client = new WorkerClient({ storage, extensionPath: context.extensionPath,
        pythonPath: configuration().get('pythonPath', ''),
        modelName: configuration().get('modelName', 'Shuu12121/NightOwl-CodeEmbedding'),
        git, log });
    }
    return client;
  }

  function stop() {
    ++sequence;
    client?.dispose();
    client = undefined;
    setupToken?.cancel();
    busy = false;
    provider.post({ type: 'busy', value: false });
  }

  async function search(input = {}) {
    trusted();
    const selected = folder(input.repo);
    const request = {
      directory: selected.uri.fsPath,
      query: String(input.query || ''),
      comparison: input.comparison || 'working',
      base: String(input.base || ''), head: String(input.head || ''),
      mode: input.mode || 'hybrid', target: input.target || 'hunks',
      include: String(input.include || ''), exclude: String(input.exclude || ''),
      untracked: input.untracked !== false,
      limit: Number(input.limit) || 30,
      max_files: configuration().get('maxFiles', 300),
      max_commits: configuration().get('maxCommits', 100)
    };
    const worker = await getClient();
    const response = await worker.request('search', request,
      message => provider.post({ type: 'progress', message }));
    currentResults = new Map(response.results.map(result => [result.id, result]));
    lastResponse = response;
    return response;
  }

  async function openResult(id, asDocument = false) {
    trusted();
    const result = currentResults.get(id);
    if (!result) throw new Error('結果が更新されています。もう一度検索してください。');
    const worker = await getClient();
    const doc = await worker.request('document', { result_id: id });
    const oldName = doc.old_path || doc.new_path || 'deleted.txt';
    const newName = doc.new_path || doc.old_path || 'new.txt';
    const oldUri = vscode.Uri.from({ scheme: 'owl-diff', path: '/' + id + '/before/' + oldName });
    const newUri = vscode.Uri.from({ scheme: 'owl-diff', path: '/' + id + '/after/' + newName });
    snapshotTexts.set(oldUri.toString(), doc.old_text);
    snapshotTexts.set(newUri.toString(), doc.new_text);
    if (asDocument) {
      const side = doc.side === 'old' ? 'old' : 'new';
      const uri = side === 'old' ? oldUri : newUri;
      const document = await vscode.workspace.openTextDocument(uri);
      const line = Math.min(Math.max(0, (side === 'old' ? doc.old_line : doc.new_line) - 1), document.lineCount - 1);
      await vscode.window.showTextDocument(document, {
        preview: true, selection: new vscode.Range(line, 0, line, 0)
      });
    } else {
      const line = Math.min(Math.max(0, doc.new_line - 1), Math.max(0, doc.new_text.split('\n').length - 1));
      const title = result.path + '  (' + (doc.base ? doc.base.slice(0, 8) : 'empty') +
        ' → ' + (doc.head ? doc.head.slice(0, 8) : 'working tree') + ')';
      await vscode.commands.executeCommand('vscode.diff', oldUri, newUri, title, {
        preview: true, selection: new vscode.Range(line, 0, line, 0)
      });
    }
    // Keep open documents and a bounded set of recent snapshots.
    if (snapshotTexts.size > 400) {
      const open = new Set(vscode.workspace.textDocuments.map(document => document.uri.toString()));
      for (const key of snapshotTexts.keys()) {
        if (snapshotTexts.size <= 200) break;
        if (!open.has(key)) snapshotTexts.delete(key);
      }
    }
    return { oldUri, newUri };
  }

  async function setup() {
    trusted();
    if (busy) return;
    busy = true;
    provider.post({ type: 'busy', value: true });
    output.show(true);
    const tokenSource = new vscode.CancellationTokenSource();
    setupToken = tokenSource;
    client?.dispose();
    client = undefined;
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title: 'Owl Diff Search の準備', cancellable: true
      }, async (progress, cancellation) => {
        const subscription = cancellation.onCancellationRequested(() => tokenSource.cancel());
        const report = message => {
          progress.report({ message });
          provider.post({ type: 'progress', message });
        };
        const run = (command, args) => runProcess(command, args, {
          cwd: storage, token: tokenSource.token, log, timeout: 20 * 60 * 1000
        });
        try {
          if (!(await exists(managedPython(storage)))) {
            report('Python 環境を作成中');
            let hasUv = false;
            try { await runProcess('uv', ['--version'], { timeout: 5000 }); hasUv = true; } catch {}
            if (hasUv) {
              await run('uv', ['venv', '--seed', '--python', '3.11', path.join(storage, 'venv')]);
            } else {
              const python = await findPython({
                storage, pythonPath: configuration().get('pythonPath', ''), preferManaged: false
              });
              await run(python.command, [...python.args, '-m', 'venv', path.join(storage, 'venv')]);
            }
          }
          const python = managedPython(storage);
          report('PyTorch をインストール中');
          const torchArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', 'torch==2.7.1'];
          if (process.platform !== 'darwin') torchArgs.push('--index-url', 'https://download.pytorch.org/whl/cpu');
          await run(python, torchArgs);
          report('検索エンジンをインストール中');
          await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check',
            '-r', path.join(context.extensionPath, 'backend', 'requirements.txt')]);
          if (tokenSource.token.isCancellationRequested) throw new Error('処理を中止しました。');
          const worker = await getClient();
          const cancelWorker = tokenSource.token.onCancellationRequested(() => worker.dispose());
          try {
            await worker.request('warmup', {}, report);
          } finally { cancelWorker.dispose(); }
          await fs.writeFile(path.join(storage, 'setup-complete'), configuration().get('modelName', '') || 'default', 'utf8');
          provider.post({ type: 'configured' });
          vscode.window.showInformationMessage('Owl Diff Search の準備ができました。');
        } finally { subscription.dispose(); }
      });
    } finally {
      if (setupToken === tokenSource) setupToken = undefined;
      tokenSource.dispose();
      busy = false;
      provider.post({ type: 'busy', value: false });
    }
  }

  class SidebarProvider {
    post(message) { this.view?.webview.postMessage(message); }
    async workspaceMessage() {
      this.post({ type: 'workspaces', folders: folders().map((entry, index) =>
        ({ index, name: entry.name, path: entry.uri.fsPath })),
        configured: await exists(path.join(storage, 'setup-complete')) });
    }
    resolveWebviewView(view) {
      this.view = view;
      view.webview.options = { enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
      view.webview.html = html(view.webview, context.extensionUri);
      view.webview.onDidReceiveMessage(message => {
        this.handle(message).catch(error => {
          log(String(error.stack || error) + '\n');
          this.post({ type: 'error', message: error.message || String(error) });
        });
      }, undefined, context.subscriptions);
    }
    async handle(message) {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') {
        await this.workspaceMessage();
        this.post({ type: 'busy', value: busy });
        if (lastResponse) this.post({ type: 'results', response: lastResponse });
      } else if (message.type === 'search') {
        if (busy) return;
        const ticket = ++sequence;
        busy = true;
        this.post({ type: 'busy', value: true });
        try {
          const response = await search(message.values);
          if (ticket === sequence) this.post({ type: 'results', response });
        } catch (error) {
          if (ticket === sequence) this.post({ type: 'error', message: error.message });
        } finally {
          if (ticket === sequence) {
            busy = false; this.post({ type: 'busy', value: false });
          }
        }
      } else if (message.type === 'cancel') {
        stop();
        this.post({ type: 'progress', message: '中止しました。' });
      } else if (message.type === 'setup') {
        await setup();
      } else if (message.type === 'pickRef') {
        if (busy || !['base', 'head'].includes(message.field)) return;
        const worker = await getClient();
        const entries = await worker.request('refs', { directory: folder(message.repo).uri.fsPath });
        const chosen = await vscode.window.showQuickPick(entries, {
          title: message.field === 'base' ? 'Base を選択' : 'Head を選択',
          placeHolder: 'ブランチ・タグ・最近のコミット', matchOnDescription: true
        });
        if (chosen) this.post({ type: 'ref', field: message.field, value: chosen.ref });
      } else if (message.type === 'open' && !busy) {
        await openResult(String(message.id), Boolean(message.asDocument));
      } else if (message.type === 'logs') {
        output.show();
      }
    }
  }

  const provider = new SidebarProvider();
  context.subscriptions.push(
    output,
    { dispose() { client?.dispose(); setupToken?.cancel(); } },
    vscode.workspace.registerTextDocumentContentProvider('owl-diff', {
      provideTextDocumentContent(uri) {
        const text = snapshotTexts.get(uri.toString());
        if (text === undefined) throw new Error('スナップショットがありません。再検索してください。');
        return text;
      }
    }),
    vscode.window.registerWebviewViewProvider('owlDiff.searchView', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('owlDiff.show', () =>
      vscode.commands.executeCommand('owlDiff.searchView.focus')),
    vscode.commands.registerCommand('owlDiff.setup', () => setup().catch(error =>
      vscode.window.showErrorMessage(error.message))),
    vscode.commands.registerCommand('owlDiff.cancel', () => stop()),
    vscode.commands.registerCommand('owlDiff.searchSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      const selected = editor?.document.getText(editor.selection);
      await vscode.commands.executeCommand('owlDiff.searchView.focus');
      if (selected) provider.post({ type: 'seed', query: selected.slice(0, 8000) });
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      stop(); currentResults.clear(); lastResponse = undefined;
      provider.workspaceMessage();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('owlDiff')) {
        stop();
        currentResults.clear();
        lastResponse = undefined;
        provider.post({ type: 'progress', message: '設定を更新しました。もう一度検索してください。' });
      }
    })
  );

  // Small integration API, also used by the real Extension Host smoke test.
  return { search, openResult, cancel: stop, version: '0.1.0' };
}

module.exports = { activate };
