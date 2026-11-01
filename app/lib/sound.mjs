// Sound for a cut (lib/fal.mjs, FAL_KEY): a composed score the length of the film, and each filmed shot's own ambience
// and foley, made from the picture so the sound matches what is on screen. Both are WAVs the mix lays under the voice
// (app/audio/mix.py). Settings (environment): MUSIC_MODEL, FOLEY_MODEL.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { falReady, upload, run, fetchFile } from './fal.mjs';
import { billed } from './ledger.mjs';

const MUSIC_MODEL = process.env.MUSIC_MODEL || 'fal-ai/elevenlabs/music';
const FOLEY_MODEL = process.env.FOLEY_MODEL || 'fal-ai/mmaudio-v2';
export const soundReady = () => falReady();
const ff = args => new Promise((res, rej) => execFile('ffmpeg', ['-v', 'error', '-y', ...args], { timeout: 180000 }, e => (e ? rej(e) : res())));
const hash = (...xs) => crypto.createHash('sha1').update(xs.join('|')).digest('hex').slice(0, 14);

// the score: { mood, bpm, what, seconds } → { file (relative to dir), cost, cached }; kept in score/ by what it is
export async function composeScore(dir, { mood, bpm, what, seconds }) {
  const len = Math.max(6, Math.min(180, Math.ceil(seconds + 1.5)));
  const prompt = `An original instrumental score for a ${what}: ${mood}. Around ${bpm || 100} BPM. Polished, modern production for a premium advert: an inviting opening, gentle build through the middle, a clear lift near the end and a clean, resolved ending (no fade-out). No vocals, no lyrics, no sound effects.`;
  const name = `score/${hash(MUSIC_MODEL, prompt, len)}.wav`, file = path.join(dir, name);
  if (fs.existsSync(file)) return { file: name, cost: 0, cached: true };
  const out = await run(MUSIC_MODEL, { prompt, music_length_ms: len * 1000, force_instrumental: true, output_format: 'mp3_44100_192' }, { minutes: 6 });
  const mp3 = await fetchFile(out.audio?.url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.src', mp3);
  await ff(['-i', file + '.src', '-ar', '48000', '-ac', '2', file]).finally(() => fs.rmSync(file + '.src', { force: true }));
  return billed('voice', { file: name, cost: len / 60 * 0.6, cached: false }, { engine: 'Score' });
}

// a shot's ambience and foley from its take: (dir, take, { place, action }) → { file (relative to dir), cost }
export async function foleyFor(dir, take, { place = '', action = '' }) {
  const name = `sound/${take.id}.wav`, file = path.join(dir, name);
  if (fs.existsSync(file)) return { file: name, cost: 0, cached: true };
  const url = await upload({ data: fs.readFileSync(path.join(dir, take.file)), mime: 'video/mp4', name: 'take.mp4' });
  const seconds = Math.min(30, Math.max(1, take.seconds || 5));
  const out = await run(FOLEY_MODEL, {
    video_url: url, duration: seconds, num_steps: 25, cfg_strength: 4.5,
    prompt: `Natural, realistic ambience and foley for this scene${place ? `: ${place}` : ''}. ${action}`.slice(0, 900),
    negative_prompt: 'music, melody, singing, speech, talking, voices, narration, distortion, noise bursts',
  }, { minutes: 5 });
  const mp4 = await fetchFile(out.video?.url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.mp4', mp4);
  await ff(['-i', file + '.mp4', '-vn', '-ar', '48000', '-ac', '2', file]).finally(() => fs.rmSync(file + '.mp4', { force: true }));
  return billed('voice', { file: name, cost: seconds * 0.001, cached: false }, { engine: 'Sound' });
}
