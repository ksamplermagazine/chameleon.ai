// Builds the Comfy API-format graph for the AI restore step.
// Mirrors the tested canvas workflow: LoadImage -> GeminiNanoBanana2V2 -> SaveImage.
// Film look (tone curve, split toning, vignette, grain, color match) runs in the browser.

export const RESTORE_PROMPT = [
  'This photo is underexposed and noisy: a low-light or low-quality film or phone shot.',
  'Make it look like it was shot with correct exposure.',
  'Keep everything identical: composition, framing, people, faces, hands, jewelry, objects,',
  'reflections, buildings, lit windows, lights and sky.',
  'Lift the shadows and midtones naturally, recover detail in the dark areas, reduce noise,',
  'keep realistic colors and the original time of day.',
  'Do not add, remove or restyle anything. Do not turn a night photo into a daytime photo.'
].join(' ');

export const RESOLUTIONS = ['1K', '2K', '4K'];

const node = (class_type, inputs, title) => ({ class_type, inputs, _meta: { title } });

export function buildRestore({ image, resolution = '2K', note = '', seed = 42, id = 'photo' }) {
  if (!image) throw Error('Missing uploaded image reference.');
  if (!RESOLUTIONS.includes(resolution)) throw Error('Resolution must be 1K, 2K or 4K.');
  const extra = String(note).trim().slice(0, 500);
  return {
    source: node('LoadImage', { image }, 'LoadImage'),
    restore: node('GeminiNanoBanana2V2', {
      prompt: extra ? `${RESTORE_PROMPT} ${extra}` : RESTORE_PROMPT,
      model: 'Gemini Nano Banana 2.1',
      'model.aspect_ratio': 'auto',
      'model.resolution': resolution,
      'model.thinking_level': 'HIGH',
      seed,
      response_modalities: 'IMAGE',
      temperature: 0.4,
      top_p: 0.95,
      'model.images.image_1': ['source', 0]
    }, 'GeminiNanoBanana2V2'),
    save: node('SaveImage', { images: ['restore', 0], filename_prefix: 'chameleon/' + id }, 'SaveImage')
  };
}
