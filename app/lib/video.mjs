// Video shots from a starting frame (a production's storyboard frame): Veo on Vertex AI, reached the same keyless way as
// images (lib/vertex.mjs), and Kling through fal.ai, which needs FAL_KEY. People see the engines by plain names only.
// Settings (environment): VERTEX_VIDEO_LOCATION (us-central1), VEO_FAST_MODEL, VEO_MODEL, FAL_KEY, FAL_KLING_MODEL,
// FAL_KLING_IMAGE_FIELD (the endpoint's starting-image field, start_image_url).
import { vertexToken, vertexProject, vertexStatus } from './vertex.mjs';

const LOCATION = process.env.VERTEX_VIDEO_LOCATION || 'us-central1';
// rate: rough USD per second of video (third-party figures until checked against the providers' price lists)
export const ENGINES = {
  'veo-fast': { name: 'Standard', hint: 'Good quality, quick', provider: 'veo', model: process.env.VEO_FAST_MODEL || 'veo-3.1-fast-generate-001', durations: [4, 6, 8], rate: 0.12 },
  veo: { name: 'Premium', hint: 'The highest quality', provider: 'veo', model: process.env.VEO_MODEL || 'veo-3.1-generate-001', durations: [4, 6, 8], rate: 0.4 },
  kling: { name: 'Character', hint: 'Best at keeping the same people from shot to shot', provider: 'fal', model: process.env.FAL_KLING_MODEL || 'fal-ai/kling-video/v3/pro/image-to-video', durations: [5, 10], rate: 0.22 },
};

// which engines this server can use now: [{ id, name, hint, rate, durations }]
export async function engines() {
  const veo = (await vertexStatus()).ok, fal = !!process.env.FAL_KEY;
  return Object.entries(ENGINES).filter(([, e]) => (e.provider === 'veo' ? veo : fal)).map(([id, e]) => ({ id, name: e.name, hint: e.hint, rate: e.rate, durations: e.durations }));
}
// the shortest length an engine makes that covers the shot
export const lengthFor = (engine, seconds) => ENGINES[engine].durations.find(d => d >= seconds) || ENGINES[engine].durations.at(-1);

const wait = ms => new Promise(res => setTimeout(res, ms));
const busy = (status, detail) => Object.assign(new Error(status === 429 ? 'The video service is busy. Try this shot again in a minute.' : `The video service couldn’t make this shot (${status}).`), { code: status, detail });

// One clip: { engine, image: { data: Buffer, mime }, prompt, seconds, aspect } → { mp4: Buffer, seconds, cost }
export async function shootClip({ engine, image, prompt, seconds, aspect = '16:9' }) {
  const e = ENGINES[engine];
  if (!e) throw new Error('Unknown video engine.');
  const len = lengthFor(engine, seconds);
  const mp4 = e.provider === 'veo' ? await veo(e.model, { image, prompt, len, aspect }) : await kling(e.model, { image, prompt, len, aspect });
  return { mp4, seconds: len, cost: len * e.rate };
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

// —— Kling through fal.ai's queue: submit, poll, then download the finished file ——
async function kling(model, { image, prompt, len }) {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('This engine isn’t set up on this server.');
  const H = { Authorization: 'Key ' + key, 'Content-Type': 'application/json' };
  const field = process.env.FAL_KLING_IMAGE_FIELD || 'start_image_url';
  const r = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: H, signal: AbortSignal.timeout(60000), body: JSON.stringify({
    prompt, [field]: `data:${image.mime};base64,${image.data.toString('base64')}`, duration: String(len), negative_prompt: 'blur, distortion, warped face, text, captions, watermark, logo' }) });
  const q = await r.json().catch(() => ({}));
  if (!r.ok || !q.status_url) throw busy(r.status, q.detail ? JSON.stringify(q.detail).slice(0, 300) : undefined);
  const until = Date.now() + 10 * 60e3;
  while (Date.now() < until) {
    await wait(6000);
    const s = await (await fetch(q.status_url, { headers: H, signal: AbortSignal.timeout(30000) })).json().catch(() => ({}));
    if (s.status === 'COMPLETED') break;
    if (s.status && !['IN_QUEUE', 'IN_PROGRESS'].includes(s.status)) throw new Error('The video service couldn’t make this shot.');
  }
  const res = await (await fetch(q.response_url, { headers: H, signal: AbortSignal.timeout(60000) })).json().catch(() => ({}));
  const url = res.video?.url;
  if (!url) throw Object.assign(new Error('No video came back.'), { detail: JSON.stringify(res).slice(0, 300) });
  const v = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!v.ok) throw new Error('The finished video couldn’t be downloaded.');
  return Buffer.from(await v.arrayBuffer());
}
