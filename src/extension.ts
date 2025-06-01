// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

// インデントベースで関数の範囲を検出する関数
async function getFunctionRangeByIndent(doc: vscode.TextDocument, startPos: vscode.Position): Promise<vscode.Range> {
	const text = doc.getText();
	const lines = text.split('\n');
	const startLine = startPos.line;
	
	// 関数定義行のインデントレベルを取得
	const defLine = lines[startLine];
	const defIndent = defLine.length - defLine.trimStart().length;
	
	// 実際の関数本体の開始位置を特定
	let actualBodyStart = startLine;
	let actualBodyIndent = -1;
	
	// Python関数の場合：defで始まり:で終わる完全な定義を探す
	if (defLine.includes('def ')) {
		let colonFound = false;
		
		// 複数行に渡る関数定義を処理
		for (let i = startLine; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			
			// コロンが見つかった
			if (trimmed.includes(':')) {
				colonFound = true;
				// コロンの後に続く最初の実コード行を探す
				for (let j = i + 1; j < lines.length; j++) {
					const bodyLine = lines[j];
					const bodyTrimmed = bodyLine.trim();
					
					// 空行やコメント行はスキップ
					if (!bodyTrimmed || bodyTrimmed.startsWith('#')) {
						continue;
					}
					
					// 実際の関数本体を発見
					const bodyLineIndent = bodyLine.length - bodyLine.trimStart().length;
					if (bodyLineIndent > defIndent) {
						actualBodyStart = j;
						actualBodyIndent = bodyLineIndent;
						break;
					}
				}
				break;
			}
		}
		
		// コロンが見つからない場合は、より深いインデントの最初の行を探す
		if (!colonFound) {
			for (let i = startLine + 1; i < lines.length; i++) {
				const line = lines[i];
				const trimmed = line.trim();
				
				if (!trimmed || trimmed.startsWith('#')) {
					continue;
				}
				
				const lineIndent = line.length - line.trimStart().length;
				if (lineIndent > defIndent) {
					actualBodyStart = i;
					actualBodyIndent = lineIndent;
					break;
				}
			}
		}
	}
	
	// TypeScript/JavaScript関数の場合
	else if (defLine.includes('function ') || defLine.includes('=>') || defLine.includes('(')) {
		let braceFound = false;
		
		// 複数行に渡る関数定義を処理
		for (let i = startLine; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			
			// 開きブレースが見つかった
			if (trimmed.includes('{')) {
				braceFound = true;
				// ブレースの後に続く最初の実コード行を探す
				for (let j = i + 1; j < lines.length; j++) {
					const bodyLine = lines[j];
					const bodyTrimmed = bodyLine.trim();
					
					// 空行やコメント行はスキップ
					if (!bodyTrimmed || bodyTrimmed.startsWith('//') || bodyTrimmed.startsWith('*')) {
						continue;
					}
					
					// 実際の関数本体を発見
					const bodyLineIndent = bodyLine.length - bodyLine.trimStart().length;
					if (bodyLineIndent > defIndent) {
						actualBodyStart = j;
						actualBodyIndent = bodyLineIndent;
						break;
					}
				}
				break;
			}
		}
		
		// ブレースが見つからない場合（アロー関数など）
		if (!braceFound) {
			for (let i = startLine + 1; i < lines.length; i++) {
				const line = lines[i];
				const trimmed = line.trim();
				
				if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
					continue;
				}
				
				const lineIndent = line.length - line.trimStart().length;
				if (lineIndent > defIndent) {
					actualBodyStart = i;
					actualBodyIndent = lineIndent;
					break;
				}
			}
		}
	}
	
	// 関数の終了行を見つける
	let endLine = actualBodyStart;
	const baseIndentForComparison = actualBodyIndent !== -1 ? defIndent : defIndent;
	
	for (let i = actualBodyStart + 1; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		
		// 空行やコメント行はスキップして続行
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('*')) {
			endLine = i; // 空行も含める
			continue;
		}
		
		// 現在行のインデントレベルを取得
		const currentIndent = line.length - line.trimStart().length;
		
		// インデントが関数定義と同じかそれより浅い場合、関数終了
		if (currentIndent <= baseIndentForComparison) {
			break;
		}
		
		endLine = i;
	}
	
	// 関数定義のインデント位置から開始して、関数全体をカバー
	return new vscode.Range(
		new vscode.Position(startLine, defIndent),
		new vscode.Position(endLine, lines[endLine]?.length || 0)
	);
}

