import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { current } from './context.mjs';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(APP, '..');
// each customer's workspace keeps all its data in <WORKSPACES>/<id>/: films (productions, films and decks), brand kits,
// the Proof Library, uploads, and governance (who may do what, reviews, spend and caps, the audit trail)
export const WORKSPACES = process.env.VIDEOGEN_WORKSPACES || path.join(ROOT, 'workspaces');
export const AREAS = ['films', 'brands', 'proof', 'uploads', 'governance'];
// the studio's own: the list of workspaces, the operators' audit trail, the backup's manifest and the font cache
export const PLATFORM = process.env.VIDEOGEN_PLATFORM || path.join(ROOT, 'platform');
// where the data lived before workspaces; the first start moves it into the CarePlix workspace
export const LEGACY = {
  films: process.env.VIDEOGEN_FILMS || path.join(ROOT, 'films'),
  brands: process.env.VIDEOGEN_BRANDS || path.join(ROOT, 'brands'),
  proof: process.env.VIDEOGEN_PROOF || path.join(ROOT, 'proof'),
  uploads: process.env.VIDEOGEN_UPLOADS || path.join(ROOT, 'uploads'),
  governance: process.env.VIDEOGEN_GOVERNANCE || path.join(ROOT, 'governance'),
};
export const LIB = process.env.LEMO_OPUSCAR_HOME || path.join(os.homedir(), 'lemo-opuscar');
export const TEMPLATES = path.join(APP, 'templates');

export const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{1,31}$/;
// one workspace's folders
export function dirsOf(id) {
  if (!WORKSPACE_ID.test(String(id))) throw Object.assign(new Error('bad workspace id'), { code: 400 });
  const root = path.join(WORKSPACES, id);
  return { id, root, ...Object.fromEntries(AREAS.map(a => [a, path.join(root, a)])) };
}
// the folders of the workspace this request (or the work it started) belongs to. There is no default: data touched
// outside a workspace is an error, never someone else's folder.
export function here() {
  const ws = current().ws;
  if (!ws) throw Object.assign(new Error('This request has no workspace.'), { code: 500 });
  return dirsOf(ws);
}
