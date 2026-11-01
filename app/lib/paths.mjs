import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(APP, '..');
export const FILMS = process.env.VIDEOGEN_FILMS || path.join(ROOT, 'films');
// product photos and reference images attached to a brief, stored once by content
export const UPLOADS = process.env.VIDEOGEN_UPLOADS || path.join(ROOT, 'uploads');
// who may do what, the audit trail, spend and caps, and reviewed versions
export const GOV = process.env.VIDEOGEN_GOVERNANCE || path.join(ROOT, 'governance');
export const LIB = process.env.LEMO_OPUSCAR_HOME || path.join(os.homedir(), 'lemo-opuscar');
export const TEMPLATES = path.join(APP, 'templates');