// インデントベースでクラスの範囲を検出する関数
async function getClassRangeByIndent(doc: vscode.TextDocument, startPos: vscode.Position): Promise<vscode.Range> {
	const text = doc.getText();
	const lines = text.split('\n');
	const startLine = startPos.line;
	
	// クラス定義行のインデントレベルを取得
	const defLine = lines[startLine];
	const defIndent = defLine.length - defLine.trimStart().length;
	
	// クラスの終了行を見つける
	let endLine = startLine;
	for (let i = startLine + 1; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		
		// 空行やコメント行はスキップして続行
		if (!trimmed || trimmed.startsWith('#')) {
			endLine = i; // 空行も含める
			continue;
		}
		
		// 現在行のインデントレベルを取得
		const currentIndent = line.length - line.trimStart().length;
		
		// インデントがクラス定義と同じかそれより浅い場合、クラス終了
		if (currentIndent <= defIndent) {
			break;
		}
		
		endLine = i;
	}
	
	// クラス定義のインデント位置から開始して、クラス全体をカバー
	return new vscode.Range(
		new vscode.Position(startLine, defIndent),
		new vscode.Position(endLine, lines[endLine]?.length || 0)
	);
}

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
					clearAllDecorations();
					
					// --- イベントリスナーをセットアップ ---
					setupDecorationListeners();

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
							// さらに外側のクラス（入れ子の場合）
							let outerCls = (parent as any).parent;
							while (outerCls && outerCls.kind !== vscode.SymbolKind.Class) { outerCls = outerCls.parent; }
							if (outerCls && outerCls.kind === vscode.SymbolKind.Class) {
								const outerClassDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255,0,128,0.07)' }); // pink for outer class, very subtle
								decorations.push({ type: outerClassDeco, ranges: [outerCls.range] });
							}
						}
						
						// インデントベースで関数の終わりを検出
						const funcRange = await getFunctionRangeByIndent(doc, target.range.start);
						const funcDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(0,128,255,0.2)' }); // blue highlight, less intense
						decorations.push({ type: funcDeco, ranges: [funcRange] });
					} else if (target && target.kind === vscode.SymbolKind.Class) {
						// クラス自体を選択している場合 - インデントベースで範囲を検出
						const classRange = await getClassRangeByIndent(doc, target.range.start);
						const selfClassDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(0,200,100,0.10)' }); // green highlight, subtle, no border
						decorations.push({ type: selfClassDeco, ranges: [classRange] });
						// さらに外側のクラス（入れ子の場合）
						let outerCls = parentSymbol;
						while (outerCls && outerCls.kind !== vscode.SymbolKind.Class) { outerCls = (outerCls as any).parent; }
						if (outerCls && outerCls.kind === vscode.SymbolKind.Class) {
							const outerClassDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255,0,128,0.07)' }); // pink for outer class, very subtle
							decorations.push({ type: outerClassDeco, ranges: [outerCls.range] });
						}
					}
					
					// --- デコレーションを適用し、グローバル変数に保存 ---
					lastEditor = editor;
					for (const deco of decorations) {
						editor.setDecorations(deco.type, deco.ranges);
						activeDecorations.push(deco.type);
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

// ハイライト用のグローバル変数（複数のデコレーションを管理）
let activeDecorations: vscode.TextEditorDecorationType[] = [];
let lastEditor: vscode.TextEditor | null = null;
let editorChangeListener: vscode.Disposable | null = null;
let selectionChangeListener: vscode.Disposable | null = null;

// デコレーション管理用のヘルパー関数
function clearAllDecorations() {
	if (activeDecorations.length > 0 && lastEditor) {
		for (const decoration of activeDecorations) {
			lastEditor.setDecorations(decoration, []);
			decoration.dispose();
		}
		activeDecorations = [];
	}
}

function setupDecorationListeners() {
	// 既存のリスナーを削除
	if (editorChangeListener) {
		editorChangeListener.dispose();
	}
	if (selectionChangeListener) {
		selectionChangeListener.dispose();
	}

	// エディタ切り替え時のデコレーションクリア
	editorChangeListener = vscode.window.onDidChangeActiveTextEditor(() => {
		clearAllDecorations();
		lastEditor = null;
	});

	// マウスクリック時のデコレーションクリア（スクロールは無視）
	selectionChangeListener = vscode.window.onDidChangeTextEditorSelection((e) => {
		if (e.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
			clearAllDecorations();
			lastEditor = null;
		}
	});
}

// 拡張機能設定の監視とPythonサーバーへの反映
function updatePythonServerConfig() {
	const config = vscode.workspace.getConfiguration('owlspotlight');
	const batchSize = config.get<number>('batchSize', 32);
	// .envファイルに書き込む
	const fs = require('fs');
	const path = require('path');
	const serverDir = path.join(__dirname, '..', 'model_server');
	const envPath = path.join(serverDir, '.env');
	let envContent = '';
	if (fs.existsSync(envPath)) {
		envContent = fs.readFileSync(envPath, 'utf8');
	}
	const lines = envContent.split(/\r?\n/).filter((l: string) => !l.startsWith('OWLSETTINGS_BATCH_SIZE='));
	lines.push(`OWLSETTINGS_BATCH_SIZE=${batchSize}`);
	fs.writeFileSync(envPath, lines.join('\n'));
}

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

	// 設定変更時にPythonサーバーの設定を更新
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('owlspotlight.batchSize')) {
				updatePythonServerConfig();
			}
		})
	);
	// 拡張機能起動時にも反映
	updatePythonServerConfig();

	// デコレーションリスナーのセットアップ
	setupDecorationListeners();
}

export function deactivate() {}
