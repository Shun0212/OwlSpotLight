'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('owl-diff-local.owl-diff-search');
  assert.ok(extension, 'extension must be loaded');
  const api = await extension.activate();
  const response = await api.search({ query: 'retry_marker', mode: 'keyword',
    comparison: 'working', target: 'hunks', repo: 0 });
  assert.equal(response.results.length, 1);
  const result = response.results[0];
  assert.equal(result.path, 'app.py');
  const uris = await api.openResult(result.id);
  const before = await vscode.workspace.openTextDocument(uris.oldUri);
  const after = await vscode.workspace.openTextDocument(uris.newUri);
  assert.match(before.getText(), /return 1/);
  assert.match(after.getText(), /retry_marker/);
  await api.openResult(result.id, true);
  assert.equal(vscode.window.activeTextEditor.document.uri.toString(), uris.newUri.toString());
  await vscode.commands.executeCommand('owlDiff.show');
  api.cancel();
  console.log('Extension activation, local worker, search, snapshots and native diff: PASS');
};
