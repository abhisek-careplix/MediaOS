// Video shots from a starting frame (a production's storyboard frame): Veo on Vertex AI, reached the same keyless way as
// images (lib/vertex.mjs), and Kling through fal.ai (lib/fal.mjs), which needs FAL_KEY. People see the engines by plain
// names only. Kling also takes the cast as "elements" (each character's reference portraits), which keeps faces the same
// from shot to shot. Settings (environment): VERTEX_VIDEO_LOCATION (us-central1), VEO_FAST_MODEL, VEO_MODEL,
// FAL_KLING_MODEL, FAL_KLING_IMAGE_FIELD (the endpoint's starting-image field, start_image_url).
import { vertexToken, vertexProject, vertexStatus } from './vertex.mjs';
import { falReady, upload, run, fetchFile } from './fal.mjs';
import { billed } from './ledger.mjs';

const LOCATION = process.env.VERTEX_VIDEO_LOCATION || 'us-central1';
// rate: USD per second of video, from the providers' price lists (Veo without sound; Kling 3 Pro without sound)
export const ENGINES = {
  'veo-fast': { name: 'Standard', hint: 'Good quality, quick', provider: 'veo', model: process.env.VEO_FAST_MODEL || 'veo-3.1-fast-generate-001', durations: [4, 6, 8], rate: 0.12 },
  veo: { name: 'Premium', hint: 'The highest quality', provider: 'veo', model: process.env.VEO_MODEL || 'veo-3.1-generate-001', durations: [4, 6, 8], rate: 0.4 },
  kling: { name: 'Character', hint: 'Keeps the same people from shot to shot', provider: 'fal', model: process.env.FAL_KLING_MODEL || 'fal-ai/kling-video/v3/pro/image-to-video', durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], rate: 0.14 },
};

// which engines this server can use now: [{ id, name, hint, rate, durations }]
export async function engines() {
  const veo = (await vertexStatus()).ok, fal = falReady();
  return Object.entries(ENGINES).filter(([, e]) => (e.provider === 'veo' ? veo : fal)).map(([id, e]) => ({ id, name: e.name, hint: e.hint, rate: e.rate, durations: e.durations }));
}
// the shortest length an engine makes that covers the shot
export const lengthFor = (engine, seconds) => ENGINES[engine].durations.find(d => d >= seconds) || ENGINES[engine].durations.at(-1);

const wait = ms => new Promise(res => setTimeout(res, ms));
const busy = (status, detail) => Object.assign(new Error(status === 429 ? 'The video service is busy. Try this shot again in a minute.' : `The video service couldn’t make this shot (${status}).`), { code: status, detail });

// One clip: { engine, image: { data: Buffer, mime }, prompt, seconds, aspect, elements } → { mp4: Buffer, seconds, cost }
// elements (Kling only): the characters in the shot, [{ name, images: [{ data, mime }, …] }], first image the front view;
// the prompt names them "@Element1"… in that order.
export async function shootClip({ engine, image, prompt, seconds, aspect = '16:9', elements = [] }) {
  const e = ENGINES[engine];
  if (!e) throw new Error('Unknown video engine.');
  const len = lengthFor(engine, seconds);
  const mp4 = e.provider === 'veo' ? await veo(e.model, { image, prompt, len, aspect }) : await kling(e.model, { image, prompt, len, elements });
  return billed('video', { mp4, seconds: len, cost: len * e.rate }, { engine: e.name });
}

// —— talking shots: a person in a frame speaks a recorded line, lips, face and body in time with it ——
const TALK_MODEL = process.env.TALK_MODEL || 'fal-ai/bytedance/omnihuman/v1.5';
export const talkingReady = () => falReady();
// { image: { data, mime }, audio: { data, mime }, prompt } → { mp4 (with the line as its sound), seconds, cost }
export async function performClip({ image, audio, prompt }) {
  const [image_url, audio_url] = await Promise.all([upload({ ...image, name: 'frame.png' }), upload({ ...audio, name: 'line.wav' })]);
  const out = await run(TALK_MODEL, { image_url, audio_url, prompt, resolution: '720p' }, { minutes: 15 });
  const seconds = +out.duration || 0;
  return billed('video', { mp4: await fetchFile(out.video?.url), seconds, cost: seconds * 0.16 }, { engine: 'Talking' });
}

// —— Veo: a long-running prediction, polled until the video is ready (about a minute) ——
async function veo(model, { image, prompt, len, aspect }) {
  const [t, p] = await Promise.all([vertexToken(), vertexProject()]);
  const base = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${p}/locations/${LOCATION}/publishers/google/models/${model}`;
  const H = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  let op;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(base + ':predictLongRunning', { method: 'POST', headers: H, signal: AbortSignal.timeout(60000), body: JSON.stringify({
      instances: [{ prompt, image: { bytesBase64Encoded: image.data.toString('base64'), mimeType: image.mime } }],
      parameters: { aspectRatio: aspect, durationSeconds: len, generateAudio: false, resolution: '720p', sampleCount: 1, personGeneration: 'allow_adult' } }) });
    const j = await r.json().catch(() => ({}));
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await wait(Math.min(30000, 5000 * 2 ** attempt)); continue; }
    if (!r.ok || !j.name) throw busy(r.status, j.error?.message);
    op = j.name;
    break;
  }
  const until = Date.now() + 8 * 60e3;
  while (Date.now() < until) {
    await wait(6000);
    const r = await fetch(base + ':fetchPredictOperation', { method: 'POST', headers: H, signal: AbortSignal.timeout(60000), body: JSON.stringify({ operationName: op }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status === 429 || r.status >= 500) continue; throw busy(r.status, j.error?.message); }
    if (!j.done) continue;
    if (j.error) throw Object.assign(new Error('The video service couldn’t make this shot.'), { detail: j.error.message });
    const v = j.response?.videos?.[0];
    if (!v?.bytesBase64Encoded) throw new Error(j.response?.raiMediaFilteredCount ? 'This shot was blocked by the video service’s safety filter. Change the action and try again.' : 'No video came back.');
    return Buffer.from(v.bytesBase64Encoded, 'base64');
  }
  throw new Error('The video took too long. Try this shot again.');
}

// —— Kling through fal.ai: the frame (and the cast's portraits) uploaded, then the queue ——
async function kling(model, { image, prompt, len, elements }) {
  const field = process.env.FAL_KLING_IMAGE_FIELD || 'start_image_url';
  const els = [];
  for (const el of elements.slice(0, 3)) {
    const urls = await Promise.all(el.images.slice(0, 4).map((im, i) => upload({ ...im, name: `element-${els.length + 1}-${i}.png` })));
    els.push({ frontal_image_url: urls[0], reference_image_urls: (urls.length > 1 ? urls.slice(1) : urls).slice(0, 3) });
  }
  const out = await run(model, {
    prompt, [field]: await upload({ ...image, name: 'frame.png' }), duration: String(len), generate_audio: false,
    negative_prompt: 'blur, distortion, warped face, extra fingers, text, captions, subtitles, watermark, logo',
    ...(els.length ? { elements: els } : {}),
  }, { minutes: 12 });
  return fetchFile(out.video?.url);
}
