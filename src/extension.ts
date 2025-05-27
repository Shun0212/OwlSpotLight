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

		// 検索APIを呼ぶ
		const res = await fetch('http://localhost:8000/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, top_k: 5 })
		});
		const data: any = await res.json();
		if (data && data.results && Array.isArray(data.results) && data.results.length > 0) {
			const items = data.results.map((r: any) => `${r.name || r.function_name || 'unknown'} (${r.file || ''})`);
			vscode.window.showQuickPick(items, { placeHolder: '検索結果' });
		} else {
			vscode.window.showInformationMessage('該当する関数が見つかりませんでした');
		}
	});
	context.subscriptions.push(searchDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
