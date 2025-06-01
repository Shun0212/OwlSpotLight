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
			if (msg.command === 'openExternal' && msg.url) {
				try {
					await vscode.env.openExternal(vscode.Uri.parse(msg.url));
				} catch (e) {
					vscode.window.showErrorMessage('Failed to open URL: ' + msg.url);
				}
				return;
			}
			if (msg.command === 'search') {
				// サーバー起動チェック
				let serverUp = true;
				try {
					const statusRes = await fetch('http://localhost:8000/index_status');
					if (!statusRes.ok) { serverUp = false; }
				} catch (e) {
					serverUp = false;
				}
				if (!serverUp) {
					await vscode.window.showWarningMessage(
						'The search server is not running. Please start the server from the sidebar or command palette.',
						{ modal: true },
						'OK'
					);
					return;
				}
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
						
						// クラス部分を先に薄くハイライト（関数が上書きするため）
						if (parent && parent.kind === vscode.SymbolKind.Class) {
							const classRange = await getClassRangeByIndent(doc, parent.range.start);
							const classBackgroundDeco = vscode.window.createTextEditorDecorationType({ 
								backgroundColor: 'rgba(0,200,100,0.10)' // very light green background for class
							});
							decorations.push({ type: classBackgroundDeco, ranges: [classRange] });
							
							// クラス定義行のみを強調
							const classDefLine = new vscode.Range(
								parent.range.start, 
								new vscode.Position(parent.range.start.line, parent.range.end.character)
							);
							const classHeaderDeco = vscode.window.createTextEditorDecorationType({ 
								backgroundColor: 'rgba(0,200,100,0.12)',
								border: '1px solid rgba(0,200,100,0.4)'
							});
							decorations.push({ type: classHeaderDeco, ranges: [classDefLine] });
							
							// さらに外側のクラス（入れ子の場合）
							let outerCls = (parent as any).parent;
							while (outerCls && outerCls.kind !== vscode.SymbolKind.Class) { outerCls = outerCls.parent; }
							if (outerCls && outerCls.kind === vscode.SymbolKind.Class) {
								const outerClassDeco = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255,0,128,0.07)' }); // pink for outer class, very subtle
								decorations.push({ type: outerClassDeco, ranges: [outerCls.range] });
							}
						}
						
						// 関数・メソッド自体を最後にハイライト（優先表示のため）
						const funcRange = await getFunctionRangeByIndent(doc, target.range.start);
						const funcDeco = vscode.window.createTextEditorDecorationType({ 
							backgroundColor: 'rgba(0,128,255,0.10)', // stronger blue highlight for function
							border: '1px solid rgba(0,128,255,0.4)',  // blue border for function
						});
						decorations.push({ type: funcDeco, ranges: [funcRange] });
					} else if (target && target.kind === vscode.SymbolKind.Class) {
						// クラス自体を選択している場合 - クラス構造を可視化
						const classRange = await getClassRangeByIndent(doc, target.range.start);
						
						// クラス全体に薄い背景色
						const selfClassDeco = vscode.window.createTextEditorDecorationType({ 
							backgroundColor: 'rgba(0,200,100,0.10)',
							border: '1px solid rgba(0,200,100,0.2)'
						}); // very light green highlight for class body
						decorations.push({ type: selfClassDeco, ranges: [classRange] });
						
						// クラスのヘッダー部分（定義行）を強調
						const classHeaderDeco = vscode.window.createTextEditorDecorationType({ 
							backgroundColor: 'rgba(0,200,100,0.15)',
							border: '2px solid rgba(0,200,100,0.4)'
						}); // stronger green highlight for class header
						
						// クラス定義行のみをハイライト
						const classDefLine = new vscode.Range(
							target.range.start, 
							new vscode.Position(target.range.start.line, target.range.end.character)
						);
						decorations.push({ type: classHeaderDeco, ranges: [classDefLine] });
						
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
			if (msg.command === 'clearCache') {
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					webviewView.webview.postMessage({ type: 'error', message: 'No workspace folder found' });
					return;
				}
				const folderPath = workspaceFolders[0].uri.fsPath;
				webviewView.webview.postMessage({ type: 'status', message: 'Clearing cache and rebuilding index...' });
				try {
					const res = await fetch('http://localhost:8000/force_rebuild_index', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ directory: folderPath, file_ext: '.py' })
					});
					const data = await res.json();
					const msg = typeof data === 'object' && data && 'message' in data ? (data as any).message : undefined;
					webviewView.webview.postMessage({ type: 'status', message: msg || 'Cache cleared and index rebuilt.' });
				} catch (error) {
					webviewView.webview.postMessage({ type: 'error', message: 'Failed to clear cache. Make sure the server is running.' });
				}
			}
			if (msg.command === 'removeVenv') {
				webviewView.webview.postMessage({ type: 'status', message: 'Removing virtual environment...' });
				try {
					await vscode.commands.executeCommand('owlspotlight.removeVenv');
					webviewView.webview.postMessage({ type: 'status', message: 'Virtual environment removal completed.' });
				} catch (error) {
					webviewView.webview.postMessage({ type: 'error', message: 'Failed to remove virtual environment.' });
				}
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
		const helpUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'media', 'help.html')
		);
		const owlPngUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, 'media', 'owl.png')
		);
		return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OwlSpotlight</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div class="header">
    OwlSpotLight
    <div class="header-btns">
      <button class="owl-btn" id="repoBtn" title="Open GitHub Repository">
        <img src="${owlPngUri}" alt="GitHub" style="height:1.6em;width:1.6em;vertical-align:middle;" />
      </button>
      <button class="help-btn" id="helpBtn" title="Help"><span aria-label="help" role="img">💡</span></button>
    </div>
  </div>
  <div class="actions">
    <button id="startServerBtn">Start Server</button>
    <button id="clearCacheBtn">Clear Cache</button>
  </div>
  <!-- ヘルプモーダル -->
  <div id="helpModal">
    <div class="modal-content">
      <span class="close" id="closeHelpModal">&times;</span>
      <div id="helpContent">Loading...</div>
    </div>
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
      <select id="statsFilter">
        <option value="all">All Classes & Functions</option>
        <option value="classes">Classes Only</option>
        <option value="functions">Standalone Functions Only</option>
      </select>
      <button id="loadStatsBtn">Load</button>
    </div>
    <div class="status" id="stats-status"></div>
    <div class="stats-results" id="stats-results"></div>
  </div>
  <script nonce="${nonce}">
    window.HELP_HTML_URI = "${helpUri}";
    window.OWL_REPO_URL = "https://github.com/Shun0212/owlspotlight";
  </script>
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
	const cacheSettings = config.get<any>('cacheSettings', {});
	const envSettings = config.get<any>('environmentSettings', {});
	
	// .envファイルに書き込む
	const fs = require('fs');
	const path = require('path');
	const serverDir = path.join(__dirname, '..', 'model_server');
	const envPath = path.join(serverDir, '.env');
	let envContent = '';
	if (fs.existsSync(envPath)) {
		envContent = fs.readFileSync(envPath, 'utf8');
	}
	const lines = envContent.split(/\r?\n/).filter((l: string) => 
		!l.startsWith('OWL_BATCH_SIZE=') &&
		!l.startsWith('OWLSETTINGS_BATCH_SIZE=') &&
		!l.startsWith('OWLSETTINGS_AUTO_CLEAR_CACHE=') &&
		!l.startsWith('OWLSETTINGS_AUTO_CLEAR_LOCAL_CACHE=') &&
		!l.startsWith('OWLSETTINGS_CACHE_PATH=') &&
		!l.startsWith('OWLSETTINGS_PYTHON_VERSION=')
	);
	lines.push(`OWL_BATCH_SIZE=${batchSize}`);
	lines.push(`OWLSETTINGS_AUTO_CLEAR_CACHE=${cacheSettings.autoClearCache || false}`);
	lines.push(`OWLSETTINGS_AUTO_CLEAR_LOCAL_CACHE=${cacheSettings.autoClearLocalCache || false}`);
	lines.push(`OWLSETTINGS_CACHE_PATH=${cacheSettings.cachePath || ''}`);
	lines.push(`OWLSETTINGS_PYTHON_VERSION=${envSettings.pythonVersion || '3.11'}`);
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
		const config = vscode.workspace.getConfiguration('owlspotlight');
		const cacheSettings = config.get<any>('cacheSettings', {});
		const autoClearCache = cacheSettings.autoClearCache || false;
		const serverDir = path.join(context.extensionPath, 'model_server');
		const venvDir = path.join(serverDir, '.venv');
		const fs = require('fs');

		// 仮想環境がなければ作成を促す
		if (!fs.existsSync(venvDir)) {
			const result = await vscode.window.showWarningMessage(
				'No Python virtual environment (.venv) found. Would you like to set it up now?',
				{ modal: true },
				'Yes, Setup',
				'Cancel'
			);
			if (result === 'Yes, Setup') {
				await vscode.commands.executeCommand('owlspotlight.setupEnv');
				return;
			} else {
				vscode.window.showInformationMessage('Server start cancelled. Please set up the Python virtual environment before starting the server.');
				return;
			}
		}

		if (autoClearCache) {
			try {
				await vscode.commands.executeCommand('owlspotlight.clearCache');
				vscode.window.showInformationMessage('Cache cleared automatically before starting server.');
			} catch (error) {
				vscode.window.showWarningMessage(`Failed to auto-clear cache: ${error}`);
			}
		}
		let terminal: vscode.Terminal | undefined;
		let serverStartFailed = false;
		try {
			terminal = vscode.window.createTerminal({
				name: 'OwlSpotlight Server',
				cwd: serverDir
			});
			const platform = os.platform();
			if (platform === 'win32') {
				terminal.sendText('.\\.venv\\Scripts\\activate', true);
				terminal.sendText('uvicorn server:app --host 127.0.0.1 --port 8000 --reload', true);
			} else {
				terminal.sendText('source .venv/bin/activate', true);
				terminal.sendText('uvicorn server:app --host 127.0.0.1 --port 8000 --reload', true);
			}
			terminal.show();
			vscode.window.showInformationMessage('OwlSpotlight server started in a new terminal.');
		} catch (err) {
			vscode.window.showErrorMessage('Failed to launch the OwlSpotlight server terminal. Please make sure you have created the Python virtual environment (e.g., run "OwlSpotlight: Setup Python Environment") and installed all dependencies.');
			return;
		}
		// Listen for terminal exit (failure to start)
		const disposable = vscode.window.onDidCloseTerminal((closedTerminal) => {
			if (closedTerminal === terminal && !serverStartFailed) {
				vscode.window.showErrorMessage('OwlSpotlight server terminal was closed before startup completed. Please make sure you have created the Python virtual environment (e.g., run "OwlSpotlight: Setup Python Environment") and installed all dependencies.');
			}
		});
		context.subscriptions.push(disposable);
	});
	context.subscriptions.push(startServerDisposable);

	// --- 環境セットアップコマンドを追加 ---
	const setupEnvDisposable = vscode.commands.registerCommand('owlspotlight.setupEnv', async () => {
		const config = vscode.workspace.getConfiguration('owlspotlight');
		const envSettings = config.get<any>('environmentSettings', {});
		const autoRemoveVenv = envSettings.autoRemoveVenv || false;
		const pythonVersion = envSettings.pythonVersion || '3.11';
		
		const serverDir = path.join(context.extensionPath, 'model_server');
		const venvDir = path.join(serverDir, '.venv');
		const fs = require('fs');
		
		// 自動削除設定がオンの場合、既存の仮想環境を削除
		if (autoRemoveVenv && fs.existsSync(venvDir)) {
			try {
				fs.rmSync(venvDir, { recursive: true, force: true });
				vscode.window.showInformationMessage('Existing virtual environment removed automatically.');
			} catch (error) {
				vscode.window.showWarningMessage(`Failed to remove existing virtual environment: ${error}`);
			}
		}
		
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
			vscode.window.showInformationMessage('OwlSpotlight Python environment setup command executed for Windows. Please start the server after setup completes.');
		} else {
			// macOS/Linux用: pyenvチェックあり
			terminal.sendText('if ! command -v pyenv >/dev/null 2>&1; then echo "[OwlSpotlight] pyenv is not installed. Please install pyenv first. For example: brew install pyenv"; exit 1; fi', true);
			terminal.sendText(`if ! pyenv versions --bare | grep -q "^${pythonVersion}"; then echo "[OwlSpotlight] Python ${pythonVersion} is not installed in pyenv. Please run: pyenv install ${pythonVersion}"; exit 1; fi`, true);
			terminal.sendText(`pyenv local ${pythonVersion}`, true);
			terminal.sendText(`python${pythonVersion} -m venv .venv`, true);
			terminal.sendText('source .venv/bin/activate', true);
			terminal.sendText('pip install --upgrade pip', true);
			terminal.sendText('pip install -r requirements.txt', true);
			vscode.window.showInformationMessage(`OwlSpotlight Python ${pythonVersion} environment setup command executed for macOS/Linux. Please ensure pyenv and Python ${pythonVersion} are installed. Start the server after setup completes.`);
		}
	});
	context.subscriptions.push(setupEnvDisposable);

	// --- キャッシュクリアコマンドを追加 ---
	const clearCacheDisposable = vscode.commands.registerCommand('owlspotlight.clearCache', async () => {
		const config = vscode.workspace.getConfiguration('owlspotlight');
		const cacheSettings = config.get<any>('cacheSettings', {});
		const customCachePath = cacheSettings.cachePath || '';
		
		const serverDir = path.join(context.extensionPath, 'model_server');
		const fs = require('fs');
		
		try {
			// メインのキャッシュディレクトリ
			const mainCacheDir = path.join(serverDir, '__pycache__');
			if (fs.existsSync(mainCacheDir)) {
				fs.rmSync(mainCacheDir, { recursive: true, force: true });
			}
			
			// .owl_index ディレクトリの内容を削除 (server-side cache)
			const owlIndexDir = path.join(serverDir, '.owl_index');
			if (fs.existsSync(owlIndexDir)) {
				// ディレクトリの中身だけを削除し、ディレクトリ自体は残す
				const items = fs.readdirSync(owlIndexDir);
				for (const item of items) {
					const itemPath = path.join(owlIndexDir, item);
					fs.rmSync(itemPath, { recursive: true, force: true });
				}
				console.log('Cleared .owl_index directory contents');
			}
			
			// カスタムキャッシュパスが指定されている場合
			if (customCachePath && fs.existsSync(customCachePath)) {
				const customCacheFiles = ['index_cache.pkl', 'embeddings_cache.pkl', 'cluster_cache.pkl'];
				for (const file of customCacheFiles) {
					const filePath = path.join(customCachePath, file);
					if (fs.existsSync(filePath)) {
						fs.unlinkSync(filePath);
					}
				}
			}
			
			// デフォルトのキャッシュファイルを削除
			const cacheFiles = [
				'index_cache.pkl',
				'embeddings_cache.pkl',
				'cluster_cache.pkl'
			];
			
			for (const file of cacheFiles) {
				const filePath = path.join(serverDir, file);
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);
				}
			}
			
			vscode.window.showInformationMessage('OwlSpotlight cache cleared successfully (including .owl_index directory contents).');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to clear cache: ${error}`);
		}
	});
	context.subscriptions.push(clearCacheDisposable);

	// --- 仮想環境削除コマンドを追加 ---
	const removeVenvDisposable = vscode.commands.registerCommand('owlspotlight.removeVenv', async () => {
		const serverDir = path.join(context.extensionPath, 'model_server');
		const venvDir = path.join(serverDir, '.venv');
		const fs = require('fs');
		
		try {
			if (fs.existsSync(venvDir)) {
				const result = await vscode.window.showWarningMessage(
					'Are you sure you want to remove the virtual environment? This will delete all installed packages.',
					{ modal: true },
					'Yes, Remove',
					'Cancel'
				);
				
				if (result === 'Yes, Remove') {
					fs.rmSync(venvDir, { recursive: true, force: true });
					vscode.window.showInformationMessage('Virtual environment removed successfully. Run "Setup Python Environment" to recreate it.');
				}
			} else {
				vscode.window.showInformationMessage('No virtual environment found to remove.');
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to remove virtual environment: ${error}`);
		}
	});
	context.subscriptions.push(removeVenvDisposable);

	// 設定変更時にPythonサーバーの設定を更新
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('owlspotlight.batchSize') || 
				e.affectsConfiguration('owlspotlight.cacheSettings') ||
				e.affectsConfiguration('owlspotlight.environmentSettings')) {
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
