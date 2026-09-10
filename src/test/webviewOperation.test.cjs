const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Run the Webview's actual operation controls against a minimal DOM.
function controls() {
    const source = fs.readFileSync(path.join(__dirname, '../../media/main.js'), 'utf8');
    const elements = new Map();
    const messages = [];
    const context = vm.createContext({
        acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) }),
        document: { getElementById: id => {
            if (!elements.has(id)) { elements.set(id, { setAttribute() {} }); }
            return elements.get(id);
        } }
    });
    vm.runInContext(source.slice(source.indexOf('    const vscode ='), source.indexOf('    const webviewSessionId')), context);
    return { elements, messages, run: code => vm.runInContext(code, context) };
}

test('rapid Search / Stats / Prepare requests submit only once and recover', () => {
    const { elements, messages, run } = controls();
    run("postMessage({command: 'search'}); postMessage({command: 'search'}); postMessage({command: 'getClassStats'}); postMessage({command: 'prepareDiffSearch'});");
    assert.equal(messages.length, 1);
    assert.equal(elements.get('searchBtn').disabled, true);
    assert.equal(elements.get('loadStatsBtn').disabled, true);
    assert.equal(elements.get('operationBanner').hidden, false);
    run('localOperation = null; renderOperationState();');
    assert.equal(elements.get('searchBtn').disabled, false);
    assert.equal(elements.get('operationBanner').hidden, true);
    run("postMessage({command: 'search'});");
    assert.equal(messages.length, 2);
});

test('external server work keeps controls locked until the worker finishes', () => {
    const { elements, messages, run } = controls();
    run("serverOperation = 'build_index_api'; renderOperationState(); postMessage({command: 'search'});");
    assert.equal(messages.length, 0);
    assert.equal(elements.get('cancelOperationBtn').disabled, false);
    elements.get('cancelOperationBtn').onclick();
    assert.equal(messages[0].command, 'cancelEmbedding');
    assert.equal(elements.get('cancelOperationBtn').disabled, true);
    assert.equal(elements.get('searchBtn').disabled, true);
    run('localOperation = null; renderOperationState();');
    assert.equal(elements.get('searchBtn').disabled, true);
    run('serverOperation = null; cancelPending = false; renderOperationState();');
    assert.equal(elements.get('searchBtn').disabled, false);
});


test('Stop replaces Search immediately, before server progress arrives', () => {
    const { elements, messages, run } = controls();
    run("postMessage({command: 'search'});");
    assert.equal(elements.get('searchBtn').hidden, true);
    assert.equal(elements.get('cancelOperationBtn').hidden, false);
    assert.equal(elements.get('cancelOperationBtn').disabled, false);
    elements.get('cancelOperationBtn').onclick();
    elements.get('cancelOperationBtn').onclick();
    assert.equal(messages.length, 2);
    assert.equal(messages[1].command, 'cancelEmbedding');
    assert.equal(elements.get('cancelOperationBtn').innerHTML, 'Stopping…');
    run('localOperation = null; cancelPending = false; renderOperationState();');
    assert.equal(elements.get('searchBtn').hidden, false);
    assert.equal(elements.get('cancelOperationBtn').hidden, true);
});

test('environment setup does not offer an unsupported operation stop', () => {
    const { elements, run } = controls();
    run("postMessage({command: 'setupAndStart'});");
    assert.equal(elements.get('cancelOperationBtn').hidden, true);
});
