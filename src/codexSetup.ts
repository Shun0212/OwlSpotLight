import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as TOML from '@iarna/toml';

export const CODEX_TOOL_TIMEOUT = 1860;
export function shellQuote(value: string, platform = process.platform): string {
    return platform === 'win32' ? "'" + value.replace(/'/g, "''") + "'" : "'" + value.replace(/'/g, "'\\''") + "'";
}

export function atomicWrite(filename: string, content: string): void {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, filename);
    } finally {
        if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); }
    }
}

export function updateProjectCodexConfig(workspace: string, server: Record<string, any> | undefined): string {
    const filename = path.join(workspace, '.codex', 'config.toml');
    const original = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
    const config: any = TOML.parse(original);
    config.mcp_servers ??= {};
    if (server) { config.mcp_servers.owlspotlight = server; }
    else { delete config.mcp_servers.owlspotlight; }
    const content = TOML.stringify(config);
    TOML.parse(content);
    // Preserve the exact original (including comments) for recovery. No remove/add gap.
    if (original) { atomicWrite(filename + '.owlspotlight.bak', original); }
    atomicWrite(filename, content);
    return filename;
}

export function writeMcpRuntime(storage: string, workspace: string, python: string, script: string, serverUrl: string, language = 'en') {
    const id = crypto.createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, 24);
    const directory = path.join(storage, 'mcp', id);
    const launcher = path.join(directory, 'launch.cjs');
    atomicWrite(path.join(directory, 'runtime.json'), JSON.stringify({ python, script, workspace, serverUrl, language }));
    atomicWrite(launcher, `const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime.json'), 'utf8'));
if (!fs.existsSync(config.script) || !fs.existsSync(config.workspace)) {
  process.stderr.write('OwlSpotlight runtime is unavailable. Open this workspace in VS Code and run Agent Setup again.\\n');
  process.exit(1);
}
const child = cp.spawn(config.python, [config.script], { cwd: config.workspace, stdio: 'inherit', env: {
  ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
  OWLSPOTLIGHT_WORKSPACE: config.workspace, OWLSPOTLIGHT_SERVER_URL: config.serverUrl,
  OWLSPOTLIGHT_SEARCH_TIMEOUT: '1800', OWLSPOTLIGHT_RUNTIME_FILE: path.join(__dirname, 'runtime.json')
}});
child.on('error', () => { process.stderr.write('Unable to launch OwlSpotlight Python. Run Setup Environment in VS Code.\\n'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
`);
    return launcher;
}
