// Cloud Storage: every workspace's data folders (films, brand kits, proof, uploads, governance) and the studio's own
// (the list of workspaces, the operators' audit trail, the font cache) are mirrored to a private, versioned bucket every
// few minutes, so a lost or rebuilt server loses nothing: scripts/restore.mjs brings it all back, and a file missing from
// the disk is streamed from the bucket instead of failing. The disk stays the working copy; the bucket is the record.
// Each workspace has its own folder in the bucket, <prefix>workspaces/<id>/, so one can be listed, restored or removed
// on its own. Reached keylessly, like Vertex AI (the VM's service account, or gcloud locally).
// Settings (environment): MEDIA_BUCKET (unset = off), MEDIA_PREFIX (studio/), STORAGE_SYNC_MINUTES (10).
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { PLATFORM, AREAS, WORKSPACE_ID, dirsOf } from './paths.mjs';
import { listWorkspaces, homeWorkspace, legacyMoves } from './workspaces.mjs';
import { vertexToken } from './vertex.mjs';

const BUCKET = process.env.MEDIA_BUCKET || '';
const PREFIX = (process.env.MEDIA_PREFIX ?? 'studio/').replace(/^\/+/, '');
const EVERY = Math.max(1, +process.env.STORAGE_SYNC_MINUTES || 10) * 60e3;
// what is backed up, by its folder in the bucket: the studio's own, then each workspace's
export function roots() {
  const out = { platform: PLATFORM };
  for (const w of listWorkspaces()) { const d = dirsOf(w.id); for (const a of AREAS) out[`workspaces/${w.id}/${a}`] = d[a]; }
  return out;
}
const rootOf = dir => Object.entries(roots()).find(([, d]) => path.resolve(d) === path.resolve(dir))?.[0];
const MANIFEST = path.join(PLATFORM, 'storage-manifest.json');
const API = 'https://storage.googleapis.com/storage/v1/b/' + BUCKET + '/o';
const UPLOAD = 'https://storage.googleapis.com/upload/storage/v1/b/' + BUCKET + '/o';
export const storageOn = () => !!BUCKET;

const keyOf = (root, rel) => PREFIX + root + '/' + rel.split(path.sep).join('/');
const auth = async () => ({ Authorization: 'Bearer ' + await vertexToken() });
const fail = (what, r, body) => Object.assign(new Error(`Cloud Storage ${what} failed (${r.status})`), { code: r.status, detail: String(body).slice(0, 300) });

