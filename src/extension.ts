// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

// クラス外にgetNonceを定義
function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

// WebviewViewProviderでサイドバーUIをリッチ化
class OwlspotlightSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'owlspotlight.sidebar';
	private _view?: vscode.WebviewView;

	constructor(private readonly _context: vscode.ExtensionContext) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._context.extensionUri]
		};
		webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

		// Webviewからのメッセージ受信
		webviewView.webview.onDidReceiveMessage(async (msg) => {
			if (msg.command === 'search') {
				const query = msg.text;
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					webviewView.webview.postMessage({ type: 'error', message: 'No workspace folder found' });
					return;
				}
				const folderPath = workspaceFolders[0].uri.fsPath;
				webviewView.webview.postMessage({ type: 'status', message: 'Building index...' });
				await fetch('http://localhost:8000/build_index', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ directory: folderPath, file_ext: '.py' })
				});
				webviewView.webview.postMessage({ type: 'status', message: 'Searching...' });
				const res = await fetch('http://localhost:8000/search_functions_simple', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ directory: folderPath, query, top_k: 10 })
				});
				const data: any = await res.json();
				if (data && data.results && Array.isArray(data.results) && data.results.length > 0) {
					webviewView.webview.postMessage({ type: 'results', results: data.results, folderPath });
				} else {
					webviewView.webview.postMessage({ type: 'results', results: [], folderPath });
				}
			}
			if (msg.command === 'getClassStats') {
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					webviewView.webview.postMessage({ type: 'error', message: 'No workspace folder found' });
					return;
				}
				const folderPath = workspaceFolders[0].uri.fsPath;
				const query = msg.query || ''; // クエリパラメータを受け取る
				webviewView.webview.postMessage({ type: 'status', message: 'Loading class statistics...' });
				try {
					const res = await fetch('http://localhost:8000/get_class_stats', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ directory: folderPath, query: query, top_k: 50 })
					});
					const data: any = await res.json();
					webviewView.webview.postMessage({ type: 'classStats', data, folderPath });
				} catch (error) {
					webviewView.webview.postMessage({ type: 'error', message: 'Failed to load statistics. Make sure the server is running.' });
				}
			}
			if (msg.command === 'jump') {
				const file = msg.file;
				const line = msg.line;
				try {
					const uri = vscode.Uri.file(file);
					const doc = await vscode.workspace.openTextDocument(uri);
					const editor = await vscode.window.showTextDocument(doc);
					const lineNum = Number(line) - 1;
					const pos = new vscode.Position(lineNum > 0 ? lineNum : 0, 0);
					editor.selection = new vscode.Selection(pos, pos);
					editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
					// --- 既存のデコレーションをクリア ---
					if (lastClassDeco && lastClassEditor) {
						lastClassEditor.setDecorations(lastClassDeco, []);
						lastClassDeco.dispose();
						lastClassDeco = null;
						lastClassEditor = null;
					}

					// --- エディタ切り替え時のみデコレーションを消す ---
					vscode.window.onDidChangeActiveTextEditor(() => {
						if (lastClassDeco && lastClassEditor) {
							lastClassEditor.setDecorations(lastClassDeco, []);
							lastClassDeco.dispose();
							lastClassDeco = null;
							lastClassEditor = null;
						}
					});
					vscode.window.onDidChangeTextEditorSelection((e) => {
						// クリック時のみ消す（カーソル移動は残す）
						if (e.kind === vscode.TextEditorSelectionChangeKind.Mouse && lastClassDeco && lastClassEditor) {
							lastClassEditor.setDecorations(lastClassDeco, []);
							lastClassDeco.dispose();
							lastClassDeco = null;
							lastClassEditor = null;
						}
					});

					// --- ASTベースの関数 & クラス範囲ハイライト ---
					const decorations: { type: vscode.TextEditorDecorationType, ranges: vscode.Range[] }[] = [];
					// 行（ジャンプ先1行）
					const decorationType = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255,255,0,0.5)' }); // yellow highlight
					const lineRange = new vscode.Range(pos, pos.translate(1, 0));
					decorations.push({ type: decorationType, ranges: [lineRange] });

					let symbols: vscode.DocumentSymbol[] | undefined = [];
					try {
						symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
							'vscode.executeDocumentSymbolProvider',
							doc.uri
						) ?? [];
					} catch (e) {
						symbols = [];
					}
					function findSymbol(list: vscode.DocumentSymbol[], pos: vscode.Position): vscode.DocumentSymbol | undefined {
						for (const s of list) {
							if (s.range.contains(pos)) {
								// 子を優先（入れ子対応）
								return findSymbol(s.children, pos) ?? s;
							}
						}
						return undefined;
					}
					function findSymbolWithParent(list: vscode.DocumentSymbol[], pos: vscode.Position, parent: vscode.DocumentSymbol | null = null): { symbol: vscode.DocumentSymbol, parent: vscode.DocumentSymbol | null } | undefined {
						for (const s of list) {
							if (s.range.contains(pos)) {
								// 子を優先（入れ子対応）
								const found = findSymbolWithParent(s.children, pos, s);
								return found ?? { symbol: s, parent };
							}
						}
						return undefined;
					}
					const found = findSymbolWithParent(symbols, pos);
					let target: vscode.DocumentSymbol | undefined = undefined;
					let parentSymbol: vscode.DocumentSymbol | null = null;
					if (found) {
						target = found.symbol;
						parentSymbol = found.parent;
					}
					// 関数・メソッド
					if (target && (target.kind === vscode.SymbolKind.Function || target.kind === vscode.SymbolKind.Method)) {
						// 親をたどって所属クラスを取得
						let parent = parentSymbol;
						while (parent && parent.kind !== vscode.SymbolKind.Class) {
							parent = (parent as any).parent;
						}
						if (parent && parent.kind === vscode.SymbolKind.Class) {
							const selfClassDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(0,200,100,0.10)' }); // green highlight, subtle, no border
							decorations.push({ type: selfClassDeco, ranges: [parent.range] });
							lastClassDeco = selfClassDeco;
							lastClassEditor = editor;
							// さらに外側のクラス（入れ子の場合）
							let outerCls = (parent as any).parent;
							while (outerCls && outerCls.kind !== vscode.SymbolKind.Class) { outerCls = outerCls.parent; }
							if (outerCls && outerCls.kind === vscode.SymbolKind.Class) {
								const outerClassDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255,0,128,0.07)' }); // pink for outer class, very subtle
								decorations.push({ type: outerClassDeco, ranges: [outerCls.range] });
							}
						}
						// 最後に関数部分をデコレーション
						const funcDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(0,128,255,0.2)' }); // blue highlight, less intense
						decorations.push({ type: funcDeco, ranges: [target.range] });
						lastClassDeco = funcDeco;
						lastClassEditor = editor;
					} else if (target && target.kind === vscode.SymbolKind.Class) {
						// クラス自体を選択している場合
						const selfClassDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(0,200,100,0.10)' }); // green highlight, subtle, no border
						decorations.push({ type: selfClassDeco, ranges: [target.range] });
						lastClassDeco = selfClassDeco;
						lastClassEditor = editor;
						// さらに外側のクラス（入れ子の場合）
						let outerCls = parentSymbol;
						while (outerCls && outerCls.kind !== vscode.SymbolKind.Class) { outerCls = (outerCls as any).parent; }
						if (outerCls && outerCls.kind === vscode.SymbolKind.Class) {
							const outerClassDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255,0,128,0.07)' }); // pink for outer class, very subtle
							decorations.push({ type: outerClassDeco, ranges: [outerCls.range] });
						}
					}
					// --- まとめて適用 ---
					for (const deco of decorations) {
						editor.setDecorations(deco.type, deco.ranges);
					}
				} catch (e) {
					vscode.window.showErrorMessage('Could not open file: ' + file);
				}
			}
			if (msg.command === 'startServer') {
				console.log('[OwlSpotlight] startServer command received from Webview');
				// Webviewからのサーバー起動要求はコマンド経由で実行
				void vscode.commands.executeCommand('owlspotlight.startServer');
			}
		});
	}

	getHtmlForWebview(webview: vscode.Webview): string {
		const nonce = getNonce();
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js')
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'media', 'styles.css')
		);
		return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      img-src ${webview.cspSource} https:;
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src 'nonce-${nonce}';
      connect-src http://127.0.0.1:8000 ${webview.cspSource};
    ">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OwlSpotlight</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div class="header">🦉 OwlSpotLight</div>
  <div class="actions">
    <button id="startServerBtn">Start Server</button>
  </div>
  
  <!-- タブナビゲーション -->
  <div class="tabs">
    <button class="tab-btn active" data-tab="search">Search</button>
    <button class="tab-btn" data-tab="stats">Class Stats</button>
  </div>
  
  <!-- 検索タブ -->
  <div class="tab-content active" id="search-tab">
    <div class="searchbar">
      <input id="searchInput" type="text" placeholder="Search by function name or code snippet..." />
      <button id="searchBtn">Search</button>
    </div>
    <div class="status" id="status"></div>
    <div class="results" id="results"></div>
  </div>
  
  <!-- クラス統計タブ -->
  <div class="tab-content" id="stats-tab">
    <div class="stats-filter">
      <button id="loadStatsBtn">Load Class Statistics</button>
      <select id="statsFilter">
        <option value="all">All Classes & Functions</option>
        <option value="classes">Classes Only</option>
        <option value="functions">Standalone Functions Only</option>
      </select>
    </div>
    <div class="status" id="stats-status"></div>
    <div class="stats-results" id="stats-results"></div>
  </div>
  
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

