# Chameleon

Rescue dark, noisy film and phone photos: AI exposure recovery with ComfyUI, then a film look you control in the browser.

## How it works

1. **Upload** a photo (PNG, JPEG or WebP).
2. **AI restore** (optional, server-side): the server uploads the photo to Comfy Cloud and runs
   `LoadImage → GeminiNanoBanana2V2 (Nano Banana 2.1) → SaveImage` to recover exposure and detail
   while keeping composition and people unchanged.
3. **Film look** (in the browser, WebGL): exposure, faded blacks, contrast, highlights, saturation,
   filmic curve, split toning, vignette, grain and optional color match to a reference photo.
   Defaults follow the original ComfyUI canvas workflow in [`workflows/`](workflows/).
4. **Download** the result as PNG. A before/after slider compares it with the original.

Without an API key the app still works: the browser lifts exposure itself and applies the film look.

```
Browser (public/)                       Server (server.mjs)                Comfy Cloud
 upload ─► film look (WebGL) ◄─ result ─ /api/restore ─► upload + submit ─► Nano Banana 2.1
                                          /api/jobs/:id ◄─ poll + download ◄┘
```

## Run locally

Requirements: Node.js **22.12+**.

```sh
npm install
npm start
```

Open http://127.0.0.1:4190/.

To enable AI restore, copy `.env.example` to `.env`, set `COMFY_API_KEY` (a Comfy Cloud API key)
and `ALLOW_PAID_GENERATION=1`, then restart. The key stays on the server and never reaches the browser.

## Public deployment guards

Each AI restore spends Comfy Cloud credits. Before sharing a public link, set:

- `LIMIT_PER_IP_PER_HOUR` (default 3) and `LIMIT_PER_DAY` (default 100)
- `ACCESS_CODE` to require a code for AI restore

Jobs are kept in memory; restarting the server clears them.

## Tests

```sh
npm test
```

Covers graph wiring, rate limits, the disabled-AI path and a mocked Cloud upload/submit/poll/download.
They do not prove real paid inference or visual quality.

## Limits

- The browser film look approximates the ComfyUI nodes (Radiance, LayerStyle FilmV2, ColorMatchV2); it is not the same code.
- Nano Banana 2.1 is a paid partner API, so this is not an open-weights-only entry.
- AI restore can subtly change faces or small details. Compare with the original before using a result.

## License

Apache-2.0. `lib/cloud.mjs` is reused from [Shotfix](https://github.com/ksamplermagazine/shotfix) (same author, Apache-2.0).
Built for the Comfy-organized #OpenSourceHiggsfield challenge.
