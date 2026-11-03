// Sound for a cut (lib/fal.mjs, FAL_KEY): a composed score the length of the film, and each filmed shot's own bed (its
// room tone and soft foley, from the ambience the writer gave the shot). Both are WAVs the mix lays under the voice
// (app/audio/mix.py). Settings (environment): MUSIC_MODEL, AMBIENCE_MODEL.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { falReady, run, fetchFile } from './fal.mjs';
import { billed } from './ledger.mjs';

const MUSIC_MODEL = process.env.MUSIC_MODEL || 'fal-ai/elevenlabs/music';
export const soundReady = () => falReady();
const ff = args => new Promise((res, rej) => execFile('ffmpeg', ['-v', 'error', '-y', ...args], { timeout: 180000 }, e => (e ? rej(e) : res())));
const hash = (...xs) => crypto.createHash('sha1').update(xs.join('|')).digest('hex').slice(0, 14);

// the score: { mood, bpm, what, seconds } → { file (relative to dir), cost, cached }; kept in score/ by what it is
export async function composeScore(dir, { mood, bpm, what, seconds }) {
  const len = Math.max(6, Math.min(180, Math.ceil(seconds + 1.5)));
  const prompt = `An original instrumental score for a ${what}: ${mood}. Around ${bpm || 100} BPM. Polished, modern production for a premium advert: an inviting opening, gentle build through the middle, a clear lift near the end and a clean, resolved ending (no fade-out). No vocals, no lyrics, no sound effects.`;
  const name = `score/${hash(MUSIC_MODEL, prompt, len)}.wav`, file = path.join(dir, name);
  if (fs.existsSync(file)) return { file: name, cost: 0, cached: true };
  const cost = len / 60 * 0.6;
  const out = await run(MUSIC_MODEL, { prompt, music_length_ms: len * 1000, force_instrumental: true, output_format: 'mp3_44100_192' }, { minutes: 6, bill: { kind: 'voice', engine: 'Score', seconds: len, cost } });
  const mp3 = await fetchFile(out.audio?.url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.src', mp3);
  await ff(['-i', file + '.src', '-ar', '48000', '-ac', '2', file]).finally(() => fs.rmSync(file + '.src', { force: true }));
  return billed('voice', { file: name, cost, cached: false }, { engine: 'Score' });
}

// each shot's bed: steady room tone for its place, with any foley kept soft and occasional. Made from words: a model
// that listens to the picture hears a window and adds wind, and voices a speaking face.
const AMBIENCE_MODEL = process.env.AMBIENCE_MODEL || 'fal-ai/elevenlabs/sound-effects/v2';
export async function ambienceFor(dir, take, { ambience = '' }) {
  const name = `sound/${take.id}.wav`, file = path.join(dir, name);
  if (fs.existsSync(file)) return { file: name, cost: 0, cached: true };
  const [place, ...rest] = String(ambience || 'a quiet modern office').split(',').map(x => x.trim()).filter(Boolean);
  const seconds = Math.min(22, Math.max(1, Math.ceil(take.seconds || 4)));
  const text = `Steady, quiet background room tone of ${place}${rest.length ? `, with very soft, occasional ${rest.join(' and ')}` : ''}. Subtle and continuous. No voices, no music, no wind.`;
  const cost = seconds * 0.002;
  const out = await run(AMBIENCE_MODEL, { text: text.slice(0, 450), duration_seconds: seconds, prompt_influence: 0.6 }, { minutes: 3, bill: { kind: 'voice', engine: 'Sound', seconds, cost } });
  const mp3 = await fetchFile(out.audio?.url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.mp3', mp3);
  await ff(['-i', file + '.mp3', '-ar', '48000', '-ac', '2', file]).finally(() => fs.rmSync(file + '.mp3', { force: true }));
  return billed('voice', { file: name, cost, cached: false }, { engine: 'Sound' });
}