// what is worth keeping: not temporary files, and not a finished film's render scratch (out/), which is made again
function skip(rel, quick) {
  const parts = rel.split(path.sep), name = parts.at(-1);
  if (name.startsWith('.') || name.endsWith('.tmp') || name === 'storage-manifest.json' || parts.includes('node_modules')) return true;
  return quick && parts[1] === 'out';
}
function walk(rootName, dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const quickFilms = new Set();
  if (rootName.endsWith('/films')) for (const id of fs.readdirSync(dir)) { try { if (JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')).mode === 'quick') quickFilms.add(id); } catch {} }
  const go = (d, depth) => {
    if (depth > 8) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), rel = path.relative(dir, p);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') go(p, depth + 1); continue; }
      if (!e.isFile() || skip(rel, quickFilms.has(rel.split(path.sep)[0]))) continue;
      const st = fs.statSync(p);
      out.push({ key: keyOf(rootName, rel), file: p, size: st.size, mtime: Math.round(st.mtimeMs) });
    }
  };
  go(dir, 0);
  return out;
}

const TYPES = { '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown', '.srt': 'text/plain', '.txt': 'text/plain' };

async function put(file, key, size) {
  const r = await fetch(`${UPLOAD}?uploadType=media&name=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { ...await auth(), 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': String(size) },
    body: fs.createReadStream(file), duplex: 'half', signal: AbortSignal.timeout(10 * 60e3) });
  if (!r.ok) throw fail('upload', r, await r.text());
  return r.json();
}
async function del(key) {
  const r = await fetch(`${API}/${encodeURIComponent(key)}`, { method: 'DELETE', headers: await auth(), signal: AbortSignal.timeout(60e3) });
  if (!r.ok && r.status !== 404) throw fail('delete', r, await r.text());
}
export async function list() {
  const items = [];
  let page = '';
  do {
    const r = await fetch(`${API}?prefix=${encodeURIComponent(PREFIX)}&fields=items(name,size,updated),nextPageToken${page ? '&pageToken=' + page : ''}`, { headers: await auth(), signal: AbortSignal.timeout(60e3) });
    if (!r.ok) throw fail('listing', r, await r.text());
    const j = await r.json();
    items.push(...(j.items || []));
    page = j.nextPageToken || '';
  } while (page);
  return items;
}
// a stored file as a stream, or null when it isn't there; range: a Range header to pass on
async function get(key, range) {
  const r = await fetch(`${API}/${encodeURIComponent(key)}?alt=media`, { headers: { ...await auth(), ...(range ? { Range: range } : {}) }, signal: AbortSignal.timeout(10 * 60e3) });
  if (r.status === 404) return null;
  if (!r.ok && r.status !== 206) throw fail('download', r, await r.text());
  return r;
}

// —— the mirror ——
let manifest = null, running = null, status = { lastSync: null };
const loadManifest = () => manifest ||= (() => { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return { files: {}, lastSync: null }; } })();
function saveManifest() {
  fs.mkdirSync(PLATFORM, { recursive: true });
  fs.writeFileSync(MANIFEST + '.tmp', JSON.stringify(manifest));
  fs.renameSync(MANIFEST + '.tmp', MANIFEST);
}

// upload what changed since the last pass and remove what was deleted (the bucket keeps old versions for 30 days)
export function syncNow() {
  if (!storageOn()) return Promise.resolve(null);
  return running ||= (async () => {
    const t0 = Date.now(), m = loadManifest(), seen = new Set(), errors = [];
    let uploaded = 0, bytes = 0, deleted = 0;
    const todo = [], present = {};
    for (const [name, dir] of Object.entries(roots())) {
      const files = walk(name, dir);
      present[name] = files.length;
      for (const f of files) {
        seen.add(f.key);
        const had = m.files[f.key];
        // a file still being written is left for the next pass
        if ((!had || had.size !== f.size || had.mtime !== f.mtime) && Date.now() - f.mtime > 20e3) todo.push(f);
      }
    }
    const queue = [...todo];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let f; (f = queue.shift());) {
        try { await put(f.file, f.key, f.size); m.files[f.key] = { size: f.size, mtime: f.mtime }; uploaded++; bytes += f.size; }
        catch (e) { errors.push(`${f.key}: ${e.message}`); }
      }
    }));
    // deletions, with guards: a missing or emptied folder (a fresh disk before a restore) never empties the bucket, and
    // a pass that finds many files missing in a workspace removes none of that workspace's. Folders deleted in the studio
    // are exempt from both. A file from before workspaces, still at its old place in the bucket (<prefix>films/…), counts
    // as the file at its new place (<prefix>workspaces/careplix/films/…): it goes once that copy is up, or, like any
    // other, once the file is gone from the disk.
    const meant = k => (m.purged || []).some(p => k.startsWith(p));
    const now = k => movedKey(m, k) || k;
    const rootOfKey = k => Object.keys(present).find(r => k.startsWith(PREFIX + r + '/'));
    const gone = Object.keys(m.files).filter(k => !seen.has(now(k)) && (meant(k) || present[rootOfKey(now(k))] > 0));
    const groups = new Map(), held = new Set();
    for (const k of gone.filter(k => !meant(k))) { const g = rootOfKey(now(k)).split('/').slice(0, 2).join('/'); groups.set(g, [...(groups.get(g) || []), k]); }
    for (const [g, ks] of groups) {
      const all = Object.keys(m.files).filter(k => now(k).startsWith(PREFIX + g + '/')).length, limit = Math.max(25, Math.round(all * 0.1));
      if (ks.length > limit) { ks.forEach(k => held.add(k)); errors.push(`${PREFIX}${g}/: ${ks.length} files are missing from the disk, more than a pass may remove (${limit}); they were left in the bucket.`); }
    }
    const copied = Object.keys(m.files).filter(k => now(k) !== k && m.files[now(k)]);
    for (const k of new Set([...gone.filter(k => !held.has(k)), ...copied])) { try { await del(k); delete m.files[k]; deleted++; } catch (e) { errors.push(`${k}: ${e.message}`); } }
    if (m.moved && !Object.keys(m.files).some(k => movedKey(m, k))) delete m.moved;
    // a deleted folder is forgotten once the bucket holds none of its files
    m.purged = (m.purged || []).filter(p => Object.keys(m.files).some(k => k.startsWith(p)));
    m.lastSync = { at: new Date().toISOString(), ms: Date.now() - t0, uploaded, deleted, bytes, errors: errors.slice(0, 20), errorCount: errors.length };
    saveManifest();
    if (errors.length) console.error(`[storage] ${errors.length} problem(s) syncing to gs://${BUCKET}/${PREFIX}: ${errors[0]}`);
    return m.lastSync;
  })().finally(() => { running = null; });
}

