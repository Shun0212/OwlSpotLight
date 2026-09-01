'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { runTests } = require('@vscode/test-electron');

(async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'owl-vscode-'));
  const git = args => cp.execFileSync('git', ['-c', 'user.name=Tests',
    '-c', 'user.email=tests@example.invalid', ...args], { cwd: workspace });
  try {
    git(['init', '-q']);
    await fs.writeFile(path.join(workspace, 'app.py'), 'def fetch():\n    return 1\n');
    git(['add', '.']);
    git(['commit', '-qm', 'baseline']);
    await fs.writeFile(path.join(workspace, 'app.py'), 'def fetch():\n    return "retry_marker"\n');
    await runTests({
      version: '1.100.0',
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, '../test/host/index.cjs'),
      launchArgs: [workspace, '--disable-extensions', '--skip-welcome',
        '--skip-release-notes', '--disable-workspace-trust', '--no-sandbox']
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
