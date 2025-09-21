// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

// Translate Japanese query to English using Gemini API
async function translateJapaneseToEnglish(text: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('owlspotlight');
    // フラットな設定取得に対応
    const enabled = config.get<boolean>('enableJapaneseTranslation', false);
    const geminiApiKey = config.get<string>('geminiApiKey', '');
    // 追加設定を取得 (将来の拡張用)
    const tSettings = config.get<any>('translationSettings', {});
    
    if (!enabled) {
        return text;
    }
    
    const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(text);
    if (!hasJapanese) {
        return text;
    }
    
    return await translateWithGemini(text, { ...tSettings, geminiApiKey });
}

// Gemini APIを使用した翻訳
async function translateWithGemini(text: string, tSettings: any): Promise<string> {
    try {
        const geminiApiKey = tSettings.geminiApiKey || tSettings.translationApiKey || '';
        
        if (!geminiApiKey) {
            vscode.window.showWarningMessage('Gemini API key is not configured. Please set it in settings.');
            return text;
        }
        
        // Dynamic import of the new Gemini API
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        
        const prompt = `Translate the following Japanese text to English. Only return the translated text, nothing else:\n\n${text}`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
        });
        
        // Geminiのレスポンス仕様に合わせてテキスト抽出
        let translatedText = '';
        if (response && typeof response.text === 'string') {
            translatedText = response.text.trim();
        } else if (response && response.candidates && response.candidates[0]?.content?.parts) {
            translatedText = response.candidates[0].content.parts.map((p: any) => p.text).join('').trim();
        } else {
            translatedText = text;
        }
        return translatedText || text;
        
    } catch (e: any) {
        console.error('Gemini translation error:', e);
        vscode.window.showWarningMessage('Gemini translation failed: ' + e.message);
        return text;
    }
}


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

// ワークスペース内の言語を自動検出
async function detectLanguages(): Promise<string[]> {
        const patterns = [
                { glob: '**/*.py', ext: '.py' },
                { glob: '**/*.java', ext: '.java' },
                { glob: '**/*.ts', ext: '.ts' }
        ];
        const detected: string[] = [];
        for (const p of patterns) {
                const files = await vscode.workspace.findFiles(p.glob, '**/node_modules/**', 1);
                if (files.length > 0) {
                        detected.push(p.ext);
                }
        }
        return detected;
}

