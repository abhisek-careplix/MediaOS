import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(APP, '..');
export const FILMS = process.env.VIDEOGEN_FILMS || path.join(ROOT, 'films');
export const LIB = process.env.LEMO_OPUSCAR_HOME || path.join(os.homedir(), 'lemo-opuscar');
export const TEMPLATES = path.join(APP, 'templates');
