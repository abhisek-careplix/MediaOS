// Deleting a film, deck or production, to free the server's disk. Only the person who made it or an admin may, never
// while work runs for it, and never a version that is in review or has sign-offs: what people signed stays traceable to
// what was made (the frozen review copies in <governance>/reviews are never touched). A production takes the animatics
// and cuts made from it along, except those protected or made by someone else, which stay in the Library on their own
// (each carries its own takes and sound). Every delete is in the audit trail; the backup removes the files from the
// bucket on its next pass, and the bucket keeps them for 30 days.
import fs from 'fs';
import path from 'path';
import { WORKSPACES, here } from './paths.mjs';
import { getJob, forgetJob, held, readMeta, writeMeta } from './jobs.mjs';
import { reviewsOf } from './reviews.mjs';
import { can } from './team.mjs';
import { audit } from './audit.mjs';
import { storageOn, deletedOnPurpose, syncNow } from './storage.mjs';
import { listWorkspaces } from './workspaces.mjs';

const err = (msg, code = 400) => Object.assign(new Error(msg), { code });
// a folder on its way out is renamed first, so no listing ever sees half of it
const TRASH = '.deleted-';
const kindOf = m => m.mode === 'production' ? 'production' : m.mode === 'deck' ? 'deck' : 'film';
const titleOf = m => m.filmTitle || m.title || 'Untitled';
const RUNNING = { boards: 'Frames are being drawn for it', shoot: 'Takes are being shot for it', cut: 'Its film is being cut', render: 'It is exporting', director: 'It is still being made' };

// a folder's size: every file under it, links not followed
export function sizeOf(dir) {
  let bytes = 0, files = 0;
  const go = d => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) go(p);
      else if (e.isFile()) try { bytes += fs.statSync(p).size; files++; } catch {}
    }
  };
  go(dir);
  return { bytes, files };
}

// everything here is in this request's workspace: an id from another one isn't found
const filmsDir = () => here().films;
const folders = () => { const F = filmsDir(); return (fs.existsSync(F) ? fs.readdirSync(F) : []).filter(id => !id.startsWith('.')).map(id => ({ id, meta: readMeta(path.join(F, id)) })).filter(f => f.meta); };
// an admin, or the person who made it while they still make things here (view-only people delete nothing)
const mayDelete = (user, m) => !user.guest && (can(user, 'admin') || (can(user, 'creator') && !!m.owner && m.owner === user.email));
// in review, or signed off at any step (a lapsed approval included)
function guard(id, m) {
  const rs = reviewsOf(id);
  if (rs.some(r => ['in-review', 'changes'].includes(r.status))) return 'in review';
  if (m.approval || rs.some(r => ['approved', 'lapsed'].includes(r.status) || r.steps.some(s => s.status === 'approved'))) return 'has sign-offs';
  return null;
}

// what deleting it would remove and keep, and why it can't be deleted now if it can't
export function plan(id, user) {
  if (!/^[a-z0-9-]+$/.test(String(id))) throw err('bad film id');
  const FILMS = filmsDir(), m = readMeta(path.join(FILMS, id));
  if (!m) throw err('No such film.', 404);
  const kind = kindOf(m), also = [], kept = [];
  if (kind === 'production') for (const f of folders().filter(f => f.meta.production === id)) {
    const why = guard(f.id, f.meta) || (mayDelete(user, f.meta) ? null : `made by ${f.meta.ownerName || f.meta.owner || 'someone else'}`);
    if (why) kept.push({ id: f.id, title: titleOf(f.meta), why });
    else also.push({ id: f.id, title: titleOf(f.meta), ...sizeOf(path.join(FILMS, f.id)) });
  }
  const own = sizeOf(path.join(FILMS, id));
  const busy = [id, ...also.map(f => f.id)].find(x => getJob(x)?.status === 'running' || held(x)), why = guard(id, m);
  let blocked = null;
  if (user.guest) blocked = { code: 403, error: 'Deleting isn’t available on the open site.' };
  else if (!mayDelete(user, m)) blocked = { code: 403, error: `Only the person who made this ${kind}${m.ownerName ? ` (${m.ownerName})` : ''} or an admin can delete it.` };
  else if (busy) blocked = { code: 409, error: busy !== id ? `“${also.find(f => f.id === busy).title}”, made from it, is still being worked on. Delete it once that finishes.`
    : getJob(id)?.status === 'running' ? `${RUNNING[getJob(id).kind] || 'Work is running for it'}. Wait for that to finish, or stop it, then delete.` : 'It is being saved or drawn right now. Try again in a moment.' };
  else if (why === 'in review') blocked = { code: 409, error: 'It is in review. Withdraw it from review before deleting it.' };
  else if (why) blocked = { code: 409, error: 'It has sign-offs, so it stays as the record of what was approved.' };
  return { id, kind, title: titleOf(m), owner: m.owner || null, ownerName: m.ownerName || null, bytes: own.bytes + also.reduce((a, f) => a + f.bytes, 0),
    files: own.files + also.reduce((a, f) => a + f.files, 0), also, kept, blocked, backup: storageOn() };
}

