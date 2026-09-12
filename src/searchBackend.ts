import * as vscode from 'vscode';

export type SearchBackend = 'ask' | 'python' | 'node-onnx';
export function searchBackend(): SearchBackend {
    return vscode.workspace.getConfiguration('owlspotlight').get<SearchBackend>('searchBackend', 'ask');
}
export async function setSearchBackend(backend: SearchBackend): Promise<void> {
    const config = vscode.workspace.getConfiguration('owlspotlight');
    const inspected = config.inspect('searchBackend');
    // Honor an existing workspace override rather than writing an ineffective global setting.
    await config.update('searchBackend', backend, inspected?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
}
let choosing: Promise<SearchBackend | undefined> | undefined;
export async function chooseSearchBackend(): Promise<SearchBackend | undefined> {
    if (searchBackend() !== 'ask') { return searchBackend(); }
    if (choosing) { return choosing; }
    choosing = (async () => {
        const choice = await vscode.window.showQuickPick([
            { label: 'node_onnx · Simple mode (no server)', description: 'Use when Python server setup is unavailable or you prefer to stay within VS Code.', detail: 'Runs ONNX models on the CPU using Node.js inside the extension, without a backend server. Downloads the model on first semantic search.', backend: 'node-onnx' as const },
            { label: 'backend_server(python)', description: 'Use a supported GPU for faster search.', detail: 'Sets up a Python environment and starts a local backend search server. GPU acceleration requires compatible hardware and software. Falls back to simple mode if setup or startup fails.', backend: 'python' as const },
        ], { title: 'OwlSpotlight: Initial Setup', placeHolder: 'Choose how search runs (you can change this in extension settings)', ignoreFocusOut: true });
        if (!choice) { return; }
        await setSearchBackend(choice.backend);
        return choice.backend;
    })();
    try { return await choosing; } finally { choosing = undefined; }
}
let fallingBack: Promise<void> | undefined;
export async function fallbackToSimpleMode(reason: string, output?: vscode.OutputChannel): Promise<void> {
    if (searchBackend() === 'node-onnx') { return; }
    if (fallingBack) { return fallingBack; }
    fallingBack = (async () => {
        output?.appendLine(`[OwlSpotlight] Python setup/start failed: ${reason}`);
        // Stop only the process owned by this extension, before changing its backend.
        await vscode.commands.executeCommand('owlspotlight.stopServer', { ownedOnly: true });
        await setSearchBackend('node-onnx');
        void vscode.window.showWarningMessage('Python環境の構築・起動に失敗したため、Node.js簡易モードに切り替えました。詳細はOwlSpotlightのOUTPUTを確認できます。設定からPythonモードに戻せます。');
    })();
    try { await fallingBack; } finally { fallingBack = undefined; }
}
