// Workspaces: the studio serves several customers, each in a workspace of its own. A workspace has its own people and
// roles (team.mjs), brand kits, Proof Library, uploads, productions, films and decks, reviews and sign-offs, spend and
// caps, and audit trail, all under <WORKSPACES>/<id>/, and nothing in one is reachable from another. The list of them
// is in <platform>/workspaces.json: each one's name, the Google Workspace domains whose people join it as Creators, the
// monthly spending limit its operator set (which its own budget owner can't raise), and whether Director is on.
// Operators (ADMIN_EMAILS) create and change workspaces; every change is in the operators' audit trail and in the
// workspace's own. The first start of a studio from before workspaces moves its data into the CarePlix workspace.
import fs from 'fs';
import path from 'path';
import { PLATFORM, LEGACY, AREAS, WORKSPACE_ID, dirsOf } from './paths.mjs';
import { runAs } from './context.mjs';
import { audit, auditPlatform, verifyFile } from './audit.mjs';

const FILE = path.join(PLATFORM, 'workspaces.json');
// the studio's own workspace: ADMIN_EMAILS are admins there, the open site's guests work there, and the data of a studio
// from before workspaces moves into it
const HOME = { id: 'careplix', name: 'CarePlix' };
const PUBLIC_MAIL = new Set(['gmail.com', 'googlemail.com']);
const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });
const now = () => new Date().toISOString();

