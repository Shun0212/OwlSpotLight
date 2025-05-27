// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "owlspotlight" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('owlspotlight.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from owlspotlight!');
	});

	context.subscriptions.push(disposable);

	const searchDisposable = vscode.commands.registerCommand('owlspotlight.searchCode', async () => {
		const query = await vscode.window.showInputBox({
			prompt: '検索したいコード断片を入力してください',
		});
		if (!query) {
			return;
		}

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('ワークスペースフォルダが見つかりません');
			return;
		}
		const folderPath = workspaceFolders[0].uri.fsPath;

		// インデックス構築APIを呼ぶ
		await fetch('http://localhost:8000/build_index', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ directory: folderPath, file_ext: '.py' })
		});

		// 検索APIを呼ぶ（simple search APIを利用）
		const res = await fetch('http://localhost:8000/search_functions_simple', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ directory: folderPath, query, top_k: 5 })
		});
		const data: any = await res.json();
		if (data && data.results && Array.isArray(data.results) && data.results.length > 0) {
			type QuickPickItemWithMeta = vscode.QuickPickItem & { file: string, line: number };
			const items: QuickPickItemWithMeta[] = data.results.map((r: any) => ({
				label: `${r.function_name || r.name || 'unknown'}`,
				description: `${r.file_path || r.file || ''}:${r.lineno || r.line_number || 1}`,
				detail: r.code ? r.code.split('\n').slice(0,2).join(' ') : '',
				file: r.file_path || r.file,
				line: r.lineno || r.line_number || 1
			}));

			let keepPicking = true;
			while (keepPicking) {
				const picked = await vscode.window.showQuickPick(items, { placeHolder: '検索結果', canPickMany: false });
				if (picked && picked.file) {
					try {
						const uri = vscode.Uri.file(picked.file);
						const doc = await vscode.workspace.openTextDocument(uri);
						const editor = await vscode.window.showTextDocument(doc);
						const lineNum = Number(picked.line) - 1;
						const pos = new vscode.Position(lineNum > 0 ? lineNum : 0, 0);
						editor.selection = new vscode.Selection(pos, pos);
						editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

						// 赤色デコレーション
						const decorationType = vscode.window.createTextEditorDecorationType({
							backgroundColor: 'rgba(255,0,0,0.3)'
						});
						editor.setDecorations(decorationType, [new vscode.Range(pos, pos.translate(1, 0))]);
						// 1.5秒後にデコレーション解除
						setTimeout(() => {
							editor.setDecorations(decorationType, []);
							decorationType.dispose();
						}, 1500);
					} catch (e) {
						vscode.window.showErrorMessage('ファイルを開けませんでした: ' + picked.file);
					}
					// 続けてQuickPickを表示
				} else {
					keepPicking = false;
				}
			}
		} else {
			vscode.window.showInformationMessage('該当する関数が見つかりませんでした');
		}
	});
	context.subscriptions.push(searchDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
