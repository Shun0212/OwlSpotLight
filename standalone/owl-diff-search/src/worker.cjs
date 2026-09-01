'use strict';

const cp = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

function managedPython(storage) {
  return path.join(storage, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python');
}

async function exists(filename) {
  try { await fs.access(filename); return true; } catch { return false; }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    let settled = false;
    let timer;
    let cancellation;
    const child = cp.spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancellation?.dispose();
      if (error) reject(error); else resolve(output.trim());
    };
    child.stdout.on('data', data => {
      const text = data.toString();
      output = (output + text).slice(-16000);
      options.log?.(text);
    });
    child.stderr.on('data', data => {
      const text = data.toString();
      errorOutput = (errorOutput + text).slice(-16000);
      options.log?.(text);
    });
    child.on('error', finish);
    child.on('close', code => finish(code === 0 ? null :
      new Error(errorOutput.trim().slice(-4000) || command + ' exited with code ' + code)));
    if (options.timeout) timer = setTimeout(() => {
      child.kill();
      finish(new Error(command + ' の処理がタイムアウトしました。'));
    }, options.timeout);
    if (options.token) {
      const cancel = () => { child.kill(); finish(new Error('処理を中止しました。')); };
      cancellation = options.token.onCancellationRequested(cancel);
      if (options.token.isCancellationRequested) cancel();
    }
  });
}

async function findPython(options) {
  if (options.preferManaged !== false && await exists(managedPython(options.storage))) {
    return { command: managedPython(options.storage), args: [] };
  }
  const candidates = options.pythonPath
    ? [{ command: options.pythonPath, args: [] }]
    : process.platform === 'win32'
      ? [{ command: 'py', args: ['-3.11'] }, { command: 'python', args: [] }, { command: 'python3', args: [] }]
      : [{ command: 'python3.11', args: [] }, { command: 'python3', args: [] }, { command: 'python', args: [] }];
  for (const candidate of candidates) {
    try {
      await runProcess(candidate.command, [...candidate.args, '-c',
        'import sys; assert (3,11) <= sys.version_info[:2] < (3,13), "Python 3.11 or 3.12 required"'],
      { timeout: 6000 });
      return candidate;
    } catch { /* Try the next installed interpreter. */ }
  }
  throw new Error('Python 3.11 / 3.12 が見つかりません。「検索エンジンを準備」を実行するか、Python をインストールして owlDiff.pythonPath を設定してください。');
}

class WorkerClient {
  constructor(options) {
    this.options = options;
    this.pending = new Map();
    this.counter = 0;
    this.child = undefined;
    this.starting = undefined;
    this.disposed = false;
  }

  async start() {
    if (this.disposed) throw new Error('検索プロセスは終了しています。もう一度検索してください。');
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = this._start();
    try { await this.starting; } finally { this.starting = undefined; }
  }

  async _start() {
    const interpreter = await findPython(this.options);
    if (this.disposed) throw new Error('処理を中止しました。');
    const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8',
      HF_HOME: path.join(this.options.storage, 'models'),
      HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
      OWL_MODEL_NAME: this.options.modelName,
      OWL_DIFF_GIT: this.options.git || 'git',
      OWL_PROGRESS: '0' };
    delete env.PYTHONPATH;
    delete env.PYTHONHOME;
    const child = cp.spawn(interpreter.command,
      [...interpreter.args, '-B', '-u', path.join(this.options.extensionPath, 'backend', 'worker.py')],
      { cwd: this.options.storage, env, shell: false, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('検索プロセスの起動がタイムアウトしました。'));
      }, 20000);
      const reader = readline.createInterface({ input: child.stdout });
      const failure = error => {
        clearTimeout(timer);
        reader.close();
        if (!ready) reject(error);
        if (this.child !== child) return;
        this.child = undefined;
        for (const item of this.pending.values()) item.reject(error);
        this.pending.clear();
      };
      reader.on('line', line => {
        let message;
        try { message = JSON.parse(line); } catch {
          this.options.log?.(line + '\n'); return;
        }
        if (message.event === 'ready') {
          ready = true; clearTimeout(timer); resolve(); return;
        }
        const pending = this.pending.get(message.id);
        if (message.event === 'progress') {
          pending?.progress?.(String(message.message)); return;
        }
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
      child.stderr.on('data', data => this.options.log?.(data.toString()));
      child.stdin.on('error', error => failure(error));
      child.on('error', error => failure(error));
      child.on('close', code => failure(new Error(this.disposed
        ? '処理を中止しました。'
        : '検索プロセスが終了しました (' + code + ')。出力ログを確認してください。')));
    });
  }

  async request(method, params = {}, progress) {
    await this.start();
    if (!this.child || this.disposed) throw new Error('検索プロセスが終了しています。');
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) { this.pending.delete(id); reject(error); }
      });
    });
  }

  dispose() {
    this.disposed = true;
    this.child?.kill();
    for (const pending of this.pending.values()) pending.reject(new Error('処理を中止しました。'));
    this.pending.clear();
  }
}

module.exports = { WorkerClient, findPython, runProcess, managedPython, exists };
