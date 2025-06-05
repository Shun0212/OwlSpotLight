import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Sample test', () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('Shun0212.owlspotlight');
        await ext?.activate();
        assert.ok(ext?.isActive, 'Extension is not active');
    });

    test('Commands are registered', async () => {
        const cmds = await vscode.commands.getCommands(true);
        const expected = [
            'owlspotlight.startServer',
            'owlspotlight.searchCode',
            'owlspotlight.setupEnv',
            'owlspotlight.clearCache',
            'owlspotlight.removeVenv'
        ];
        for (const cmd of expected) {
            assert.ok(cmds.includes(cmd), `${cmd} not found`);
        }
    });
});
