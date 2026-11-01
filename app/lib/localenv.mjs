// Local development: service keys from <root>/.env.local (git-ignored; deploy/gcp-keys.sh can write it), loaded before
// any other module reads its settings. Only the keys below, and never over a value already set; the server's own
// settings (sign-in, access) stay in the environment, so a stray line here can't change how the app is exposed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const KEYS = new Set(['FAL_KEY', 'FAL_KLING_MODEL', 'FAL_KLING_IMAGE_FIELD', 'VEO_MODEL', 'VEO_FAST_MODEL', 'VOICE_MODEL', 'TALK_MODEL', 'TALK_FALLBACK_MODEL', 'MUSIC_MODEL', 'AMBIENCE_MODEL',
  'VERTEX_PROJECT', 'VERTEX_LOCATION', 'VERTEX_VIDEO_LOCATION', 'VERTEX_IMAGE_MODEL', 'VERTEX_LOOK_MODEL']);
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env.local');
try {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && KEYS.has(m[1]) && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
