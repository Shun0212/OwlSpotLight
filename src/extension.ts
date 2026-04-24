// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import * as net from 'net';
import * as fs from 'fs';

const DEFAULT_SERVER_HOST = '127.0.0.1';
const DEFAULT_SERVER_PORT = 8000;
const SERVER_PORT_SCAN_LIMIT = 20;
const CUDA_12_8_TORCH_INDEX = 'https://download.pytorch.org/whl/cu128';
const CUDA_12_4_TORCH_INDEX = 'https://download.pytorch.org/whl/cu124';
const CUDA_12_X_MIN_DRIVER = '527.41';
const CUDA_12_8_RECOMMENDED_DRIVER = '570.0';

let activeServerPort = DEFAULT_SERVER_PORT;

type TorchMode = 'auto' | 'cpu' | 'cuda' | 'skip';

type NvidiaGpuInfo = {
	available: boolean;
	driverVersion?: string;
	gpuName?: string;
};

type TorchInstallOption = {
	label: string;
	description: string;
	value: TorchMode;
	torchIndex?: string;
};

function parseVersion(version: string): number[] {
	return version
		.split('.')
		.map((part) => Number.parseInt(part, 10))
		.filter((part) => Number.isFinite(part));
}

function compareVersions(left: string, right: string): number {
	const leftParts = parseVersion(left);
	const rightParts = parseVersion(right);
	const maxLength = Math.max(leftParts.length, rightParts.length);

	for (let index = 0; index < maxLength; index++) {
		const leftPart = leftParts[index] ?? 0;
		const rightPart = rightParts[index] ?? 0;
		if (leftPart > rightPart) {
			return 1;
		}
		if (leftPart < rightPart) {
			return -1;
		}
	}

	return 0;
}

function detectNvidiaGpuInfo(): NvidiaGpuInfo {
	try {
		const output = cp.execFileSync(
			'nvidia-smi',
			['--query-gpu=name,driver_version', '--format=csv,noheader'],
			{ encoding: 'utf8' }
		).trim();
		if (!output) {
			return { available: false };
		}

		const [firstLine] = output.split(/\r?\n/);
		const [gpuName, driverVersion] = firstLine.split(',').map((part) => part.trim());
		if (!driverVersion) {
			return { available: false };
		}

		return {
			available: true,
			driverVersion,
			gpuName
		};
	} catch {
		return { available: false };
	}
}

function getUvCandidatePaths(platform: NodeJS.Platform): string[] {
	const homeDir = os.homedir();
	const candidates: string[] = [];

	if (platform === 'win32') {
		candidates.push(
			path.join(homeDir, '.local', 'bin', 'uv.exe'),
			path.join(homeDir, 'AppData', 'Local', 'Programs', 'uv', 'uv.exe')
		);

		const localAppData = process.env.LOCALAPPDATA;
		if (localAppData) {
			candidates.push(
				path.join(localAppData, 'Microsoft', 'WinGet', 'Packages', 'astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe', 'uv.exe')
			);
		}
	} else {
		candidates.push(
			path.join(homeDir, '.local', 'bin', 'uv'),
			path.join(homeDir, '.cargo', 'bin', 'uv')
		);
	}

	return candidates;
}

function resolveUvExecutable(): string | undefined {
	try {
		cp.execFileSync('uv', ['--version'], { stdio: 'ignore' });
		return 'uv';
	} catch {
		for (const candidate of getUvCandidatePaths(os.platform())) {
			if (!fs.existsSync(candidate)) {
				continue;
			}

			try {
				cp.execFileSync(candidate, ['--version'], { stdio: 'ignore' });
				return candidate;
			} catch {
				// Ignore unusable candidate and continue searching.
			}
		}
	}

	return undefined;
}

