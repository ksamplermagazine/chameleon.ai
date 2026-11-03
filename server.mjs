import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ComfyClient } from './lib/cloud.mjs';
import { buildRestore } from './lib/workflow.mjs';
import { createLimits } from './lib/limits.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const fail = (msg, status = 400) => Object.assign(Error(msg), { status });

async function readJson(req, max = 30 * 1024 * 1024) {
  let n = 0; const parts = [];
  for await (const b of req) { n += b.length; if (n > max) throw fail('Image is too large (max ~20 MB).', 413); parts.push(b); }
  return JSON.parse(Buffer.concat(parts).toString() || '{}');
}

function decodeImage(uri) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(uri || '');
  if (!m) throw fail('Upload a PNG, JPEG or WebP image.');
  return { bytes: Buffer.from(m[2], 'base64'), type: 'image/' + m[1], ext: m[1].replace('jpeg', 'jpg') };
}

export async function createApp({
  port = Number(process.env.PORT || 4190),
  dataDir = path.join(root, '.runtime'),
  apiKey = process.env.COMFY_API_KEY,
  allowPaid = process.env.ALLOW_PAID_GENERATION === '1',
  cloudFactory = key => new ComfyClient({ apiKey: key }),
  limits = createLimits({
    perIpPerHour: Number(process.env.LIMIT_PER_IP_PER_HOUR || 3),
    perDay: Number(process.env.LIMIT_PER_DAY || 100),
    accessCode: process.env.ACCESS_CODE || ''
  })
} = {}) {
  await mkdir(dataDir, { recursive: true });
  const cloud = allowPaid && apiKey ? cloudFactory(apiKey) : null;
  const jobs = new Map();

  async function run(job, image, resolution) {
    try {
      const file = path.join(dataDir, job.id + '-source.' + image.ext);
      await writeFile(file, image.bytes);
      job.status = 'uploading';
      const ref = await cloud.upload(file, image.type, path.basename(file));
      job.status = 'submitting';
      const r = await cloud.submit(buildRestore({ image: ref, resolution, id: job.id }), job.id);
      Object.assign(job, { providerId: r.id, urls: r.urls, status: r.status || 'queued' });
    } catch (e) { job.status = 'failed'; job.error = e.message; }
  }

  async function refresh(job) {
    if (!job.providerId || job.ready || job.status === 'failed') return;
    try {
      const r = await cloud.getJob(job.urls?.self || `/api/v2/jobs/${job.providerId}`);
      job.status = r.status;
      if (r.status === 'succeeded') {
        const out = (r.outputs || []).find(o => String(o.node_id) === 'save');
        if (!out) throw fail('Finished without an image output.', 502);
        await cloud.download(out.id, path.join(dataDir, job.id + '.png'));
        job.ready = true;
      }
      if (['failed', 'rejected', 'canceled'].includes(r.status)) job.error = 'The AI restore did not complete.';
    } catch (e) { job.pollError = e.message; }
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/api/config') return send(200, { aiEnabled: !!cloud, accessCode: !!process.env.ACCESS_CODE });

      if (url.pathname === '/api/restore' && req.method === 'POST') {
        if (!cloud) throw fail('AI restore is disabled on this server. The film look still works in your browser.', 503);
        const body = await readJson(req);
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
        const gate = limits.check(ip, body.accessCode);
        if (!gate.ok) throw fail(gate.error, gate.status);
        const image = decodeImage(body.image);
        const job = { id: randomUUID(), status: 'received', created: Date.now() };
        jobs.set(job.id, job);
        run(job, image, body.resolution || '2K');
        return send(202, { id: job.id });
      }

      const status = /^\/api\/jobs\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (status) {
        const job = jobs.get(status[1]); if (!job) throw fail('Unknown job.', 404);
        await refresh(job);
        return send(200, { id: job.id, status: job.status, ready: !!job.ready, error: job.error || null });
      }

      const result = /^\/api\/results\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (result) {
        const job = jobs.get(result[1]); if (!job?.ready) throw fail('Result is not ready.', 404);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return createReadStream(path.join(dataDir, job.id + '.png')).pipe(res);
      }

      // static files
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.join(root, 'public', path.normalize(rel));
      if (!file.startsWith(path.join(root, 'public'))) throw fail('Not found.', 404);
      const data = await readFile(file).catch(() => { throw fail('Not found.', 404); });
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch (e) { send(e.status || 500, { error: e.message }); }
  });

  await new Promise(r => server.listen(port, r));
  return { server, jobs, url: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  console.log(`Chameleon running at ${app.url}`);
}
