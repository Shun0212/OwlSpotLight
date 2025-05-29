// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

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
					webviewView.webview.postMessage({ type: 'error', message: 'ワークスペースフォルダが見つかりません' });
					return;
				}
				const folderPath = workspaceFolders[0].uri.fsPath;
				webviewView.webview.postMessage({ type: 'status', message: 'インデックス構築中...' });
				await fetch('http://localhost:8000/build_index', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ directory: folderPath, file_ext: '.py' })
				});
				webviewView.webview.postMessage({ type: 'status', message: '検索中...' });
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
					const decorationType = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255,0,0,0.3)' });
					editor.setDecorations(decorationType, [new vscode.Range(pos, pos.translate(1, 0))]);

					// --- クラス範囲検出とハイライト ---
					const text = doc.getText();
					const lines = text.split('\n');
					let classStart = -1;
					let classEnd = -1;
					let funcIndent = lines[lineNum].search(/\S|$/); // 関数のインデント
					// 上方向にclassを探す
					for (let i = lineNum; i >= 0; i--) {
						const l = lines[i];
						if (/^\s*class\s+\w+/.test(l)) {
							classStart = i;
							break;
						}
					}
					// 前回のクラスハイライトを消す
					if (lastClassDeco) {
						for (const ed of vscode.window.visibleTextEditors) {
							ed.setDecorations(lastClassDeco, []);
						}
						lastClassDeco.dispose();
						lastClassDeco = null;
						lastClassEditor = null;
					}
					if (classStart !== -1) {
						// クラスのインデント
						const classIndent = lines[classStart].search(/\S|$/);
						// ジャンプした関数が本当にクラス内か判定
						if (funcIndent > classIndent) {
							for (let i = classStart + 1; i < lines.length; i++) {
								const l = lines[i];
								if (l.trim() === '') { continue; }
								const indent = l.search(/\S|$/);
								// クラス宣言より同じか浅いインデントでdef/class宣言行が出てきたら、その直前まで
								if (indent <= classIndent && i > classStart && (/^\s*def\s+\w+/.test(l) || /^\s*class\s+\w+/.test(l))) {
									classEnd = i - 1;
									break;
								}
							}
							if (classEnd === -1) { classEnd = lines.length - 1; }
							// クラス範囲をハイライト
							const classDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(0,128,255,0.15)' });
							const startPos = new vscode.Position(classStart, 0);
							const endPos = new vscode.Position(classEnd, lines[classEnd].length);
							editor.setDecorations(classDeco, [new vscode.Range(startPos, endPos)]);
							// 新しいクラスハイライトを記録
							lastClassDeco = classDeco;
							lastClassEditor = editor;
						}
					}
					// --- ここまでクラス範囲ハイライト ---

					// --- 関数呼び出し箇所のハイライト ---
					if (msg.funcName) {
						// ワークスペース全体で関数呼び出し箇所を検索
						const funcName = msg.funcName;
						const files = await vscode.workspace.findFiles('**/*.py', '**/site-packages/**');
						for (const f of files) {
							try {
								const d = await vscode.workspace.openTextDocument(f);
								const t = d.getText();
								const callRegex = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
								let match;
								const callRanges: vscode.Range[] = [];
								while ((match = callRegex.exec(t)) !== null) {
									const start = t.slice(0, match.index).split('\n').length - 1;
									const lineText = d.lineAt(start).text;
									const charIdx = lineText.indexOf(funcName);
									if (charIdx !== -1) {
										callRanges.push(new vscode.Range(new vscode.Position(start, charIdx), new vscode.Position(start, charIdx + funcName.length)));
									}
								}
								if (callRanges.length > 0) {
									const ed = await vscode.window.showTextDocument(d, { preview: false, preserveFocus: true });
									const callDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255,255,0,0.25)' });
									ed.setDecorations(callDeco, callRanges);
									setTimeout(() => {
										ed.setDecorations(callDeco, []);
										callDeco.dispose();
									}, 2000);
								}
							} catch (e) { /* ignore */ }
						}
					}
					// --- ここまで関数呼び出し箇所ハイライト ---

					setTimeout(() => {
						editor.setDecorations(decorationType, []);
						decorationType.dispose();
					}, 1500);
				} catch (e) {
					vscode.window.showErrorMessage('ファイルを開けませんでした: ' + file);
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
  <div class="searchbar">
    <input id="searchInput" type="text" placeholder="Search by function name or code snippet..." />
    <button id="searchBtn">Search</button>
  </div>
  <div class="status" id="status"></div>
  <div class="results" id="results"></div>
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
			vscode.window.showInformationMessage('サイドバーから検索してください');
		})
	);

	// サーバー起動コマンドはそのまま
	const startServerDisposable = vscode.commands.registerCommand('owlspotlight.startServer', async () => {
		const serverDir = path.join(context.extensionPath, 'model_server');
		const terminal = vscode.window.createTerminal({
			name: 'OwlSpotlight Server',
			cwd: serverDir // model_serverディレクトリで必ず起動
		});
		// venv有効化+uvicorn起動
		terminal.sendText('source .venv/bin/activate', true);
		terminal.sendText('uvicorn server:app --host 127.0.0.1 --port 8000 --reload', true);
		terminal.show();
		vscode.window.showInformationMessage('OwlSpotlightサーバーを新しいターミナルで起動しました');
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
		// pyenvが入っているかチェックし、なければインストール案内
		terminal.sendText('if ! command -v pyenv >/dev/null 2>&1; then echo "[OwlSpotlight] pyenv is not installed. Please install pyenv first. For example: brew install pyenv"; exit 1; fi', true);
		// Python 3.11がpyenvで入っているかチェックし、なければインストール案内
		terminal.sendText('if ! pyenv versions --bare | grep -q "^3.11"; then echo "[OwlSpotlight] Python 3.11 is not installed in pyenv. Please run: pyenv install 3.11"; exit 1; fi', true);
		// pyenv local 3.11 & venv作成
		terminal.sendText('pyenv local 3.11', true);
		terminal.sendText('python3.11 -m venv .venv', true);
		terminal.sendText('source .venv/bin/activate', true);
		terminal.sendText('pip install --upgrade pip', true);
		terminal.sendText('pip install -r requirements.txt', true);
		vscode.window.showInformationMessage('OwlSpotlight Python 3.11環境セットアップコマンドを新しいターミナルで実行しました。pyenvやPython 3.11が未インストールの場合は指示に従ってください。完了後にサーバーを起動してください。');
	});
	context.subscriptions.push(setupEnvDisposable);
}

export function deactivate() {}
