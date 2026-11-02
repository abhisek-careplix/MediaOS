// Video shots from a starting frame (a production's storyboard frame): Veo on Vertex AI, reached the same keyless way as
// images (lib/vertex.mjs), and Kling through fal.ai (lib/fal.mjs), which needs FAL_KEY. People see the engines by plain
// names only. Kling also takes the cast as "elements" (each character's reference portraits), which keeps faces the same
// from shot to shot. Settings (environment): VERTEX_VIDEO_LOCATION (us-central1), VEO_FAST_MODEL, VEO_MODEL,
// FAL_KLING_MODEL, FAL_KLING_IMAGE_FIELD (the endpoint's starting-image field, start_image_url).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
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
// In order of preference (a blind comparison of these and six others on the same shot put the first narrowly ahead);
// each usually takes 2-4 minutes, and when one stalls or fails the next takes over (an unpaid account or a safety block
// isn't retried). A model with a minimum audio length gets the line with silence after it, and its clip is trimmed back.
const TALKERS = [
  { model: process.env.TALK_MODEL || 'bytedance/omnihuman/v2', rate: 0.105, minutes: 10, input: {}, minAudio: 4 },
  { model: 'fal-ai/bytedance/omnihuman/v1.5', rate: 0.16, minutes: 10, input: { resolution: '720p' } },
  { model: process.env.TALK_FALLBACK_MODEL || 'fal-ai/kling-video/ai-avatar/v2/pro', rate: 0.115, minutes: 15, input: {} },
];
export const talkingReady = () => falReady();
// what a talking shot costs with the first choice: USD a second, and the shortest it bills (a shorter line is padded to it)
export const talkingPrice = () => ({ rate: TALKERS[0].rate, min: TALKERS[0].minAudio || 0 });
const sh = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 180000 }, (e, out) => (e ? rej(e) : res(String(out).trim()))));
// { image: { data, mime }, audio: { data (a WAV), mime }, prompt } → { mp4 (with the line as its sound), seconds, cost }
export async function performClip({ image, audio, prompt }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-'));
  try {
    const line = path.join(tmp, 'line.wav');
    fs.writeFileSync(line, audio.data);
    const dur = +(await sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', line]));
    const image_url = await upload({ ...image, name: 'frame.png' }), urls = {};
    // the line as each model needs it: as recorded, or with silence after it up to the model's minimum
    const audioFor = async min => {
      const key = min && dur < min ? min : 0;
      if (urls[key]) return urls[key];
      let file = line;
      if (key) { file = path.join(tmp, `line-${key}.wav`); await sh('ffmpeg', ['-v', 'error', '-y', '-i', line, '-af', `apad=whole_dur=${key + 0.1}`, file]); }
      return (urls[key] = await upload({ data: fs.readFileSync(file), mime: 'audio/wav', name: 'line.wav' }));
    };
    for (const [k, t] of TALKERS.entries()) {
      try {
        const out = await run(t.model, { image_url, audio_url: await audioFor(t.minAudio), prompt, ...t.input }, { minutes: t.minutes });
        const made = +out.duration || dur, raw = path.join(tmp, 'take.mp4'), cut = path.join(tmp, 'cut.mp4');
        fs.writeFileSync(raw, await fetchFile(out.video?.url));
        // back to the line's own length when it was padded
        const padded = t.minAudio && dur < t.minAudio;
        if (padded) await sh('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-t', dur.toFixed(3), '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', cut]);
        return billed('video', { mp4: fs.readFileSync(padded ? cut : raw), seconds: padded ? dur : made, cost: made * t.rate }, { engine: 'Talking' });
      } catch (e) {
        if (k === TALKERS.length - 1 || e.code === 402 || /safety/i.test(e.message)) throw e;
        console.error(`talking shot: ${t.model} failed, trying the next model;`, e.detail || e.message);
      }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
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
