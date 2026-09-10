const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOML = require('@iarna/toml');
const { updateProjectCodexConfig, writeMcpRuntime, CODEX_TOOL_TIMEOUT, shellQuote } = require('../../out/codexSetup');

test('project config preserves other servers, backs up original, and fails without deleting an invalid config', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-config-'));
    try {
        fs.mkdirSync(path.join(root, '.codex'));
        const filename = path.join(root, '.codex/config.toml');
        const original = '# authored comment\nmodel = "test"\n[mcp_servers.other]\ncommand = "keep"\n';
        fs.writeFileSync(filename, original);
        updateProjectCodexConfig(root, { command: '/space and 日本語/node', args: ['script'], tool_timeout_sec: CODEX_TOOL_TIMEOUT });
        const config = TOML.parse(fs.readFileSync(filename, 'utf8'));
        assert.equal(config.model, 'test');
        assert.equal(config.mcp_servers.other.command, 'keep');
        assert.ok(config.mcp_servers.owlspotlight.tool_timeout_sec > 1800);
        assert.equal(fs.readFileSync(filename + '.owlspotlight.bak', 'utf8'), original);
        updateProjectCodexConfig(root, undefined);
        assert.equal(TOML.parse(fs.readFileSync(filename, 'utf8')).mcp_servers.owlspotlight, undefined);
        fs.writeFileSync(filename, 'invalid = [');
        assert.throws(() => updateProjectCodexConfig(root, { command: 'node' }));
        assert.equal(fs.readFileSync(filename, 'utf8'), 'invalid = [');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stable launcher follows refreshed runtime paths and isolates workspaces', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-runtime-'));
    try {
        const first = path.join(root, 'workspace one');
        const second = path.join(root, 'workspace two');
        fs.mkdirSync(first); fs.mkdirSync(second);
        const script = path.join(root, 'fake-mcp.cjs');
        fs.writeFileSync(script, 'console.log(JSON.stringify({ cwd:process.cwd(), url:process.env.OWLSPOTLIGHT_SERVER_URL }));');
        const launcher = writeMcpRuntime(root, first, process.execPath, script, 'http://127.0.0.1:8000');
        assert.equal(writeMcpRuntime(root, first, process.execPath, script, 'http://127.0.0.1:8001'), launcher);
        const other = writeMcpRuntime(root, second, process.execPath, script, 'http://127.0.0.1:8002');
        assert.notEqual(other, launcher);
        const result = spawnSync(process.execPath, [launcher], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { cwd: fs.realpathSync(first), url: 'http://127.0.0.1:8001' });
        const value = "space 日本語 ' $HOME `touch should-not-exist`";
        const quoted = spawnSync('/bin/sh', ['-c', 'printf %s ' + shellQuote(value, 'darwin')], { encoding: 'utf8' });
        assert.equal(quoted.stdout, value);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