export function remove(id, user) {
  const p = plan(id, user);
  if (p.blocked) throw err(p.blocked.error, p.blocked.code);
  const FILMS = filmsDir(), ids = [...p.also.map(f => f.id), id], moved = [], meta = readMeta(path.join(FILMS, id));
  for (const x of ids) deletedOnPurpose(FILMS, x);
  try { for (const x of ids) { fs.renameSync(path.join(FILMS, x), path.join(FILMS, TRASH + x)); moved.push(x); } }
  catch (e) {
    for (const x of moved) try { fs.renameSync(path.join(FILMS, TRASH + x), path.join(FILMS, x)); } catch {}
    for (const x of ids) deletedOnPurpose(FILMS, x, false);
    throw e;
  }
  audit(`${p.kind}.deleted`, { target: id, detail: { title: p.title, owner: p.owner, bytes: p.bytes, files: p.files, also: p.also.map(f => f.id), kept: p.kept.map(f => ({ id: f.id, why: f.why })) } });
  for (const f of p.also) audit('film.deleted', { target: f.id, detail: { title: f.title, with: id, bytes: f.bytes } });
  // a cut or animatic deleted on its own no longer shows as its production's latest
  const from = meta.production && readMeta(path.join(FILMS, meta.production));
  if (from && (from.cut === id || from.animatic === id)) writeMeta(path.join(FILMS, meta.production), { ...from, ...(from.cut === id ? { cut: null } : {}), ...(from.animatic === id ? { animatic: null } : {}) });
  for (const x of ids) { fs.rmSync(path.join(FILMS, TRASH + x), { recursive: true, force: true }); forgetJob(x); }
  if (storageOn()) syncNow().catch(e => console.error('[storage]', e.message));
  return { ...p, deleted: ids };
}

// folders a delete was interrupted in the middle of removing (a restart, say), in every workspace
export function sweep() {
  for (const w of listWorkspaces()) {
    const F = path.join(WORKSPACES, w.id, 'films');
    if (fs.existsSync(F)) for (const n of fs.readdirSync(F)) if (n.startsWith(TRASH)) fs.rmSync(path.join(F, n), { recursive: true, force: true });
  }
}

// the disk each of this workspace's productions (with what was made from it), films and decks takes, largest first: for
// its admins on the Team page
export function diskUse() {
  const FILMS = filmsDir(), all = folders(), items = new Map();
  for (const f of all) items.set(f.id, { id: f.id, kind: kindOf(f.meta), mode: f.meta.mode, title: titleOf(f.meta), owner: f.meta.owner || null, ownerName: f.meta.ownerName || null, created: f.meta.created, made: 0, ...sizeOf(path.join(FILMS, f.id)) });
  for (const f of all) {
    const p = f.meta.production && items.get(f.meta.production), x = items.get(f.id);
    if (!p || p === x) continue;
    p.bytes += x.bytes; p.files += x.files; p.made++;
    items.delete(f.id);
  }
  const list = [...items.values()].sort((a, b) => b.bytes - a.bytes);
  return { items: list, bytes: list.reduce((a, x) => a + x.bytes, 0) };
}