// WebviewViewProviderでサイドバーUIをリッチ化
class OwlspotlightSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'owlspotlight.sidebar';
	private _view?: vscode.WebviewView;

	constructor(private readonly _context: vscode.ExtensionContext) {}

       async resolveWebviewView(
               webviewView: vscode.WebviewView,
               context: vscode.WebviewViewResolveContext,
               _token: vscode.CancellationToken
       ) {
               this._view = webviewView;
               webviewView.webview.options = {
                       enableScripts: true,
                       localResourceRoots: [this._context.extensionUri]
               };
               const langs = await detectLanguages();
               webviewView.webview.html = this.getHtmlForWebview(webviewView.webview, langs);

               const config = vscode.workspace.getConfiguration('owlspotlight');
                // フラットな設定取得に対応
                const enable = config.get<boolean>('enableJapaneseTranslation', false);
                webviewView.webview.postMessage({
                        type: 'translationSettings',
                        enable: enable
                });

                // 拡張側に保持している前回状態をWebviewへ送る
                try {
                        const persisted = this._context.workspaceState.get<any>('owlspotlight:webviewState');
                        if (persisted) {
                                webviewView.webview.postMessage({ type: 'initState', state: persisted });
                        }
                } catch {}

		// Webviewからのメッセージ受信
                webviewView.webview.onDidReceiveMessage(async (msg) => {
                        if (msg && msg.command === 'persistState') {
                                try {
                                        await this._context.workspaceState.update('owlspotlight:webviewState', msg.state ?? {});
                                } catch {}
                                return;
                        }
                        if (msg && msg.command === 'requestInitState') {
                                try {
                                        const persisted = this._context.workspaceState.get<any>('owlspotlight:webviewState');
                                        webviewView.webview.postMessage({ type: 'initState', state: persisted || null });
                                } catch {
                                        webviewView.webview.postMessage({ type: 'initState', state: null });
                                }
                                return;
                        }
                        if (msg.command === 'openExternal' && msg.url) {
				try {
					await vscode.env.openExternal(vscode.Uri.parse(msg.url));
				} catch (e) {
					vscode.window.showErrorMessage('Failed to open URL: ' + msg.url);
				}
				return;
                        }
                        if (msg.command === 'requestTranslationSettings') {
                                const config = vscode.workspace.getConfiguration('owlspotlight');
                                const enable = config.get<boolean>('enableJapaneseTranslation', false);
                                webviewView.webview.postMessage({ type: 'translationSettings', enable });
                        }
                        if (msg.command === 'updateTranslationSettings') {
                                const config = vscode.workspace.getConfiguration('owlspotlight');
                                if (typeof msg.enable === 'boolean') {
                                        await config.update('enableJapaneseTranslation', !!msg.enable, vscode.ConfigurationTarget.Global);
                                }
                                if (typeof msg.apiKey === 'string') {
                                        await config.update('geminiApiKey', msg.apiKey, vscode.ConfigurationTarget.Global);
                                }
                                const enable = config.get<boolean>('enableJapaneseTranslation', false);
                                webviewView.webview.postMessage({ type: 'translationSettings', enable });
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
                                let query = msg.text;
                                const originalQuery = query;
                                query = await translateJapaneseToEnglish(query);
                                // Always send both original and translated query to Webview for debugging
                                webviewView.webview.postMessage({ type: 'translatedQuery', original: originalQuery, translated: query });
                                const fileExt = msg.lang || '.py';
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					webviewView.webview.postMessage({ type: 'error', message: 'No workspace folder found' });
					return;
				}
				const folderPath = workspaceFolders[0].uri.fsPath;
				webviewView.webview.postMessage({ type: 'status', message: 'Searching...' });
				const res = await fetch('http://localhost:8000/search_functions_simple', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ directory: folderPath, query, top_k: 10, file_ext: fileExt })
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
                let query = msg.query || '';
                const originalQuery = query;
                query = await translateJapaneseToEnglish(query);
                webviewView.webview.postMessage({ type: 'translatedQuery', original: originalQuery, translated: query });
                const fileExt = msg.lang || '.py';
				webviewView.webview.postMessage({ type: 'status', message: 'Loading class statistics...' });
				try {
					const res = await fetch('http://localhost:8000/get_class_stats', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ directory: folderPath, query: query, top_k: 50, file_ext: fileExt })
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
				const functionName = msg.functionName;
				const className = msg.className;
				const startLine = msg.startLine;
				const endLine = msg.endLine;
				
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

					// --- サーバー提供の正確な範囲情報を使用したハイライト ---
					const decorations: { type: vscode.TextEditorDecorationType, ranges: vscode.Range[] }[] = [];
					
					// ジャンプ先行の黄色ハイライト
					const decorationType = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255,255,0,0.5)' });
					const lineRange = new vscode.Range(pos, pos.translate(1, 0));
					decorations.push({ type: decorationType, ranges: [lineRange] });

					// サーバーから提供された範囲情報を使用
					if (startLine && endLine && functionName) {
						const funcStartLine = Math.max(0, Number(startLine) - 1); // 0-based index
						const funcEndLine = Math.max(0, Number(endLine) - 1);
						
						// 関数/メソッドの範囲をハイライト（サーバー提供の正確な範囲）
						const serverFuncRange = new vscode.Range(
							new vscode.Position(funcStartLine, 0),
							new vscode.Position(funcEndLine, doc.lineAt(Math.min(funcEndLine, doc.lineCount - 1)).text.length)
						);
						
						// クラスメソッドかスタンドアロン関数かで色を分ける
						if (className) {
							// クラスメソッドの場合（緑系の色）
							const methodDeco = vscode.window.createTextEditorDecorationType({ 
								backgroundColor: 'rgba(0,128,255,0.12)', // blue background for method
								border: '1px solid rgba(0,128,255,0.3)'
							});
							decorations.push({ type: methodDeco, ranges: [serverFuncRange] });
							
							// クラス全体の範囲も取得してハイライト（VS Code ASTを補完的に使用）
							let symbols: vscode.DocumentSymbol[] = [];
							try {
								symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
									'vscode.executeDocumentSymbolProvider',
									doc.uri
								) ?? [];
							} catch (e) {
								symbols = [];
							}
							
							// クラス範囲をVS Code ASTで検索（補完的使用）
							function findClassSymbol(list: vscode.DocumentSymbol[], name: string): vscode.DocumentSymbol | undefined {
								for (const s of list) {
									if (s.kind === vscode.SymbolKind.Class && s.name === name) {
										return s;
									}
									// 子要素も再帰的に検索
									const found = findClassSymbol(s.children, name);
									if (found) {
										return found;
									}
								}
								return undefined;
							}
							
							const classSymbol = findClassSymbol(symbols, className);
							if (classSymbol) {
								// クラス範囲の薄いハイライト
								const classRange = await getClassRangeByIndent(doc, classSymbol.range.start);
								const classBackgroundDeco = vscode.window.createTextEditorDecorationType({ 
									backgroundColor: 'rgba(0,200,100,0.08)' // very light green background for class
								});
								decorations.push({ type: classBackgroundDeco, ranges: [classRange] });
								
								// クラス定義行のハイライト
								const classDefLineText = doc.lineAt(classSymbol.range.start.line).text;
								const classDefLine = new vscode.Range(
									classSymbol.range.start.line,
									0,
									classSymbol.range.start.line,
									classDefLineText.length
								);
								const classHeaderDeco = vscode.window.createTextEditorDecorationType({ 
									backgroundColor: 'rgba(0,200,100,0.12)',
									border: '1px solid rgba(0,200,100,0.4)'
								});
								decorations.push({ type: classHeaderDeco, ranges: [classDefLine] });
							}
						} else {
							// スタンドアロン関数の場合（オレンジ系の色）
							const funcDeco = vscode.window.createTextEditorDecorationType({ 
								backgroundColor: 'rgba(255,140,0,0.12)', // orange background for standalone function
								border: '1px solid rgba(255,140,0,0.3)'
							});
							decorations.push({ type: funcDeco, ranges: [serverFuncRange] });
						}
					} else {
						// 範囲情報がない場合は従来のVS Code ASTベースの処理にフォールバック
						console.log('[OwlSpotlight] No server range info, falling back to VS Code AST');
						let symbols: vscode.DocumentSymbol[] = [];
						try {
							symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
								'vscode.executeDocumentSymbolProvider',
								doc.uri
							) ?? [];
						} catch (e) {
							symbols = [];
						}
						
						function findSymbolWithParent(list: vscode.DocumentSymbol[], pos: vscode.Position, parent: vscode.DocumentSymbol | null = null): { symbol: vscode.DocumentSymbol, parent: vscode.DocumentSymbol | null } | undefined {
							for (const s of list) {
								if (s.range.contains(pos)) {
									const found = findSymbolWithParent(s.children, pos, s);
									return found ?? { symbol: s, parent };
								}
							}
							return undefined;
						}
						
						const found = findSymbolWithParent(symbols, pos);
						if (found && found.symbol && (found.symbol.kind === vscode.SymbolKind.Function || found.symbol.kind === vscode.SymbolKind.Method)) {
							const funcRange = await getFunctionRangeByIndent(doc, found.symbol.range.start);
							const funcDeco = vscode.window.createTextEditorDecorationType({ 
								backgroundColor: 'rgba(0,128,255,0.10)',
							});
							decorations.push({ type: funcDeco, ranges: [funcRange] });
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
                                const fileExt = msg.lang || '.py';
                                webviewView.webview.postMessage({ type: 'status', message: 'Clearing cache and rebuilding index...' });
				try {
					const res = await fetch('http://localhost:8000/force_rebuild_index', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ directory: folderPath, file_ext: fileExt })
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

       getHtmlForWebview(webview: vscode.Webview, languages: string[]): string {
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
                const langMap: { [key: string]: string } = { '.py': 'Python', '.java': 'Java', '.ts': 'TypeScript' };
                const options = (languages.length ? languages : ['.py']).map(l => `<option value="${l}">${langMap[l] || l}</option>`).join('');
                const selectStyle = (languages.length <= 1) ? 'style="display:none;"' : '';

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
  <div class="translation-settings">
    <label><input type="checkbox" id="translateToggle"> JP→EN</label>
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
      <select id="languageSelect" ${selectStyle}>
        ${options}
      </select>
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
    const defaultModelName = 'Shuu12121/CodeSearch-ModernBERT-Owl-v1';
    const defaultBatchSize = 32;
    const defaultPythonVersion = '3.11';
    // すべての設定値で空欄やnull/undefinedの場合はデフォルトを使う
    let batchSize = config.get<number>('batchSize', defaultBatchSize);
    if (!batchSize || typeof batchSize !== 'number' || isNaN(batchSize)) {
        batchSize = defaultBatchSize;
    }
    let cacheSettings = config.get<any>('cacheSettings', {});
    if (!cacheSettings || typeof cacheSettings !== 'object') {
        cacheSettings = {};
    }
    let envSettings = config.get<any>('environmentSettings', {});
    if (!envSettings || typeof envSettings !== 'object') {
        envSettings = {};
    }
    let modelName = config.get<string>('modelName', defaultModelName);
    if (!modelName || typeof modelName !== 'string' || modelName.trim() === '') {
        modelName = defaultModelName;
    }
    let pythonVersion = envSettings.pythonVersion || defaultPythonVersion;
    if (!pythonVersion || typeof pythonVersion !== 'string' || pythonVersion.trim() === '') {
        pythonVersion = defaultPythonVersion;
    }
    // キャッシュ設定の各値もデフォルトを適用
    const autoClearCache = typeof cacheSettings.autoClearCache === 'boolean' ? cacheSettings.autoClearCache : false;
    const autoClearLocalCache = typeof cacheSettings.autoClearLocalCache === 'boolean' ? cacheSettings.autoClearLocalCache : false;
    const cachePath = typeof cacheSettings.cachePath === 'string' ? cacheSettings.cachePath : '';

    const fs = require('fs');
    const path = require('path');
    const serverDir = path.join(__dirname, '..', 'model_server');
    const envPath = path.join(serverDir, '.env');
    let envContent = '';
    let prevModelConfig: any = {};
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
        // 既存のモデル名を取得
        const match = envContent.match(/^OWL_MODEL_NAME=(.*)$/m);
        if (match) {
            prevModelConfig.modelName = match[1].trim();
        } else {
            prevModelConfig.modelName = defaultModelName;
        }
    } else {
        prevModelConfig.modelName = defaultModelName;
    }
    // モデル名が変わった場合はキャッシュ削除
    if (prevModelConfig.modelName && prevModelConfig.modelName !== modelName) {
        try {
            const owlIndexDir = path.join(serverDir, '.owl_index');
            const cacheFiles = [
                'index_cache.pkl',
                'embeddings_cache.pkl',
                'cluster_cache.pkl'
            ];
            if (fs.existsSync(owlIndexDir)) {
                fs.rmSync(owlIndexDir, { recursive: true, force: true });
            }
            for (const file of cacheFiles) {
                const filePath = path.join(serverDir, file);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        } catch (err) {
            vscode.window.showWarningMessage('Failed to auto-clear cache for model change: ' + err);
        }
    }
    const lines = envContent.split(/\r?\n/).filter((l) =>
        !l.startsWith('OWL_BATCH_SIZE=') &&
        !l.startsWith('OWLSETTINGS_BATCH_SIZE=') &&
        !l.startsWith('OWLSETTINGS_AUTO_CLEAR_CACHE=') &&
        !l.startsWith('OWLSETTINGS_AUTO_CLEAR_LOCAL_CACHE=') &&
        !l.startsWith('OWLSETTINGS_CACHE_PATH=') &&
        !l.startsWith('OWLSETTINGS_PYTHON_VERSION=') &&
        !l.startsWith('OWL_MODEL_NAME=')
    );
    lines.push(`OWL_BATCH_SIZE=${batchSize}`);
    lines.push(`OWLSETTINGS_AUTO_CLEAR_CACHE=${autoClearCache}`);
    lines.push(`OWLSETTINGS_AUTO_CLEAR_LOCAL_CACHE=${autoClearLocalCache}`);
    lines.push(`OWLSETTINGS_CACHE_PATH=${cachePath}`);
    lines.push(`OWLSETTINGS_PYTHON_VERSION=${pythonVersion}`);
    lines.push(`OWL_MODEL_NAME=${modelName}`);
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
		let pythonVersion = envSettings.pythonVersion || '3.11';
		if (typeof pythonVersion !== 'string' || pythonVersion.trim() === '') {
			pythonVersion = '3.11';
		} else {
			pythonVersion = pythonVersion.trim();
		}

		const serverDir = path.join(context.extensionPath, 'model_server');
		const venvDir = path.join(serverDir, '.venv');
		const fs = require('fs');

		// Python 3.11が存在しなければインストール案内＆中断（Windows/macOS/Linuxすべて）
		const platform = os.platform();
		const numericPython = /^\d+(?:\.\d+)?$/;
		let pythonCommand = '';
		if (platform === 'win32') {
			pythonCommand = numericPython.test(pythonVersion)
				? `py -${pythonVersion}`
				: pythonVersion;
		} else {
			pythonCommand = numericPython.test(pythonVersion)
				? `python${pythonVersion}`
				: pythonVersion;
		}
		const pythonCheckCmd = `${pythonCommand} --version`;
		try {
			cp.execSync(pythonCheckCmd, { stdio: 'ignore' });
		} catch (e) {
			vscode.window.showErrorMessage(
				`Python ${pythonVersion} was not found.\n` +
				(platform === 'win32'
					? `Please install Python ${pythonVersion} from the official site (https://www.python.org/downloads/). After installation, restart VSCode and try setup again.`
					: `For macOS/Linux, install with \`brew install python@${pythonVersion}\` or from the official site (https://www.python.org/downloads/). After installation, restart VSCode and try setup again.`)
			);
			return;
		}

		const torchOptions: { label: string; description: string; value: 'cpu' | 'cuda' | 'skip' }[] = [
			{
				label: 'CPU (recommended)',
				description: 'Install the default CPU build of PyTorch.',
				value: 'cpu'
			},
			{
				label: 'CUDA 12.8 (GPU)',
				description: 'Install PyTorch from the official CUDA 12.8 wheel index (~3.6GB download).',
				value: 'cuda'
			},
			{
				label: 'Skip PyTorch installation',
				description: 'Prepare the environment without installing PyTorch.',
				value: 'skip'
			}
		];
		const torchChoice = await vscode.window.showQuickPick(torchOptions, {
			placeHolder: 'Select the PyTorch build to install during setup',
			ignoreFocusOut: true
		});
		if (!torchChoice) {
			vscode.window.showInformationMessage('OwlSpotlight Python environment setup cancelled.');
			return;
		}

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
		const scriptArgs: string[] = ['--torch-mode', torchChoice.value];
		if (autoRemoveVenv) {
			scriptArgs.push('--force-recreate');
		}
		const commandSegments: string[] = [];
		if (platform === 'win32') {
			if (numericPython.test(pythonVersion)) {
				commandSegments.push('py', `-${pythonVersion}`);
			} else {
				const needsQuoting = pythonCommand.includes(' ') && !pythonCommand.includes(' -');
				commandSegments.push(needsQuoting ? `"${pythonCommand}"` : pythonCommand);
			}
		} else {
			if (numericPython.test(pythonVersion)) {
				commandSegments.push(`python${pythonVersion}`);
			} else {
				const needsQuoting = pythonCommand.includes(' ') && !pythonCommand.includes(' -');
				commandSegments.push(needsQuoting ? `"${pythonCommand}"` : pythonCommand);
			}
		}
		commandSegments.push('bootstrap_env.py', ...scriptArgs);
		terminal.sendText(commandSegments.join(' '), true);
		vscode.window.showInformationMessage(
			`OwlSpotlight Python environment bootstrap started with ${torchChoice.label}. Monitor the terminal for progress and start the server after setup completes.`
		);
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
                        const mainCacheDir = path.join(serverDir, '__pycache__');
                        const owlIndexDir = path.join(serverDir, '.owl_index');

                        // 削除候補のディレクトリを収集
                        const dirOptions: vscode.QuickPickItem[] = [];
                        if (fs.existsSync(mainCacheDir)) {
                                dirOptions.push({ label: '__pycache__', description: mainCacheDir });
                        }
                        if (fs.existsSync(owlIndexDir)) {
                                const items = fs.readdirSync(owlIndexDir);
                                for (const item of items) {
                                        const itemPath = path.join(owlIndexDir, item);
                                        if (fs.statSync(itemPath).isDirectory()) {
                                                dirOptions.push({ label: path.join('.owl_index', item), description: itemPath });
                                        }
                                }
                        }

                        let selectedDirs: readonly vscode.QuickPickItem[] = [];
                        if (dirOptions.length > 0) {
                                selectedDirs = await vscode.window.showQuickPick(dirOptions, {
                                        canPickMany: true,
                                        placeHolder: 'Select cache folders to delete'
                                }) || [];
                        }

                        for (const dir of selectedDirs) {
                                const target = dir.description ?? dir.label;
                                if (fs.existsSync(target)) {
                                        fs.rmSync(target, { recursive: true, force: true });
                                }
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
			if (
				e.affectsConfiguration('owlspotlight.batchSize') ||
				e.affectsConfiguration('owlspotlight.cacheSettings') ||
				e.affectsConfiguration('owlspotlight.environmentSettings') ||
				e.affectsConfiguration('owlspotlight.modelName')
			) {
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
