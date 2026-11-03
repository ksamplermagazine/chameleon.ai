import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRestore } from '../lib/workflow.mjs';
import { createLimits } from '../lib/limits.mjs';
import { createApp } from '../server.mjs';

const PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');

test('restore graph wires LoadImage -> Nano Banana -> SaveImage', () => {
  const g = buildRestore({ image: 'ref.png', resolution: '4K' });
  assert.equal(g.source.class_type, 'LoadImage');
  assert.equal(g.restore.class_type, 'GeminiNanoBanana2V2');
  assert.deepEqual(g.restore.inputs['model.images.image_1'], ['source', 0]);
  assert.equal(g.restore.inputs['model.resolution'], '4K');
  assert.equal(g.restore.inputs.temperature, 0.4);
  assert.deepEqual(g.save.inputs.images, ['restore', 0]);
  assert.throws(() => buildRestore({ image: 'x', resolution: '8K' }));
});

test('limits: access code, per-IP and daily caps', () => {
  const l = createLimits({ perIpPerHour: 2, perDay: 3, accessCode: 'nyc' });
  assert.equal(l.check('a', 'wrong').status, 403);
  assert.ok(l.check('a', 'nyc').ok);
  assert.ok(l.check('a', 'nyc').ok);
  assert.equal(l.check('a', 'nyc').status, 429);
  assert.ok(l.check('b', 'nyc').ok);
  assert.equal(l.check('c', 'nyc').status, 429); // daily cap
});

test('AI restore is rejected when paid generation is off', async () => {
  const app = await createApp({ port: 0, dataDir: await mkdtemp(path.join(tmpdir(), 'fr-')), allowPaid: false });
  try {
    const cfg = await (await fetch(app.url + '/api/config')).json();
    assert.equal(cfg.aiEnabled, false);
    const r = await fetch(app.url + '/api/restore', { method: 'POST', body: JSON.stringify({ image: PNG }) });
    assert.equal(r.status, 503);
    assert.equal((await fetch(app.url + '/')).status, 200);
  } finally { app.server.close(); }
});

test('mocked cloud: upload, submit, poll, download', async () => {
  const calls = [];
  const fake = {
    upload: async () => (calls.push('upload'), 'asset-ref.png'),
    submit: async graph => (calls.push('submit:' + graph.source.inputs.image), { id: 'p1', status: 'queued', urls: { self: '/api/v2/jobs/p1' } }),
    getJob: async () => (calls.push('poll'), { status: 'succeeded', outputs: [{ node_id: 'save', id: 'out1' }] }),
    download: async (id, dest) => { calls.push('download:' + id); const { writeFile } = await import('node:fs/promises'); await writeFile(dest, 'png'); }
  };
  const app = await createApp({ port: 0, dataDir: await mkdtemp(path.join(tmpdir(), 'fr-')), allowPaid: true, apiKey: 'k', cloudFactory: () => fake });
  try {
    const r = await fetch(app.url + '/api/restore', { method: 'POST', body: JSON.stringify({ image: PNG }) });
    assert.equal(r.status, 202);
    const { id } = await r.json();
    await new Promise(res => setTimeout(res, 50));
    const s = await (await fetch(app.url + '/api/jobs/' + id)).json();
    assert.equal(s.ready, true);
    assert.equal((await fetch(app.url + '/api/results/' + id)).status, 200);
    assert.deepEqual(calls, ['upload', 'submit:asset-ref.png', 'poll', 'download:out1']);
  } finally { app.server.close(); }
});
