const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createCodeReader, codePage, verifiedHighlights } = require('../../out/agentCode');

test('full-file reads paginate from a stable snapshot and reject escape paths, binary and oversized files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owl-agent-code-'));
    try {
        const file = path.join(root, 'auth.py');
        const code = Array.from({ length: 250 }, (_, i) => 'line_' + (i + 1)).join('\n');
        await fs.writeFile(file, code);
        const read = createCodeReader(root);
        const document = await read({ file });
        const first = codePage(document, 1);
        assert.equal(first.endLine, 200);
        assert.equal(first.nextLine, 201);
        assert.equal(codePage(document, 201).lines[49], 'line_250');
        await fs.writeFile(file, 'changed');
        assert.equal((await read({ file })).text, code);
        await assert.rejects(read({ file: '../outside.py' }), /outside/);
        await fs.symlink(os.tmpdir(), path.join(root, 'outside'));
        await assert.rejects(read({ file: 'outside' }), /outside/);
        await fs.writeFile(path.join(root, 'binary.py'), '\0binary');
        await assert.rejects(read({ file: 'binary.py' }), /Binary/);
        await fs.writeFile(path.join(root, 'large.py'), 'x'.repeat(1024 * 1024 + 1));
        await assert.rejects(read({ file: 'large.py' }), /limit/);
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(read({ file }, controller.signal), { name: 'AbortError' });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('historical reads use the commit snapshot and deleted files use the labeled parent, including subfolder workspaces', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owl-agent-git-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
        git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
        await fs.mkdir(path.join(root, 'src'));
        await fs.writeFile(path.join(root, 'src/auth.py'), 'historical code');
        git('add', '.'); git('commit', '-m', 'initial');
        const before = git('rev-parse', 'HEAD');
        await fs.writeFile(path.join(root, 'src/auth.py'), 'current code');
        const read = createCodeReader(path.join(root, 'src'));
        assert.equal((await read({ file: 'auth.py', commit_hash: before })).text, 'historical code');
        await fs.unlink(path.join(root, 'src/auth.py'));
        git('add', '.'); git('commit', '-m', 'remove');
        const removed = git('rev-parse', 'HEAD');
        const doc = await read({ file: 'auth.py', commit_hash: removed });
        assert.equal(doc.text, 'historical code');
        assert.equal(doc.version, removed + '^');
        await assert.rejects(read({ file: 'auth.py', commit_hash: '--help' }), /Invalid commit/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('only inspected ranges with bounded labels and fixed colors can become highlights', () => {
    const page = codePage({ text: 'a\nb\nc', path: 'a.py', firstLine: 5, version: 'snapshot', kind: 'source' });
    assert.throws(() => codePage({ text: 'a', path: '', firstLine: 1 }, 2), /Invalid/);
    const base = { startLine: 5, endLine: 6, color: 'blue', label: 'Inspect validation' };
    const result = verifiedHighlights([base, { ...base, startLine: 1 }, { ...base, endLine: 8 }, { ...base, color: 'url(evil)' }], [page]);
    assert.deepEqual(result, [base]);
});