function getAutoTorchRecommendation(gpuInfo: NvidiaGpuInfo): { torchIndex?: string; reason: string } {
	if (!gpuInfo.available || !gpuInfo.driverVersion) {
		return {
			reason: 'No NVIDIA GPU detected. Falls back to the CPU build automatically.'
		};
	}

	if (compareVersions(gpuInfo.driverVersion, CUDA_12_8_RECOMMENDED_DRIVER) >= 0) {
		return {
			torchIndex: CUDA_12_8_TORCH_INDEX,
			reason: `Detected ${gpuInfo.gpuName ?? 'NVIDIA GPU'} with driver ${gpuInfo.driverVersion}; CUDA 12.8 is recommended.`
		};
	}

	if (compareVersions(gpuInfo.driverVersion, CUDA_12_X_MIN_DRIVER) >= 0) {
		return {
			torchIndex: CUDA_12_4_TORCH_INDEX,
			reason: `Detected NVIDIA driver ${gpuInfo.driverVersion}; CUDA 12.4 is the safer automatic choice for this driver range.`
		};
	}

	return {
		reason: `Detected NVIDIA driver ${gpuInfo.driverVersion}, which is older than the supported CUDA 12.x range. Falls back to the CPU build automatically.`
	};
}

function getTorchInstallOptions(): { options: TorchInstallOption[]; gpuInfo: NvidiaGpuInfo; autoReason: string } {
	const gpuInfo = detectNvidiaGpuInfo();
	const autoRecommendation = getAutoTorchRecommendation(gpuInfo);
	const options: TorchInstallOption[] = [];

	if (autoRecommendation.torchIndex) {
		options.push({
			label: 'GPU (Auto Recommended)',
			description: autoRecommendation.reason,
			value: 'auto'
		});
		options.push({
			label: 'CPU',
			description: 'Install the CPU-only PyTorch build.',
			value: 'cpu'
		});
	} else {
		options.push({
			label: 'CPU (Recommended)',
			description: 'Install the CPU-only PyTorch build.',
			value: 'cpu'
		});
		options.push({
			label: 'GPU (Auto Detect)',
			description: autoRecommendation.reason,
			value: 'auto'
		});
	}

	options.push(
		{
			label: 'CUDA 12.8 (Manual)',
			description: 'Install PyTorch from the official CUDA 12.8 wheel index (~3.6GB download).',
			value: 'cuda',
			torchIndex: CUDA_12_8_TORCH_INDEX
		},
		{
			label: 'CUDA 12.4 (Manual)',
			description: 'Install PyTorch from the official CUDA 12.4 wheel index if 12.8 is too new for your driver.',
			value: 'cuda',
			torchIndex: CUDA_12_4_TORCH_INDEX
		},
		{
			label: 'Skip PyTorch installation',
			description: 'Prepare the environment without installing PyTorch.',
			value: 'skip'
		}
	);

	return { options, gpuInfo, autoReason: autoRecommendation.reason };
}

function getServerBaseUrl(port: number = activeServerPort): string {
	return `http://${DEFAULT_SERVER_HOST}:${port}`;
}

function getServerUrl(endpoint: string, port: number = activeServerPort): string {
	return `${getServerBaseUrl(port)}${endpoint}`;
}

async function isOwlServerReachable(port: number): Promise<boolean> {
	try {
		const res = await fetch(getServerUrl('/index_status', port));
		return res.ok;
	} catch {
		return false;
	}
}

async function isPortAvailable(port: number, host: string = DEFAULT_SERVER_HOST): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.unref();
		server.once('error', () => resolve(false));
		server.once('listening', () => {
			server.close(() => resolve(true));
		});
		server.listen(port, host);
	});
}

async function findRunningServerPort(): Promise<number | undefined> {
	for (let offset = 0; offset < SERVER_PORT_SCAN_LIMIT; offset++) {
		const port = DEFAULT_SERVER_PORT + offset;
		if (await isOwlServerReachable(port)) {
			return port;
		}
	}
	return undefined;
}

async function resolveActiveServerPort(): Promise<number | undefined> {
	if (await isOwlServerReachable(activeServerPort)) {
		return activeServerPort;
	}

	const discoveredPort = await findRunningServerPort();
	if (discoveredPort !== undefined) {
		activeServerPort = discoveredPort;
		return discoveredPort;
	}

	return undefined;
}

