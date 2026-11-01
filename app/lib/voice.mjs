// Studio voices: human-sounding speech for narration and for the cast (lib/fal.mjs, FAL_KEY). Each line is recorded once
// and kept by what it is (voice, words, model), so a talking shot made from a line and the film that plays it use the
// very same recording. Without the key, films fall back to the built-in offline voices (lib/templates.mjs VOICES).
// Settings (environment): VOICE_MODEL (the speech endpoint).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { falReady, run, fetchFile } from './fal.mjs';
import { billed } from './ledger.mjs';

const MODEL = process.env.VOICE_MODEL || 'fal-ai/elevenlabs/tts/multilingual-v2';
// id → the name people see, a short tag and who it sounds like (for the pickers and the writer), the provider's voice, and the offline
// voice that stands in when the service can't be reached
export const STUDIO_VOICES = {
  'studio-aria': { name: 'Aria', tag: 'US woman, warm', who: 'woman, 30s, American, warm and expressive', v: 'Aria', k: 'af_heart' },
  'studio-sarah': { name: 'Sarah', tag: 'US woman, soft', who: 'young woman, American, soft and reassuring', v: 'Sarah', k: 'af_nicole' },
  'studio-jessica': { name: 'Jessica', tag: 'US woman, bright', who: 'young woman, American, bright and conversational', v: 'Jessica', k: 'af_bella' },
  'studio-laura': { name: 'Laura', tag: 'US woman, upbeat', who: 'young woman, American, upbeat and playful', v: 'Laura', k: 'af_bella' },
  'studio-matilda': { name: 'Matilda', tag: 'US woman, professional', who: 'woman, 40s, American, friendly and professional', v: 'Matilda', k: 'af_sarah' },
  'studio-river': { name: 'River', tag: 'US, calm, neutral', who: 'gender-neutral, American, calm and relaxed', v: 'River', k: 'af_nicole' },
  'studio-will': { name: 'Will', tag: 'US man, friendly', who: 'young man, American, friendly and optimistic', v: 'Will', k: 'am_puck' },
  'studio-liam': { name: 'Liam', tag: 'US man, energetic', who: 'young man, American, energetic, creator style', v: 'Liam', k: 'am_puck' },
  'studio-chris': { name: 'Chris', tag: 'US man, natural', who: 'man, 30s, American, natural and down-to-earth', v: 'Chris', k: 'am_michael' },
  'studio-eric': { name: 'Eric', tag: 'US man, trustworthy', who: 'man, 40s, American, smooth and trustworthy', v: 'Eric', k: 'am_adam' },
  'studio-roger': { name: 'Roger', tag: 'US man, confident', who: 'man, 50s, American, confident and easy-going', v: 'Roger', k: 'am_michael' },
  'studio-brian': { name: 'Brian', tag: 'US man, deep narrator', who: 'man, 50s, American, deep and resonant: a classic narrator', v: 'Brian', k: 'am_onyx' },
  'studio-bill': { name: 'Bill', tag: 'US man, older and wise', who: 'older man, 60s, American, wise and warm', v: 'Bill', k: 'am_onyx' },
  'studio-lily': { name: 'Lily', tag: 'UK woman, velvety', who: 'woman, British, warm and velvety', v: 'Lily', k: 'bf_emma' },
  'studio-george': { name: 'George', tag: 'UK man, storyteller', who: 'man, British, a warm storyteller', v: 'George', k: 'bm_george' },
};
export const isStudioVoice = id => !!STUDIO_VOICES[id];
export const studioReady = () => falReady();
// for pickers: [id, label] like the offline voices
export const studioVoiceList = () => (studioReady() ? Object.entries(STUDIO_VOICES).map(([id, v]) => [id, `${v.name} · ${v.tag} (studio)`]) : []);

const ff = args => new Promise((res, rej) => execFile('ffmpeg', ['-v', 'error', '-y', ...args], { timeout: 120000 }, e => (e ? rej(e) : res())));
const durOf = file => new Promise((res, rej) => execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (e, out) => (e ? rej(e) : res(Math.round(+out * 1000) / 1000))));
export const lineKey = (voice, text) => crypto.createHash('sha1').update([MODEL, voice, text.trim()].join('|')).digest('hex').slice(0, 16);

// One line → { file (absolute WAV, 44.1 kHz mono, silence trimmed), dur, cost, cached }, kept in cacheDir by its key
export async function speak({ text, voice, cacheDir }) {
  const v = STUDIO_VOICES[voice];
  if (!v) throw new Error('Unknown studio voice.');
  const words = String(text || '').trim();
  if (!words) throw new Error('Nothing to say.');
  const file = path.join(cacheDir, `${lineKey(voice, words)}.wav`);
  if (fs.existsSync(file)) return { file, dur: await durOf(file), cost: 0, cached: true };
  const out = await run(MODEL, { text: words, voice: v.v, stability: 0.45, similarity_boost: 0.8, style: 0.2, speed: 1, apply_text_normalization: 'auto' }, { minutes: 3 });
  const mp3 = await fetchFile(out.audio?.url);
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmp = file + '.src';
  fs.writeFileSync(tmp, mp3);
  // trim the silence either side (a little air left in), as the offline voice does, so timing is the words themselves
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03';
  await ff(['-i', tmp, '-af', `${trim},areverse,${trim.replace('0.03', '0.08')},areverse`, '-ac', '1', '-ar', '44100', file]).finally(() => fs.rmSync(tmp, { force: true }));
  return billed('voice', { file, dur: await durOf(file), cost: words.length / 1000 * 0.1, cached: false }, { engine: 'Studio voice' });
}

// a line padded with silence (lead before, tail after), for a talking shot that has to match the film's timing
export async function padded(file, lead, tail, out) {
  await ff(['-i', file, '-af', `adelay=${Math.round(lead * 1000)}:all=1,apad=pad_dur=${tail}`, '-ar', '44100', '-ac', '1', out]);
  return out;
}