// where a file from before workspaces now belongs in the bucket, or null (moved: old folder → new, as the first start
// recorded it; the longest match wins, so brands/_fonts goes to the font cache and the rest of brands to the workspace)
function movedKey(m, k) {
  if (!m.moved) return null;
  const from = Object.keys(m.moved).filter(o => k.startsWith(PREFIX + o + '/')).sort((a, b) => b.length - a.length)[0];
  return from ? PREFIX + m.moved[from] + k.slice((PREFIX + from).length) : null;
}

// a folder deleted on purpose (a film or production removed in the studio), recorded before it goes: the next pass
// removes its files from the bucket whatever the guards say, and they are no longer served from there. on = false
// takes it back (a delete that didn't happen). dir: the data folder it is in (a workspace's films).
export function deletedOnPurpose(dir, rel, on = true) {
  if (!storageOn()) return;
  const rootName = rootOf(dir);
  if (!rootName) return;
  const m = loadManifest(), p = keyOf(rootName, rel) + '/';
  m.purged = (m.purged || []).filter(x => x !== p).concat(on ? [p] : []);
  saveManifest();
}

export function startSync() {
  if (!storageOn()) return;
  setTimeout(() => { syncNow().catch(e => console.error('[storage]', e.message)); setInterval(() => syncNow().catch(e => console.error('[storage]', e.message)), EVERY); }, 30e3);
}

