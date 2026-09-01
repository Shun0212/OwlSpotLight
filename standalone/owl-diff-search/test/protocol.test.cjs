'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { WorkerClient } = require('../src/worker.cjs');

test('real worker reports errors by request ID and remains usable', async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'owl-protocol-'));
  const client = new WorkerClient({ storage, extensionPath: path.resolve(__dirname, '..'),
    modelName: 'Shuu12121/NightOwl-CodeEmbedding', git: 'git' });
  try {
    const results = await Promise.allSettled([
      client.request('unknown-one'), client.request('unknown-two')
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'rejected');
    assert.match(results[0].reason.message, /不明な操作/);
    await assert.rejects(client.request('document', { result_id: 'missing' }), /有効期限/);
  } finally {
    client.dispose();
    await fs.rm(storage, { recursive: true, force: true });
  }
});

test('disposed workers reject new work promptly', async () => {
  const client = new WorkerClient({ storage: os.tmpdir(), extensionPath: path.resolve(__dirname, '..') });
  client.dispose();
  await assert.rejects(client.request('search'), /終了/);
});