async function findLaunchServerPort(): Promise<{ port: number; reusedExisting: boolean }> {
	const runningPort = await findRunningServerPort();
	if (runningPort !== undefined) {
		activeServerPort = runningPort;
		return { port: runningPort, reusedExisting: true };
	}

	for (let offset = 0; offset < SERVER_PORT_SCAN_LIMIT; offset++) {
		const port = DEFAULT_SERVER_PORT + offset;
		if (await isPortAvailable(port)) {
			return { port, reusedExisting: false };
		}
	}

	throw new Error(
		`No available OwlSpotlight server port found in range ${DEFAULT_SERVER_PORT}-${DEFAULT_SERVER_PORT + SERVER_PORT_SCAN_LIMIT - 1}.`
	);
}

// Translate Japanese query to English using Gemini API
async function translateJapaneseToEnglish(text: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('owlspotlight');
    // フラットな設定取得に対応
    const enabled = config.get<boolean>('enableJapaneseTranslation', false);
    const geminiApiKey = config.get<string>('geminiApiKey', '');
    
    if (!enabled) {
        return text;
    }
    
    const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(text);
    if (!hasJapanese) {
        return text;
    }
    
    return await translateWithGemini(text, geminiApiKey);
}

// Gemini APIを使用した翻訳
async function translateWithGemini(text: string, geminiApiKey: string): Promise<string> {
    try {
        
        if (!geminiApiKey) {
            vscode.window.showWarningMessage('Gemini API key is not configured. Please set it in settings.');
            return text;
        }
        
        // Dynamic import of the new Gemini API
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        
        const prompt = `Translate the following Japanese text to English. Only return the translated text, nothing else:\n\n${text}`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
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

// ハイライト色設定を取得する
function getHighlightColors() {
	const config = vscode.workspace.getConfiguration('owlspotlight');
	const c = config.get<Record<string, string>>('highlightColors', {});
	return {
		jumpLine:           c['jumpLine']           ?? 'rgba(255,200,0,0.35)',
		standaloneFunction: c['standaloneFunction'] ?? 'rgba(255,140,0,0.18)',
		classMethod:        c['classMethod']        ?? 'rgba(0,140,255,0.18)',
		classBody:          c['classBody']          ?? 'rgba(0,200,100,0.08)',
		classHeader:        c['classHeader']        ?? 'rgba(0,200,100,0.20)',
	};
}

// rgba文字列のアルファ値を変倍してボーダー色を自動導出する
function deriveBorderColor(rgba: string): string {
	const m = rgba.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
	if (!m) { return rgba; }
	const newAlpha = Math.min(1.0, parseFloat(m[4]) * 2.5).toFixed(2);
	return `rgba(${m[1]},${m[2]},${m[3]},${newAlpha})`;
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

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _outputChannel?: vscode.OutputChannel
	) {}

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
               // OwlSpotlight のタブを開いたら OUTPUT パネルを自動で表示する
               try {
                       this._outputChannel?.show(true);
               } catch {}
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
					const serverPort = await resolveActiveServerPort();
					const statusRes = serverPort !== undefined
						? await fetch(getServerUrl('/index_status', serverPort))
						: undefined;
					if (!statusRes?.ok) { serverUp = false; }
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
				const serverPort = await resolveActiveServerPort();
				if (serverPort === undefined) {
					webviewView.webview.postMessage({ type: 'error', message: 'Failed to search. Make sure the server is running.' });
					return;
				}
				const res = await fetch(getServerUrl('/search_functions_simple', serverPort), {
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
					const serverPort = await resolveActiveServerPort();
					if (serverPort === undefined) {
						webviewView.webview.postMessage({ type: 'error', message: 'Failed to load statistics. Make sure the server is running.' });
						return;
					}
					const res = await fetch(getServerUrl('/get_class_stats', serverPort), {
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
					const colors = getHighlightColors();

					// ジャンプ先の定義行ハイライト（単一行）
					decorations.push({
						type: vscode.window.createTextEditorDecorationType({ backgroundColor: colors.jumpLine, isWholeLine: true }),
						ranges: [new vscode.Range(pos.line, 0, pos.line, doc.lineAt(pos.line).text.length)]
					});

					// サーバーから提供された範囲情報を使用
					if (startLine && endLine && functionName) {
						const funcStartLine = Math.max(0, Number(startLine) - 1);
						const funcEndLine = Math.max(0, Number(endLine) - 1);
						const serverFuncRange = new vscode.Range(
							new vscode.Position(funcStartLine, 0),
							new vscode.Position(funcEndLine, doc.lineAt(Math.min(funcEndLine, doc.lineCount - 1)).text.length)
						);

						if (className) {
							// クラスメソッド: 青でハイライト
							decorations.push({
								type: vscode.window.createTextEditorDecorationType({
									backgroundColor: colors.classMethod,
									border: `1px solid ${deriveBorderColor(colors.classMethod)}`,
									isWholeLine: true
								}),
								ranges: [serverFuncRange]
							});

							// クラス全体の範囲をVS Code ASTで検索
							let symbols: vscode.DocumentSymbol[] = [];
							try {
								symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
									'vscode.executeDocumentSymbolProvider', doc.uri
								) ?? [];
							} catch { symbols = []; }

							function findClassSymbol(list: vscode.DocumentSymbol[], name: string): vscode.DocumentSymbol | undefined {
								for (const s of list) {
									if (s.kind === vscode.SymbolKind.Class && s.name === name) { return s; }
									const found = findClassSymbol(s.children, name);
									if (found) { return found; }
								}
								return undefined;
							}

							const classSymbol = findClassSymbol(symbols, className);
							if (classSymbol) {
								// クラス本体: 薄い緑でハイライト
								const classRange = await getClassRangeByIndent(doc, classSymbol.range.start);
								decorations.push({
									type: vscode.window.createTextEditorDecorationType({ backgroundColor: colors.classBody, isWholeLine: true }),
									ranges: [classRange]
								});

								// クラス定義行: 強い緑でハイライト
								const classDefLine = new vscode.Range(
									classSymbol.range.start.line, 0,
									classSymbol.range.start.line, doc.lineAt(classSymbol.range.start.line).text.length
								);
								decorations.push({
									type: vscode.window.createTextEditorDecorationType({
										backgroundColor: colors.classHeader,
										border: `1px solid ${deriveBorderColor(colors.classHeader)}`,
										isWholeLine: true
									}),
									ranges: [classDefLine]
								});
							}
						} else {
							// スタンドアロン関数: オレンジでハイライト
							decorations.push({
								type: vscode.window.createTextEditorDecorationType({
									backgroundColor: colors.standaloneFunction,
									border: `1px solid ${deriveBorderColor(colors.standaloneFunction)}`,
									isWholeLine: true
								}),
								ranges: [serverFuncRange]
							});
						}
					} else {
						// 範囲情報がない場合はVS Code ASTにフォールバック（同じ色を使用）
						console.log('[OwlSpotlight] No server range info, falling back to VS Code AST');
						let symbols: vscode.DocumentSymbol[] = [];
						try {
							symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
								'vscode.executeDocumentSymbolProvider', doc.uri
							) ?? [];
						} catch { symbols = []; }

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
						if (found?.symbol && (found.symbol.kind === vscode.SymbolKind.Function || found.symbol.kind === vscode.SymbolKind.Method)) {
							const funcRange = await getFunctionRangeByIndent(doc, found.symbol.range.start);
							const fallbackColor = found.parent ? colors.classMethod : colors.standaloneFunction;
							decorations.push({
								type: vscode.window.createTextEditorDecorationType({
									backgroundColor: fallbackColor,
									border: `1px solid ${deriveBorderColor(fallbackColor)}`,
									isWholeLine: true
								}),
								ranges: [funcRange]
							});
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
			if (msg.command === 'stopServer') {
				console.log('[OwlSpotlight] stopServer command received from Webview');
				void vscode.commands.executeCommand('owlspotlight.stopServer');
			}
			if (msg.command === 'checkServerStatus') {
				const serverPort = await resolveActiveServerPort();
				webviewView.webview.postMessage({ type: 'serverStatus', online: serverPort !== undefined, port: serverPort });
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
					const serverPort = await resolveActiveServerPort();
					if (serverPort === undefined) {
						webviewView.webview.postMessage({ type: 'error', message: 'Failed to clear cache. Make sure the server is running.' });
						return;
					}
					const res = await fetch(getServerUrl('/force_rebuild_index', serverPort), {
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
    <div class="header-left">
      OwlSpotlight
      <span class="server-status offline" id="serverStatus">
        <span class="status-dot"></span>
        <span id="serverStatusText">Offline</span>
      </span>
    </div>
    <div class="header-btns">
      <button class="owl-btn" id="repoBtn" title="Open GitHub Repository">
        <img src="${owlPngUri}" alt="GitHub" style="height:1.4em;width:1.4em;vertical-align:middle;" />
      </button>
      <button class="help-btn" id="helpBtn" title="Help"><span aria-label="help" role="img">?</span></button>
    </div>
  </div>
  <div class="actions">
    <button id="startServerBtn">Start Server</button>
    <button id="stopServerBtn">Stop Server</button>
    <button id="clearCacheBtn">Clear Cache</button>
  </div>
  <div class="translation-settings">
    <label><input type="checkbox" id="translateToggle"> JP → EN Translation</label>
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
      <input id="searchInput" type="text" placeholder="Describe what the code does..." />
      <button id="searchBtn">Search</button>
    </div>
    <div class="status" id="status"></div>
    <div id="translatedQuery" class="translated-query" style="display:none;"></div>
    <div class="results" id="results">
      <div class="empty-state" id="emptyState">
        <div class="empty-icon">
          <img src="${owlPngUri}" alt="owl" style="height:2.2em;width:2.2em;opacity:0.5;" />
        </div>
        <div class="empty-title">Ready to search</div>
        <div class="empty-hint">Enter a natural language query to find<br>functions, classes, and methods</div>
      </div>
    </div>
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
    <div class="stats-results" id="stats-results">
      <div class="empty-state" id="statsEmptyState">
        <div class="empty-title">Class Statistics</div>
        <div class="empty-hint">Run a search first, then click Load<br>to view class and method statistics</div>
      </div>
    </div>
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
    const defaultModelName = 'Shuu12121/Owl-ph2-len2048';
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

	// OUTPUT パネル: サーバー起動・環境構築のログを共通のチャネルに流す
	const owlOutputChannel = vscode.window.createOutputChannel('OwlSpotlight');

	// サイドバーWebviewViewProvider登録
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			OwlspotlightSidebarProvider.viewType,
			new OwlspotlightSidebarProvider(context, owlOutputChannel)
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

	// サーバー起動コマンド（child_processで直接起動 - ターミナル干渉を完全回避）
	let serverProcess: cp.ChildProcess | undefined;
	let isServerStarting = false;
	let isServerStopping = false;
	let serverStartupPoll: NodeJS.Timeout | undefined;
	const serverOutputChannel = owlOutputChannel;

	const clearServerStartupPoll = () => {
		if (serverStartupPoll) {
			clearInterval(serverStartupPoll);
			serverStartupPoll = undefined;
		}
	};

	const startServerDisposable = vscode.commands.registerCommand('owlspotlight.startServer', async () => {
		// 二重起動防止
		if (isServerStarting) {
			vscode.window.showInformationMessage('Server is already starting. Please wait...');
			return;
		}

		// サーバーが既に起動中かチェック
		const existingServerPort = await resolveActiveServerPort();
		if (existingServerPort !== undefined) {
			vscode.window.showInformationMessage(`Server is already running on port ${existingServerPort}.`);
			return;
		}

		isServerStarting = true;

		const config = vscode.workspace.getConfiguration('owlspotlight');
		const cacheSettings = config.get<any>('cacheSettings', {});
		const autoClearCache = cacheSettings.autoClearCache || false;
		const serverDir = path.join(context.extensionPath, 'model_server');
		const venvDir = path.join(serverDir, '.venv');
		const fs = require('fs');

		// 仮想環境がなければ作成を促す
		if (!fs.existsSync(venvDir)) {
			isServerStarting = false;
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
				vscode.window.showInformationMessage('Server start cancelled.');
				return;
			}
		}

		if (autoClearCache) {
			try {
				await vscode.commands.executeCommand('owlspotlight.clearCache');
			} catch (error) {
				vscode.window.showWarningMessage(`Failed to auto-clear cache: ${error}`);
			}
		}

		// venvのPythonバイナリを直接使用してuvicornを起動
		const platform = os.platform();
		const pythonBin = platform === 'win32'
			? path.join(venvDir, 'Scripts', 'python.exe')
			: path.join(venvDir, 'bin', 'python');

		if (!fs.existsSync(pythonBin)) {
			isServerStarting = false;
			vscode.window.showErrorMessage(`Python binary not found: ${pythonBin}`);
			return;
		}

		try {
			const launchTarget = await findLaunchServerPort();
			if (launchTarget.reusedExisting) {
				isServerStarting = false;
				vscode.window.showInformationMessage(`Server is already running on port ${launchTarget.port}.`);
				return;
			}

			const selectedPort = launchTarget.port;
			activeServerPort = selectedPort;

			// 既存のプロセスがあれば停止
			if (serverProcess && !serverProcess.killed) {
				isServerStopping = true;
				clearServerStartupPoll();
				serverProcess.kill();
				serverProcess = undefined;
			}

			serverOutputChannel.clear();
			serverOutputChannel.show(true);
			serverOutputChannel.appendLine(`[OwlSpotlight] Starting server...`);
			serverOutputChannel.appendLine(`[OwlSpotlight] Port: ${selectedPort}`);
			serverOutputChannel.appendLine(`[OwlSpotlight] Python: ${pythonBin}`);
			serverOutputChannel.appendLine(`[OwlSpotlight] Working dir: ${serverDir}`);
			serverOutputChannel.appendLine('---');

			const child = cp.spawn(
				pythonBin,
				['-m', 'uvicorn', 'server:app', '--host', DEFAULT_SERVER_HOST, '--port', String(selectedPort)],
				{
					cwd: serverDir,
					env: {
						...process.env,
						VIRTUAL_ENV: venvDir,
						PATH: (platform === 'win32'
							? path.join(venvDir, 'Scripts')
							: path.join(venvDir, 'bin'))
							+ path.delimiter + (process.env.PATH || '')
					}
				}
			);
			serverProcess = child;

			child.stdout?.on('data', (data: Buffer) => {
				serverOutputChannel.append(data.toString());
			});
			child.stderr?.on('data', (data: Buffer) => {
				serverOutputChannel.append(data.toString());
			});
			child.on('close', async (code: number | null) => {
				clearServerStartupPoll();
				if (serverProcess === child) {
					serverProcess = undefined;
				}
				isServerStarting = false;
				const stoppedByUser = isServerStopping;
				isServerStopping = false;
				if (stoppedByUser) {
					serverOutputChannel.appendLine(`\n[OwlSpotlight] Server stopped.`);
				} else {
					serverOutputChannel.appendLine(`\n[OwlSpotlight] Server process exited (code: ${code})`);
				}
				const runningPort = await findRunningServerPort();
				activeServerPort = runningPort ?? DEFAULT_SERVER_PORT;
			});
			child.on('error', (err: Error) => {
				clearServerStartupPoll();
				serverOutputChannel.appendLine(`\n[OwlSpotlight] Failed to start: ${err.message}`);
				isServerStarting = false;
				serverProcess = undefined;
				isServerStopping = false;
				activeServerPort = DEFAULT_SERVER_PORT;
				vscode.window.showErrorMessage(`Failed to start server: ${err.message}`);
			});

			const portMessage = selectedPort === DEFAULT_SERVER_PORT
				? 'OwlSpotlight server starting...'
				: `OwlSpotlight server starting on port ${selectedPort}...`;
			vscode.window.showInformationMessage(portMessage);
		} catch (err) {
			clearServerStartupPoll();
			isServerStarting = false;
			activeServerPort = DEFAULT_SERVER_PORT;
			vscode.window.showErrorMessage(`Failed to start server: ${err}`);
			return;
		}

		// サーバー起動完了を待って通知（最大90秒 - モデルロード考慮）
		const maxRetries = 18;
		let retries = 0;
		clearServerStartupPoll();
		const startupPort = activeServerPort;
		serverStartupPoll = setInterval(async () => {
			retries++;
			try {
				const res = await fetch(getServerUrl('/index_status', startupPort));
				if (res.ok) {
					clearServerStartupPoll();
					activeServerPort = startupPort;
					isServerStarting = false;
					vscode.window.showInformationMessage(`OwlSpotlight server is ready on port ${startupPort}.`);
				}
			} catch {
				if (retries >= maxRetries) {
					clearServerStartupPoll();
					isServerStarting = false;
				}
			}
		}, 5000);
	});
	context.subscriptions.push(startServerDisposable);

	// サーバー停止コマンド
	const stopServerDisposable = vscode.commands.registerCommand('owlspotlight.stopServer', () => {
		if (serverProcess && !serverProcess.killed) {
			clearServerStartupPoll();
			isServerStopping = true;
			isServerStarting = false;
			serverProcess.kill();
			vscode.window.showInformationMessage('OwlSpotlight server stopping...');
		} else {
			void resolveActiveServerPort().then((serverPort) => {
				if (serverPort !== undefined) {
					vscode.window.showInformationMessage(`A server is reachable on port ${serverPort}, but it is not managed by this extension.`);
					return;
				}
				vscode.window.showInformationMessage('No server process is running.');
			});
		}
	});
	context.subscriptions.push(stopServerDisposable);

	// 拡張機能終了時にサーバーを停止
	context.subscriptions.push({
		dispose: () => {
			clearServerStartupPoll();
			if (serverProcess && !serverProcess.killed) {
				isServerStopping = true;
				serverProcess.kill();
			}
		}
	});

	// --- 環境セットアップコマンドを追加 ---
	let isSetupRunning = false;
	let setupProcess: cp.ChildProcess | undefined;
	const setupEnvDisposable = vscode.commands.registerCommand('owlspotlight.setupEnv', async () => {
		if (isSetupRunning) {
			vscode.window.showInformationMessage('Environment setup is already running. Please wait for it to finish.');
			owlOutputChannel.show(true);
			return;
		}
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
		const platform = os.platform();
		const uvExecutable = resolveUvExecutable();
		if (!uvExecutable) {
			const installHint = platform === 'win32'
				? 'Install uv with `winget install --id=astral-sh.uv -e` or from https://docs.astral.sh/uv/getting-started/installation/.'
				: 'Install uv with `curl -LsSf https://astral.sh/uv/install.sh | sh`, `brew install uv`, or from https://docs.astral.sh/uv/getting-started/installation/.';
			vscode.window.showErrorMessage(
				`uv was not found in PATH or common install locations. ${installHint}`
			);
			return;
		}

		const { options: torchOptions, gpuInfo, autoReason } = getTorchInstallOptions();
		const torchChoice = await vscode.window.showQuickPick(torchOptions, {
			placeHolder: 'Select the PyTorch build to install during setup',
			ignoreFocusOut: true
		});
		if (!torchChoice) {
			vscode.window.showInformationMessage('OwlSpotlight Python environment setup cancelled.');
			return;
		}

		const scriptArgs: string[] = ['--torch-mode', torchChoice.value];
		if (torchChoice.torchIndex) {
			scriptArgs.push('--torch-index', torchChoice.torchIndex);
		}
		if (autoRemoveVenv) {
			scriptArgs.push('--force-recreate');
		}

		const setupCommand = uvExecutable;
		const setupArgs: string[] = [
			'run',
			'--no-project',
			'--python',
			pythonVersion,
			'bootstrap_env.py',
			'--python',
			pythonVersion,
			...scriptArgs
		];

		isSetupRunning = true;
		owlOutputChannel.show(true);
		owlOutputChannel.appendLine('');
		owlOutputChannel.appendLine(`[OwlSpotlight] Starting environment setup with uv...`);
		owlOutputChannel.appendLine(`[OwlSpotlight] Command: ${setupCommand} ${setupArgs.join(' ')}`);
		owlOutputChannel.appendLine(`[OwlSpotlight] Working dir: ${serverDir}`);
		owlOutputChannel.appendLine(`[OwlSpotlight] Python request: ${pythonVersion}`);
		owlOutputChannel.appendLine(`[OwlSpotlight] PyTorch option: ${torchChoice.label}`);
		if (gpuInfo.available) {
			owlOutputChannel.appendLine(`[OwlSpotlight] NVIDIA GPU: ${gpuInfo.gpuName ?? 'Detected'} (driver ${gpuInfo.driverVersion ?? 'unknown'})`);
		} else {
			owlOutputChannel.appendLine('[OwlSpotlight] NVIDIA GPU: Not detected via nvidia-smi');
		}
		owlOutputChannel.appendLine(`[OwlSpotlight] Auto recommendation: ${autoReason}`);
		owlOutputChannel.appendLine('---');

		try {
			setupProcess = cp.spawn(setupCommand, setupArgs, {
				cwd: serverDir,
				env: { ...process.env, PYTHONUNBUFFERED: '1' },
				shell: false
			});
		} catch (err: any) {
			isSetupRunning = false;
			owlOutputChannel.appendLine(`[OwlSpotlight] Failed to launch setup: ${err?.message ?? err}`);
			vscode.window.showErrorMessage(`Failed to launch environment setup: ${err?.message ?? err}`);
			return;
		}

		setupProcess.stdout?.on('data', (data: Buffer) => {
			owlOutputChannel.append(data.toString());
		});
		setupProcess.stderr?.on('data', (data: Buffer) => {
			owlOutputChannel.append(data.toString());
		});
		setupProcess.on('close', (code: number | null) => {
			owlOutputChannel.appendLine(`\n[OwlSpotlight] Setup process exited (code: ${code})`);
			isSetupRunning = false;
			setupProcess = undefined;
			if (code === 0) {
				vscode.window.showInformationMessage('OwlSpotlight Python environment setup completed. You can now start the server.');
			} else {
				vscode.window.showErrorMessage(`OwlSpotlight environment setup failed (exit code: ${code}). Check the OUTPUT panel for details.`);
			}
		});
		setupProcess.on('error', (err: Error) => {
			owlOutputChannel.appendLine(`\n[OwlSpotlight] Setup failed: ${err.message}`);
			isSetupRunning = false;
			setupProcess = undefined;
			vscode.window.showErrorMessage(`Environment setup failed: ${err.message}`);
		});

		vscode.window.showInformationMessage(
			`OwlSpotlight uv environment setup started with ${torchChoice.label}. Progress is shown in the OUTPUT panel.`
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

	// サーバー自動起動（少し遅延を入れてVS Code起動完了を待つ）
	const autoStart = vscode.workspace.getConfiguration('owlspotlight').get<boolean>('autoStartServer', false);
	if (autoStart) {
		setTimeout(async () => {
			const serverPort = await resolveActiveServerPort();
			if (serverPort !== undefined) {
				console.log(`[OwlSpotlight] Server already running on port ${serverPort}, skipping auto-start.`);
				return;
			}
			console.log('[OwlSpotlight] Auto-starting server...');
			vscode.commands.executeCommand('owlspotlight.startServer');
		}, 3000);
	}

	// デコレーションリスナーのセットアップ
	setupDecorationListeners();
}

export function deactivate() {}
