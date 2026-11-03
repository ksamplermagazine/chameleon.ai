import { createFilm, DEFAULTS } from './film.js';

const $ = id => document.getElementById(id);
const SLIDERS = [
  ['grain', 'Grain amount', 0, 2, 0.01, 'grainSliders'],
  ['grainSize', 'Grain size', 1, 4, 0.1, 'grainSliders'],
  ['match', 'Match strength', 0, 1, 0.01, 'matchSliders']
];

const film = createFilm($('canvas'));
const state = { ...DEFAULTS };
let original = null, base = null, reference = null, config = { aiEnabled: false };

// sliders
for (const [key, label, min, max, step, parent] of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  row.innerHTML = `<span>${label}<output></output></span><input type="range" min="${min}" max="${max}" step="${step}">`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.value = state[key]; out.textContent = (+state[key]).toFixed(2);
  input.oninput = () => { state[key] = +input.value; out.textContent = (+input.value).toFixed(2); draw(); };
  row.dataset.key = key;
  $(parent).append(row);
}
const syncSliders = () => document.querySelectorAll('.slider').forEach(r => {
  r.querySelector('input').value = state[r.dataset.key];
  r.querySelector('output').textContent = (+state[r.dataset.key]).toFixed(2);
});

function draw() { if (base) film.render(state); }

function loadImage(src) {
  return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
}

// fit large images to the GPU texture limit
function fit(img) {
  const max = Math.min(film.maxSize, 4096), s = Math.min(1, max / Math.max(img.width, img.height));
  if (s === 1) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function setBase(img, { fromAi }) {
  base = fit(img);
  film.setImage(base);
  if (reference) film.setReference(base, reference);
  // Without AI the browser must lift exposure itself; after AI the restore already did it.
  state.exposure = fromAi ? 0 : 1.5;
  draw();
  $('download').disabled = false;
}

async function onFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  original = await loadImage(url);
  $('before').src = url;
  $('drop').hidden = true; $('viewer').hidden = false;
  setBase(original, { fromAi: false });
  original.file = file;
  $('restore').disabled = !config.aiEnabled;
  $('status').textContent = config.aiEnabled ? '' : 'Showing a browser-only preview.';
}

$('file').onchange = e => onFile(e.target.files[0]);
$('drop').ondragover = e => e.preventDefault();
$('drop').ondrop = e => { e.preventDefault(); onFile(e.dataTransfer.files[0]); };
$('split').oninput = e => $('afterWrap').style.clipPath = `inset(0 0 0 ${e.target.value}%)`;
$('ref').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  reference = await loadImage(URL.createObjectURL(f));
  if (base) film.setReference(base, reference);
  draw();
};

$('download').onclick = () => {
  draw();
  $('canvas').toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'chameleon.png'; a.click();
  }, 'image/png');
};

// AI restore through the server (key stays on the server)
const toDataUrl = file => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

$('restore').onclick = async () => {
  const btn = $('restore'), status = $('status');
  btn.disabled = true; status.textContent = 'Uploading…';
  try {
    const res = await fetch('/api/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: await toDataUrl(original.file), resolution: $('res').value, accessCode: $('code').value })
    });
    const job = await res.json(); if (!res.ok) throw Error(job.error);
    for (let i = 0; i < 120; i++) {
      await sleep(3000);
      const s = await (await fetch('/api/jobs/' + job.id)).json();
      status.textContent = 'AI restore: ' + s.status + '…';
      if (s.error) throw Error(s.error);
      if (s.ready) {
        setBase(await loadImage('/api/results/' + job.id), { fromAi: true });
        status.textContent = 'Restored. Adjust the film look, then download.';
        return;
      }
    }
    throw Error('Timed out waiting for the result.');
  } catch (e) { status.textContent = e.message; }
  finally { btn.disabled = !config.aiEnabled; }
};

// server capabilities
fetch('/api/config').then(r => r.json()).then(c => {
  config = c;
  $('codeRow').hidden = !c.accessCode;
  if (!c.aiEnabled) $('aiNote').textContent = 'AI restore is off on this server. The film look below still works in your browser.';
}).catch(() => {});