// クラス範囲ハイライト用のグローバル変数
let lastClassDeco: vscode.TextEditorDecorationType | null = null;
let lastClassEditor: vscode.TextEditor | null = null;

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "owlspotlight" is now active!');

	// サイドバーWebviewViewProvider登録
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			OwlspotlightSidebarProvider.viewType,
			new OwlspotlightSidebarProvider(context)
		)
	);

	// コマンドパレットからの検索コマンドはサイドバーを開く動作に変更
	context.subscriptions.push(
		vscode.commands.registerCommand('owlspotlight.searchCode', async () => {
			// 正しいView IDでサイドバーを開く
			await vscode.commands.executeCommand('workbench.view.extension.owlspotlight');
			vscode.commands.executeCommand('owlspotlight.sidebar.focus');
			vscode.window.showInformationMessage('Please use the sidebar to search.');
		})
	);

	// サーバー起動コマンドはそのまま
	const startServerDisposable = vscode.commands.registerCommand('owlspotlight.startServer', async () => {
		const serverDir = path.join(context.extensionPath, 'model_server');
		const terminal = vscode.window.createTerminal({
			name: 'OwlSpotlight Server',
			cwd: serverDir // model_serverディレクトリで必ず起動
		});
		const platform = os.platform();
		if (platform === 'win32') {
			// Windows用: venv有効化+uvicorn起動
			terminal.sendText('.\\.venv\\Scripts\\activate', true);
			terminal.sendText('uvicorn server:app --host 127.0.0.1 --port 8000 --reload', true);
		} else {
			// macOS/Linux用
			terminal.sendText('source .venv/bin/activate', true);
			terminal.sendText('uvicorn server:app --host 127.0.0.1 --port 8000 --reload', true);
		}
		terminal.show();
		vscode.window.showInformationMessage('OwlSpotlight server started in a new terminal.');
	});
	context.subscriptions.push(startServerDisposable);

	// --- 環境セットアップコマンドを追加 ---
	const setupEnvDisposable = vscode.commands.registerCommand('owlspotlight.setupEnv', async () => {
		const serverDir = path.join(context.extensionPath, 'model_server');
		const terminal = vscode.window.createTerminal({
			name: 'OwlSpotlight Setup',
			cwd: serverDir
		});
		terminal.show();
		const platform = os.platform();
		if (platform === 'win32') {
			// Windows用: pyenvチェックはスキップ
			terminal.sendText('python -m venv .venv', true);
			terminal.sendText('.\\.venv\\Scripts\\activate', true);
			terminal.sendText('python -m pip install --upgrade pip', true);
			terminal.sendText('pip install -r requirements.txt', true);
			vscode.window.showInformationMessage('OwlSpotlight Python環境セットアップコマンドをWindows用で実行しました。完了後にサーバーを起動してください。');
		} else {
			// macOS/Linux用: pyenvチェックあり
			terminal.sendText('if ! command -v pyenv >/dev/null 2>&1; then echo "[OwlSpotlight] pyenv is not installed. Please install pyenv first. For example: brew install pyenv"; exit 1; fi', true);
			terminal.sendText('if ! pyenv versions --bare | grep -q "^3.11"; then echo "[OwlSpotlight] Python 3.11 is not installed in pyenv. Please run: pyenv install 3.11"; exit 1; fi', true);
			terminal.sendText('pyenv local 3.11', true);
			terminal.sendText('python3.11 -m venv .venv', true);
			terminal.sendText('source .venv/bin/activate', true);
			terminal.sendText('pip install --upgrade pip', true);
			terminal.sendText('pip install -r requirements.txt', true);
			vscode.window.showInformationMessage('OwlSpotlight Python 3.11環境セットアップコマンドをmacOS/Linux用で実行しました。pyenvやPython 3.11が無い場合は指示に従ってください。完了後にサーバーを起動してください。');
		}
	});
	context.subscriptions.push(setupEnvDisposable);
}

export function deactivate() {}