let cache = { key: '', data: null };
function load() {
  try {
    const st = fs.statSync(FILE), key = st.mtimeMs + ':' + st.size;
    if (key !== cache.key) cache = { key, data: JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    return structuredClone(cache.data);
  } catch { return { home: null, workspaces: {} }; }
}
function store(r) {
  fs.mkdirSync(PLATFORM, { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(r, null, 1));
  fs.renameSync(FILE + '.tmp', FILE);
  cache = { key: '', data: null };
}

const shape = (id, w) => ({ id, name: w.name, domains: w.domains || [], limit: w.limit ?? null, director: !!w.director, created: w.created || null });
export const listWorkspaces = () => Object.entries(load().workspaces).map(([id, w]) => shape(id, w)).sort((a, b) => a.name.localeCompare(b.name));
export const getWorkspace = id => { const w = load().workspaces[id]; return w ? shape(id, w) : null; };
export const homeWorkspace = () => load().home;

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
function clean(input, prev, id, all) {
  const name = String(input.name ?? prev?.name ?? '').trim().slice(0, 60);
  if (!name) throw bad('Give the workspace a name.');
  const domains = [...new Set((Array.isArray(input.domains) ? input.domains : prev?.domains || []).map(d => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
  for (const d of domains) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw bad(`“${d}” isn’t a domain.`);
    if (PUBLIC_MAIL.has(d)) throw bad(`${d} is a public mail domain. Add people from it one by one on the workspace’s Team page instead.`);
    const other = Object.entries(all).find(([k, w]) => k !== id && (w.domains || []).includes(d));
    if (other) throw bad(`${d} already belongs to the workspace “${other[1].name}”.`, 409);
  }
  const v = input.limit === undefined ? prev?.limit ?? null : input.limit;
  const limit = v === '' || v === null ? null : Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 100) / 100 : (() => { throw bad('The limit is an amount in dollars, or empty for none.'); })();
  return { name, domains, limit, director: input.director === undefined ? !!prev?.director : !!input.director };
}

export function createWorkspace(input, by) {
  const r = load(), id = String(input.id || '').trim().toLowerCase() || slug(input.name);
  if (!WORKSPACE_ID.test(id)) throw bad('The workspace id is 2 to 32 lower-case letters, digits or dashes, starting with a letter or digit.');
  if (r.workspaces[id]) throw bad('There is already a workspace with that id.', 409);
  const w = { ...clean(input, null, id, r.workspaces), created: now(), by: by?.email || null };
  r.workspaces[id] = w;
  store(r);
  for (const a of AREAS) fs.mkdirSync(dirsOf(id)[a], { recursive: true });
  auditPlatform('workspace.created', { target: id, detail: w });
  runAs(by, id, () => audit('workspace.created', { target: id, detail: w }));
  return shape(id, w);
}

export function updateWorkspace(id, input, by) {
  const r = load(), prev = r.workspaces[id];
  if (!prev) throw bad('No such workspace.', 404);
  const next = { ...prev, ...clean(input, prev, id, r.workspaces), updated: now(), updatedBy: by?.email || null };
  r.workspaces[id] = next;
  store(r);
  const detail = { before: shape(id, prev), after: shape(id, next) };
  auditPlatform('workspace.changed', { target: id, detail });
  runAs(by, id, () => audit('workspace.changed', { target: id, detail }));
  return shape(id, next);
}

// where each folder from before workspaces now is, as a folder in the backup bucket
export const legacyMoves = home => ({ 'brands/_fonts': 'platform/fonts', ...Object.fromEntries(AREAS.map(a => [a, `workspaces/${home}/${a}`])) });

// —— the first start after workspaces arrived ——
// The data of a studio from before workspaces becomes the CarePlix workspace's. Each folder is renamed into place (it
// is on the same disk, so nothing is copied), and a start cut off halfway finishes the rest the next time. A folder
// with data in both places stops the start rather than merge them. The font cache and the backup's manifest are the
// studio's own and go to the platform folder. A fresh studio only gets its list of workspaces: nothing is written into a
// workspace, so a restore from the bucket afterwards finds nothing of its own in the way.
export function migrate(log = console.log) {
  const r = load();
  if (!r.home) {
    const domains = (process.env.ALLOWED_DOMAINS || 'careplix.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    r.home = HOME.id;
    r.workspaces[HOME.id] ||= { name: HOME.name, domains, limit: null, director: true, created: now(), by: null };
    store(r);
  }
  const home = dirsOf(r.home), moved = [];
  const has = dir => { try { return fs.readdirSync(dir).some(n => n !== '.DS_Store'); } catch { return false; } };
  const fonts = path.join(PLATFORM, 'fonts'), oldFonts = path.join(LEGACY.brands, '_fonts');
  if (fs.existsSync(oldFonts)) {
    fs.mkdirSync(fonts, { recursive: true });
    for (const f of fs.readdirSync(oldFonts)) if (!fs.existsSync(path.join(fonts, f))) fs.renameSync(path.join(oldFonts, f), path.join(fonts, f));
    fs.rmSync(oldFonts, { recursive: true, force: true });
  }
  const chainBefore = has(LEGACY.governance) ? verifyFile(path.join(LEGACY.governance, 'audit.jsonl')) : null;
  for (const a of AREAS) {
    const from = LEGACY[a], to = home[a];
    if (!has(from) || path.resolve(from) === path.resolve(to)) continue;
    if (has(to)) throw new Error(`Both ${from} and ${to} hold data. The studio won’t merge them: move one of them aside, then start it again.`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.rmSync(path.join(to, '.DS_Store'), { force: true });
    try { fs.rmdirSync(to); } catch {}
    try { fs.renameSync(from, to); }
    catch (e) { throw e.code === 'EXDEV' ? new Error(`${from} is on a different disk from ${to}. Move it there by hand, then start the studio again.`) : e; }
    moved.push(a);
  }
  // the backup's manifest, with where each old folder's files now go in the bucket
  const oldManifest = path.join(home.governance, 'storage-manifest.json'), manifest = path.join(PLATFORM, 'storage-manifest.json');
  if (fs.existsSync(oldManifest) && !fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(oldManifest, 'utf8'));
    m.moved = legacyMoves(r.home);
    fs.mkdirSync(PLATFORM, { recursive: true });
    fs.writeFileSync(manifest + '.tmp', JSON.stringify(m));
    fs.renameSync(manifest + '.tmp', manifest);
    fs.rmSync(oldManifest, { force: true });
  }
  if (!moved.length) return null;
  const w = r.workspaces[r.home], detail = { name: w.name, domains: w.domains, moved, from: Object.fromEntries(moved.map(a => [a, LEGACY[a]])), auditChain: chainBefore };
  runAs(null, r.home, () => audit('workspace.created', { target: r.home, detail }));
  auditPlatform('workspace.created', { target: r.home, detail });
  const chainAfter = verifyFile(path.join(home.governance, 'audit.jsonl'));
  log(`[workspaces] moved ${moved.join(', ')} into the ${w.name} workspace (${home.root}); audit chain ${chainBefore ? (chainBefore.ok ? 'intact' : 'already broken at line ' + chainBefore.brokenAt) : 'new'} before, ${chainAfter.ok ? 'intact' : 'broken at line ' + chainAfter.brokenAt} after, ${chainAfter.entries} entries.`);
  if (chainBefore?.ok && !chainAfter.ok) throw new Error('The audit trail’s chain broke while moving it into the workspace. Nothing else was changed; look at ' + home.governance);
  return { home: r.home, moved, chainBefore, chainAfter };
}
