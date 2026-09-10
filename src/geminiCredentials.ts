import * as vscode from 'vscode';
import { createHash } from 'crypto';

const SECRET = 'owlspotlight.geminiApiKey';
export class GeminiCredentials {
    private pending: Promise<unknown> = Promise.resolve();
    constructor(private readonly secrets: vscode.SecretStorage) {}

    private serialize<T>(action: () => Promise<T>): Promise<T> {
        const next = this.pending.then(action, action);
        this.pending = next.catch(() => undefined);
        return next;
    }

    private scopes() {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const workspace = vscode.workspace.workspaceFile?.toString() || folder?.toString();
        const key = (kind: string, value: string) => SECRET + '.' + kind + '.' + createHash('sha256').update(value).digest('hex');
        return [
            { key: SECRET, target: vscode.ConfigurationTarget.Global, field: 'globalValue' as const },
            ...(workspace ? [{ key: key('workspace', workspace), target: vscode.ConfigurationTarget.Workspace, field: 'workspaceValue' as const }] : []),
            ...(folder ? [{ key: key('folder', folder.toString()), target: vscode.ConfigurationTarget.WorkspaceFolder, field: 'workspaceFolderValue' as const }] : [])
        ];
    }

    async has(): Promise<boolean> {
        try { return !!(await this.get()); } catch { return false; }
    }

    get(): Promise<string> {
        return this.serialize(async () => {
            const config = vscode.workspace.getConfiguration('owlspotlight', vscode.workspace.workspaceFolders?.[0]?.uri);
            const values = config.inspect<string>('geminiApiKey');
            const scopes = this.scopes();
            // Migrate each configured scope separately, preserving VS Code precedence
            // and keys belonging to other projects. Never remove before storing.
            for (const scope of scopes) {
                const legacy = values?.[scope.field]?.trim();
                if (legacy) {
                    await this.secrets.store(scope.key, legacy);
                    await config.update('geminiApiKey', undefined, scope.target);
                }
            }
            for (const scope of scopes.reverse()) {
                const saved = await this.secrets.get(scope.key);
                if (saved) { return saved; }
            }
            return '';
        });
    }

    set(key: string): Promise<void> {
        return this.serialize(async () => {
            await this.secrets.store(SECRET, key.trim());
            const config = vscode.workspace.getConfiguration('owlspotlight', vscode.workspace.workspaceFolders?.[0]?.uri);
            const values = config.inspect<string>('geminiApiKey');
            for (const scope of this.scopes()) {
                if (scope.key !== SECRET) { await this.secrets.delete(scope.key); }
                if (values?.[scope.field] !== undefined) {
                    await config.update('geminiApiKey', undefined, scope.target);
                }
            }
        });
    }
}