// the whole backup and the server's disk: for the studio's operators
export function storageStatus() {
  const m = loadManifest(), files = Object.values(m.files);
  let disk = null;
  try { const s = fs.statfsSync(PLATFORM); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch {}
  return { on: storageOn(), bucket: BUCKET || null, prefix: PREFIX, files: files.length, bytes: files.reduce((a, f) => a + f.size, 0), lastSync: m.lastSync, syncing: !!running, everyMinutes: EVERY / 60e3, disk };
}
// one workspace's part of it: its files in the bucket, the last pass, and that pass's problems with its own files only
export function workspaceStatus(ws) {
  const m = loadManifest(), mine = PREFIX + 'workspaces/' + ws + '/', keys = Object.keys(m.files).filter(k => k.startsWith(mine)), last = m.lastSync;
  const errors = (last?.errors || []).filter(e => e.startsWith(mine));
  return { on: storageOn(), files: keys.length, bytes: keys.reduce((a, k) => a + m.files[k].size, 0), syncing: !!running, everyMinutes: EVERY / 60e3,
    lastSync: last ? { at: last.at, errors, errorCount: errors.length } : null };
}

// a file the disk doesn't have, streamed from the bucket instead (with byte ranges, so video can seek); false if absent
export async function serveFromCloud(req, res, root, rel, type) {
  if (!storageOn()) return false;
  const name = rootOf(root);
  if (!name) return false;
  const key = keyOf(name, rel);
  if ((loadManifest().purged || []).some(p => key.startsWith(p))) return false;
  const r = await get(key, req.headers.range);
  if (!r) return false;
  const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  for (const k of ['content-length', 'content-range']) if (r.headers.get(k)) h[k.replace(/(^|-)\w/g, c => c.toUpperCase())] = r.headers.get(k);
  res.writeHead(r.status, h);
  await pipeline(Readable.fromWeb(r.body), res);
  return true;
}

// where a stored file goes on this disk: a workspace's file into that workspace, the studio's into the platform folder,
// and one from before workspaces (<prefix>films/…) into the CarePlix workspace; null for anything else
function placeOf(name) {
  const parts = name.slice(PREFIX.length).split('/');
  if (parts[0] === 'workspaces' && WORKSPACE_ID.test(parts[1] || '') && AREAS.includes(parts[2]) && parts.length > 3) return { ws: parts[1], dir: dirsOf(parts[1])[parts[2]], rel: parts.slice(3) };
  if (parts[0] === 'platform' && parts.length > 1) return { ws: null, dir: PLATFORM, rel: parts.slice(1) };
  if (parts[0] === 'brands' && parts[1] === '_fonts' && parts.length > 2) return { ws: null, dir: path.join(PLATFORM, 'fonts'), rel: parts.slice(2) };
  if (AREAS.includes(parts[0]) && parts.length > 1 && parts.at(-1) !== 'storage-manifest.json') return { ws: homeWorkspace() || 'careplix', dir: dirsOf(homeWorkspace() || 'careplix')[parts[0]], rel: parts.slice(1), legacy: true };
  return null;
}

// the list of workspaces from the bucket, joined with the one here: a workspace this server doesn't know comes back
async function restoreRegistry(it, { dry, log }) {
  const r = await get(it.name);
  if (!r) return;
  const theirs = JSON.parse(await r.text()), file = path.join(PLATFORM, 'workspaces.json');
  let ours = { home: null, workspaces: {} };
  try { ours = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const add = Object.keys(theirs.workspaces || {}).filter(id => !ours.workspaces[id]);
  if (!add.length && ours.home) return;
  if (dry) return log(`would add the workspaces ${add.join(', ')}`);
  for (const id of add) ours.workspaces[id] = theirs.workspaces[id];
  ours.home ||= theirs.home;
  fs.mkdirSync(PLATFORM, { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(ours, null, 1));
  fs.renameSync(file + '.tmp', file);
}

// the bucket back onto an empty or damaged disk: files missing locally (or a different size, with force) are fetched;
// workspace: only that workspace's files
export async function restore({ dry = false, force = false, workspace = null, log = console.log } = {}) {
  if (!storageOn()) throw new Error('MEDIA_BUCKET is not set.');
  const items = await list(), m = loadManifest();
  let fetched = 0, kept = 0, bytes = 0;
  if (!workspace) { const reg = items.find(it => it.name === PREFIX + 'platform/workspaces.json'); if (reg) await restoreRegistry(reg, { dry, log }); }
  for (const it of items) {
    const place = placeOf(it.name);
    if (!place || (workspace && place.ws !== workspace) || it.name === PREFIX + 'platform/workspaces.json' || (m.purged || []).some(p => it.name.startsWith(p))) continue;
    const { dir, rel: relParts } = place;
    // a file fetched from its place before workspaces: the next pass puts it at its new place and removes the old one
    if (place.legacy && !dry) m.moved ||= legacyMoves(place.ws);
    const file = path.join(dir, ...relParts);
    if (!file.startsWith(dir + path.sep)) continue;
    const st = fs.existsSync(file) ? fs.statSync(file) : null;
    if (st && (!force || st.size === +it.size)) { kept++; continue; }
    if (dry) { log(`would fetch ${it.name} (${it.size} bytes)`); fetched++; continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const r = await get(it.name);
    if (!r) continue;
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file + '.tmp'));
    fs.renameSync(file + '.tmp', file);
    const now = fs.statSync(file);
    m.files[it.name] = { size: now.size, mtime: Math.round(now.mtimeMs) };
    fetched++; bytes += +it.size;
  }
  if (!dry) saveManifest();
  return { objects: items.length, fetched, kept, bytes };
}
