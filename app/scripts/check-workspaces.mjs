// Checks that workspaces keep customers apart. On throwaway data it runs the real server with Google sign-in on (the
// sessions are signed here with the server's own throwaway key), sets up two customer workspaces, A ("acme") and B
// ("bolt"), each with films, a deck, a production, a brand kit with a logo, a Proof Library entry, an upload, a review,
// spending and caps, and then, as A's admin holding every role, tries every route on B's things: reading, changing,
// deleting, and starting paid work. It passes when every attempt is refused, no list A sees holds anything of B's, B's
// folder is the same byte for byte, neither ledger moved, and nothing called an AI service. It also checks who may enter
// which workspace, the move of a studio from before workspaces into the CarePlix one, and that the backup keeps each
// workspace to its own folder in the bucket (against a stand-in bucket: nothing leaves this machine).
//   node app/scripts/check-workspaces.mjs           on a fresh folder under the system's temp folder, removed afterwards
//   node app/scripts/check-workspaces.mjs --keep    keeps that folder, and says where it is
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const PNG = tag => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(tag)]);
let failed = 0, passed = 0;
const ok = (cond, what, detail = '') => { console.log(`  ${cond ? '✓' : '✗'} ${what}${!cond && detail ? `\n      ${String(detail).slice(0, 300)}` : ''}`); cond ? passed++ : failed++; return cond; };
const section = t => console.log('\n' + t);
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

// an audit chain as audit.mjs writes and checks it
const chainSha = s => sha(s).slice(0, 24);
function chain(actions) {
  let prev = '', out = '';
  for (const action of actions) { const e = { at: new Date().toISOString(), who: 'x@careplix.test', name: null, action, target: null, detail: null, prev }; e.hash = chainSha(JSON.stringify(e)); prev = e.hash; out += JSON.stringify(e) + '\n'; }
  return out;
}
function chainOK(file) {
  let prev = '';
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const e of lines) { const { hash, ...rest } = e; if (e.prev !== prev || chainSha(JSON.stringify(rest)) !== hash) return { ok: false, lines }; prev = hash; }
  return { ok: true, lines };
}
// every file under a folder, with its hash
function snapshot(dir) {
  const out = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = sha(fs.readFileSync(p)); } };
  walk(dir);
  return out;
}

// —— the backup, in a process of its own (its settings are read when its modules load) ——
if (process.argv[2] === '--backup') { await backupChecks(process.argv[3]); process.exit(failed ? 1 : 0); }

const KEEP = process.argv.includes('--keep');
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'videogen-workspaces-check-'));
// stands in for the AI writer: any call is written down, and fails
const STUB = path.join(D, 'ai-writer-stub.sh'), CALLS = path.join(D, 'ai-writer-calls.log');
fs.writeFileSync(STUB, `#!/bin/sh\necho "$@" >> '${CALLS}'\nexit 1\n`, { mode: 0o755 });
const env = (root, extra = {}) => ({
  PATH: process.env.PATH, HOME: process.env.HOME, HOST: '127.0.0.1',
  VIDEOGEN_WORKSPACES: root + '/workspaces', VIDEOGEN_PLATFORM: root + '/platform',
  VIDEOGEN_FILMS: root + '/old/films', VIDEOGEN_BRANDS: root + '/old/brands', VIDEOGEN_PROOF: root + '/old/proof', VIDEOGEN_UPLOADS: root + '/old/uploads', VIDEOGEN_GOVERNANCE: root + '/old/governance',
  LEMO_OPUSCAR_HOME: root + '/no-library', CLAUDE_BIN: STUB, CLOUDSDK_CONFIG: root + '/no-gcloud',
  ANTHROPIC_API_KEY: '', FAL_KEY: '', VERTEX_PROJECT: '', MEDIA_BUCKET: '', ...extra,
});
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
async function start(e) {
  const child = spawn(process.execPath, [path.join(APP, 'server.mjs')], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const exit = new Promise(r => child.on('exit', code => r(code)));
  for (let i = 0; i < 150 && child.exitCode === null; i++) {
    try { await fetch(`http://localhost:${e.PORT}/login`, { redirect: 'manual' }); return { child, exit, log: () => out, up: true }; } catch {}
    await sleep(100);
  }
  return { child, exit, log: () => out, up: false, code: await Promise.race([exit, sleep(3000).then(() => null)]) };
}
const stop = async s => { if (s.child.exitCode === null) { s.child.kill('SIGTERM'); await Promise.race([s.exit, sleep(10000)]); if (s.child.exitCode === null) s.child.kill('SIGKILL'); } };

try {
  await migration();
  await isolation();
  section('The backup: each workspace in its own folder of the bucket');
  const b = spawn(process.execPath, [fileURLToPath(import.meta.url), '--backup', path.join(D, 'backup')], { env: env(path.join(D, 'backup'), { MEDIA_BUCKET: 'check-bucket', MEDIA_PREFIX: 'studio/' }), stdio: 'inherit' });
  const code = await new Promise(r => b.on('exit', r));
  ok(code === 0, 'the backup checks passed');
} catch (e) {
  ok(false, 'the check itself stopped', e.stack);
} finally {
  console.log(`\n${passed} passed, ${failed} failed.`);
  if (KEEP) console.log('Data kept in ' + D);
  else if (path.basename(D).startsWith('videogen-workspaces-check-')) fs.rmSync(D, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

// —— 1. a studio from before workspaces ——
async function migration() {
  section('Moving a studio from before workspaces into the CarePlix workspace');
  const M = path.join(D, 'migrate'), old = M + '/old';
  write(old + '/films/q-old/meta.json', JSON.stringify({ id: 'q-old', mode: 'quick', title: 'Old film', created: '2026-10-01T00:00:00Z', status: 'draft' }));
  write(old + '/brands/kit/brand.json', JSON.stringify({ id: 'kit', name: 'Kit' }));
  write(old + '/brands/_fonts/Inter.ttf', 'font');
  write(old + '/proof/proof.json', '[]');
  write(old + '/uploads/a.png', PNG('a'));
  write(old + '/governance/team.json', JSON.stringify({ people: { 'lead@careplix.test': { roles: ['lead'] } } }));
  write(old + '/governance/audit.jsonl', chain(['team.roles-set', 'proof.added']));
  write(old + '/governance/storage-manifest.json', JSON.stringify({ files: { 'studio/films/q-old/meta.json': { size: 1, mtime: 1 } }, lastSync: null }));
  const port = await freePort(), e = env(M, { PORT: String(port) });
  let s = await start(e);
  ok(s.up, 'the server starts and moves the data', s.log());
  const ws = M + '/workspaces/careplix';
  ok(['films/q-old/meta.json', 'brands/kit/brand.json', 'proof/proof.json', 'uploads/a.png', 'governance/team.json'].every(f => fs.existsSync(path.join(ws, f))), 'films, brand kits, proof, uploads and the team are in workspaces/careplix');
  ok(['films', 'brands', 'proof', 'uploads', 'governance'].every(a => !fs.existsSync(path.join(old, a)) || !fs.readdirSync(path.join(old, a)).length), 'nothing is left in the old folders');
  ok(fs.existsSync(M + '/platform/fonts/Inter.ttf'), 'the font cache moved to the studio’s own folder');
  const man = json(M + '/platform/storage-manifest.json');
  ok(man.moved?.films === 'workspaces/careplix/films' && man.files['studio/films/q-old/meta.json'], 'the backup manifest moved, and records where each old folder’s files now go in the bucket');
  const c = chainOK(ws + '/governance/audit.jsonl');
  ok(c.ok && c.lines.length === 3 && c.lines[2].action === 'workspace.created', 'the audit chain is intact and continues with the move', JSON.stringify(c.lines.map(l => l.action)));
  const films = await fetch(`http://localhost:${port}/api/films`).then(r => r.json());
  ok(films.some(f => f.id === 'q-old'), 'the old film is in the CarePlix workspace’s Library');
  await stop(s);
  s = await start(e);
  ok(s.up && chainOK(ws + '/governance/audit.jsonl').lines.length === 3, 'starting again moves nothing more');
  await stop(s);
  // data in both places: the start stops rather than merge them
  write(old + '/films/q-new/meta.json', JSON.stringify({ id: 'q-new', mode: 'quick', created: '2026-10-02T00:00:00Z', status: 'draft' }));
  s = await start(e);
  ok(!s.up && s.code === 1 && /won’t merge/.test(s.log()), 'with data in both the old and new folders, the server refuses to start', s.log());
  ok(fs.existsSync(old + '/films/q-new/meta.json') && fs.existsSync(ws + '/films/q-old/meta.json'), 'and moves neither');
}

// —— 2. two customers on one studio ——
async function isolation() {
  const W = path.join(D, 'studio'), port = await freePort(), BASE = `http://localhost:${port}`, SECRET = crypto.randomBytes(32).toString('hex');
  write(W + '/platform/fonts/Inter.ttf', 'a font stand-in, so no font is downloaded');
  const s = await start(env(W, { PORT: String(port), GOOGLE_CLIENT_ID: 'check.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'check', SESSION_SECRET: SECRET, PUBLIC_URL: BASE,
    ADMIN_EMAILS: 'op@studio.test', ALLOWED_DOMAINS: 'careplix.test' }));
  if (!ok(s.up, 'the server starts with sign-in on', s.log())) return;
  try { await customers(W, BASE, SECRET); } finally { await stop(s); }
}

async function customers(W, BASE, SECRET) {
  // sessions as the server signs them after a Google sign-in (hd: the Google Workspace domain it proved)
  const mac = x => crypto.createHmac('sha256', SECRET).update(x).digest('base64url');
  const session = (email, hd) => { const b = Buffer.from(JSON.stringify({ kind: 'session', v: 2, email, name: email.split('@')[0], picture: null, hd, exp: Date.now() / 1000 + 3600 })).toString('base64url'); return b + '.' + mac(b); };
  const PEOPLE = { op: ['op@studio.test', null], alice: ['alice@acme.test', 'acme.test'], bob: ['bob@bolt.test', 'bolt.test'], carol: ['carol@acme.test', 'acme.test'],
    carolPersonal: ['carol@acme.test', null], mallory: ['mallory@evil.test', 'evil.test'] };
  async function call(who, method, url, { body, raw, type, ws, header } = {}) {
    const [email, hd] = PEOPLE[who], headers = { Cookie: `vg_session=${session(email, hd)}${ws ? '; vg_ws=' + ws : ''}` };
    if (header) headers['X-Workspace'] = header;
    let payload;
    if (raw) { payload = raw; headers['Content-Type'] = type; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
    const text = await r.text().catch(() => '');
    let j = null;
    try { j = JSON.parse(text); } catch {}
    return { status: r.status, text, json: j, location: r.headers.get('location'), cookie: r.headers.get('set-cookie') };
  }
  const asA = (m, u, o = {}) => call('alice', m, u, { ws: 'acme', ...o }), asB = (m, u, o = {}) => call('bob', m, u, { ws: 'bolt', ...o });
  const ALL = ['creator', 'lead', 'reviewer', 'budget', 'admin'];
  let r;

  section('Workspaces, and who can enter them');
  r = await call('op', 'POST', '/api/workspaces', { body: { id: 'acme', name: 'Acme Health', domains: ['acme.test'], admins: ['alice@acme.test'] } });
  ok(r.status === 200, 'an operator creates workspace A (acme) and names its first admin', r.text);
  r = await call('op', 'POST', '/api/workspaces', { body: { id: 'bolt', name: 'Bolt Care', domains: ['bolt.test'], admins: ['bob@bolt.test'] } });
  ok(r.status === 200, 'an operator creates workspace B (bolt) and names its first admin', r.text);
  r = await call('op', 'POST', '/api/workspaces', { body: { id: 'other', name: 'Other', domains: ['bolt.test'] } });
  ok(r.status === 409, 'a domain can belong to one workspace only', r.text);
  r = await asA('POST', '/api/workspaces', { body: { id: 'x', name: 'X' } });
  ok(r.status === 403, 'a workspace admin can’t create workspaces', r.text);
  ok((await asA('PUT', '/api/team/alice%40acme.test', { body: { name: 'Alice', roles: ALL } })).status === 200, 'A’s admin takes every role in A');
  ok((await asB('PUT', '/api/team/bob%40bolt.test', { body: { name: 'Bob', roles: ALL } })).status === 200, 'B’s admin takes every role in B');
  r = await asA('GET', '/api/me');
  ok(r.json?.workspace?.id === 'acme' && r.json.workspaces.map(w => w.id).join() === 'acme' && ALL.every(x => r.json.roles.includes(x)), 'A’s admin is in A only, with every role', r.text);
  r = await call('op', 'GET', '/api/me', { ws: 'bolt' });
  ok(r.json?.workspace?.id === 'careplix' && r.json.operator && r.json.workspaces.map(w => w.id).join() === 'careplix', 'an operator is only in CarePlix: asking for B lands them in CarePlix', r.text);
  ok((await call('op', 'POST', '/api/workspaces/switch', { body: { id: 'bolt' } })).status === 403, 'an operator can’t switch into a customer’s workspace');
  r = await call('carol', 'GET', '/api/me');
  ok(r.json?.workspace?.id === 'acme' && r.json.roles.join() === 'creator', 'someone signing in with a Google Workspace account on A’s domain is a Creator in A', r.text);
  ok((await call('carolPersonal', 'GET', '/api/me')).status === 403, 'the same address on a personal Google account (no Workspace domain) isn’t let in');
  ok((await call('mallory', 'GET', '/api/me')).status === 403, 'someone in no workspace gets nothing from the API');
  r = await call('mallory', 'GET', '/');
  ok(r.status === 302 && r.location === '/login?error=not-invited' && /vg_session=;/.test(r.cookie || ''), 'and is signed out and sent to the sign-in page, told they weren’t invited', `${r.status} ${r.location}`);

  section('Setting up each workspace’s things');
  const COLORS = { bg: '#101010', surface: '#202020', ink: '#ffffff', muted: '#999999', accent: '#ff3300' }, FONTS = { display: 'Inter', body: 'Inter' };
  const B = {}, A = {};
  r = await asB('POST', '/api/brands', { body: { name: 'BOLT-SECRET brand', colors: COLORS, fonts: FONTS } }); B.brand = r.json?.id;
  r = await asB('POST', `/api/brands/${B.brand}/logo`, { raw: PNG('bolt logo'), type: 'image/png' }); ok(r.status === 200, 'B: a brand kit with a logo', r.text);
  r = await asB('POST', '/api/uploads', { raw: PNG('BOLT-SECRET photo'), type: 'image/png' }); B.upload = r.json?.id;
  r = await asB('POST', '/api/proof', { body: { claim: 'BOLT-SECRET: 42% faster checks', value: '42%', kind: 'stat', source: { type: 'study', title: 'Bolt study' } } }); B.proof = r.json?.id;
  r = await asB('PUT', `/api/proof/${B.proof}`, { body: { status: 'approved' } }); ok(r.json?.status === 'approved', 'B: an approved Proof Library entry', r.text);
  r = await asB('POST', '/api/films', { body: { sample: true, template: 'keynote', aspect: '16:9', brandId: B.brand } }); B.film = r.json?.id;
  r = await asB('POST', '/api/decks', { body: { sample: true, brandId: B.brand } }); B.deck = r.json?.id;
  // a production with a frame, and an exported film, as the studio leaves them (making them for real needs AI services)
  const BF = W + '/workspaces/bolt/films', now = new Date().toISOString();
  B.prod = 'p-check-bolt';
  write(`${BF}/${B.prod}/meta.json`, JSON.stringify({ id: B.prod, mode: 'production', title: 'BOLT-SECRET production', format: 'brand', owner: 'bob@bolt.test', created: now, status: 'draft' }));
  write(`${BF}/${B.prod}/production.json`, JSON.stringify({ brief: 'BOLT-SECRET brief', format: 'brand', style: 'sketch', kind: 'ad', seconds: 30, aspect: '16:9', brandId: B.brand, concepts: [{ title: 'c' }], concept: 0,
    cast: [], locations: [], media: [], refs: [], cost: 0, shots: [{ id: 's1', dur: 3, action: 'a', vo: '', board: 'boards/s1.svg', takes: [], take: null, proof: [] }] }));
  write(`${BF}/${B.prod}/boards/s1.svg`, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  B.done = 'q-check-bolt-done';
  write(`${BF}/${B.done}/meta.json`, JSON.stringify({ id: B.done, mode: 'quick', kind: 'film', title: 'BOLT-SECRET film', template: 'keynote', owner: 'bob@bolt.test', created: now, status: 'done', output: 'final.mp4' }));
  write(`${BF}/${B.done}/content.json`, JSON.stringify({ template: 'keynote', scenes: [] }));
  write(`${BF}/${B.done}/final.mp4`, 'BOLT-SECRET video');
  r = await asB('POST', '/api/reviews', { body: { asset: B.done, note: 'BOLT-SECRET note' } }); B.review = r.json?.id;
  r = await asB('POST', `/api/reviews/${B.review}/comments`, { body: { text: 'BOLT-SECRET comment' } }); B.comment = r.json?.comments?.[0]?.id;
  for (let i = 0; i < 50 && (await asB('GET', `/api/reviews/${B.review}`)).json?.checks?.status === 'running'; i++) await sleep(100);
  ok(Object.values(B).every(Boolean), 'B: a film, deck, production, upload, and a film in review with a comment', JSON.stringify(B));
  // B has spent $5 this month against its own $1 cap
  const ledgerB = W + '/workspaces/bolt/governance/ledger.jsonl', ledgerA = W + '/workspaces/acme/governance/ledger.jsonl';
  write(ledgerB, Array.from({ length: 5 }, () => JSON.stringify({ at: now, who: 'bob@bolt.test', name: 'Bob', brandId: B.brand, asset: B.film, kind: 'video', engine: null, amount: 1, note: null }) + '\n').join(''));
  ok((await asB('PUT', '/api/spend/caps', { body: { total: 1 } })).status === 200, 'B: $5 spent this month, against a $1 cap');
  r = await asA('POST', '/api/films', { body: { sample: true, template: 'keynote', aspect: '16:9' } }); A.film = r.json?.id;
  r = await asA('POST', '/api/proof', { body: { claim: 'Acme claim' } }); A.proof = r.json?.id;
  ok(A.film && A.proof, 'A: a film and a Proof Library entry of its own');
  const beforeB = snapshot(W + '/workspaces/bolt'), beforeLedgerA = fs.existsSync(ledgerA) ? fs.readFileSync(ledgerA, 'utf8') : '';

  section('A’s admin tries every route on B’s things');
  const name = u => Object.entries(B).reduce((s, [k, v]) => s.split(v).join(`<B ${k}>`), u);
  const T = 'keynote';
  const tries = [
    // films
    ['GET', `/api/films/${B.film}`], ['PUT', `/api/films/${B.film}/content`, { body: { scenes: [{ type: 'title', text: 'changed' }] } }],
    ['PUT', `/api/films/${B.film}/brand`, { body: { brandId: null } }], ['PUT', `/api/films/${B.film}/settings`, { body: { narration: false } }],
    ['POST', `/api/films/${B.film}/render`], ['GET', `/api/films/${B.film}/files`], ['GET', `/api/films/${B.film}/events`], ['POST', `/api/films/${B.film}/cancel`],
    ['GET', `/api/films/${B.film}/delete`], ['DELETE', `/api/films/${B.film}`], ['DELETE', `/api/films/${B.done}`],
    // productions, including starting paid work on them
    ['GET', `/api/productions/${B.prod}`], ['PUT', `/api/productions/${B.prod}`, { body: { title: 'changed' } }], ['POST', `/api/productions/${B.prod}/concepts`],
    ['POST', `/api/productions/${B.prod}/shots`, { body: { concept: 0 } }], ['POST', `/api/productions/${B.prod}/boards`], ['POST', `/api/productions/${B.prod}/board/s1`, { body: {} }],
    ['POST', `/api/productions/${B.prod}/shoot`, { body: {} }], ['POST', `/api/productions/${B.prod}/cut`, { body: {} }], ['POST', `/api/productions/${B.prod}/voice-sample`, { body: { voice: 'x' } }],
    ['POST', `/api/productions/${B.prod}/animatic`, { body: {} }], ['GET', `/api/films/${B.prod}/delete`], ['DELETE', `/api/films/${B.prod}`],
    // decks
    ['GET', `/api/decks/${B.deck}`], ['PUT', `/api/decks/${B.deck}`, { body: { title: 'changed', slides: [] } }], ['POST', `/api/decks/${B.deck}/slides/0/rewrite`, { body: { instruction: 'x' } }],
    ['POST', `/api/decks/${B.deck}/export`, { body: {} }], ['POST', `/api/decks/${B.deck}/video`, { body: {} }], ['DELETE', `/api/films/${B.deck}`],
    // new paid work that names B's brand kit or upload
    ['POST', '/api/films', { body: { prompt: 'x', template: T, brandId: B.brand } }], ['POST', '/api/films', { body: { sample: true, template: T, brandId: B.brand } }],
    ['POST', '/api/films', { body: { prompt: 'x', template: T, media: [B.upload] } }, [400]],
    ['POST', '/api/productions', { body: { brief: 'x', format: 'brand', brandId: B.brand } }], ['POST', '/api/productions', { body: { brief: 'x', format: 'brand', media: [B.upload] } }, [400]],
    ['POST', '/api/decks/outline', { body: { brief: 'x', brandId: B.brand } }], ['POST', '/api/decks', { body: { brief: 'x', brandId: B.brand } }], ['POST', '/api/decks', { body: { sample: true, brandId: B.brand } }],
    ['POST', '/api/director', { body: { prompt: 'x', style: 'x', brandId: B.brand } }, [403]],
    // brand kits
    ['PUT', `/api/brands/${B.brand}`, { body: { name: 'changed' } }], ['DELETE', `/api/brands/${B.brand}`], ['POST', `/api/brands/${B.brand}/logo`, { raw: PNG('x'), type: 'image/png' }], ['DELETE', `/api/brands/${B.brand}/logo`],
    // proof
    ['PUT', `/api/proof/${B.proof}`, { body: { claim: 'changed' } }], ['PUT', `/api/proof/${B.proof}`, { body: { status: 'retired' } }], ['DELETE', `/api/proof/${B.proof}`],
    // reviews and sign-offs
    ['GET', `/api/reviews/${B.review}`], ['GET', `/api/reviews/${B.review}/media`], ['GET', `/api/reviews/${B.review}/poster`],
    ['POST', `/api/reviews/${B.review}/decide/lead`, { body: { decision: 'approve', signature: { name: 'Alice Acme', agree: true } } }], ['POST', `/api/reviews/${B.review}/accept`, { body: { key: 'x', reason: 'a long enough reason' } }],
    ['POST', `/api/reviews/${B.review}/comments`, { body: { text: 'x' } }], ['PUT', `/api/reviews/${B.review}/comments/${B.comment}`, { body: { resolved: true } }],
    ['POST', `/api/reviews/${B.review}/withdraw`], ['POST', `/api/reviews/${B.review}/recheck`], ['POST', '/api/reviews', { body: { asset: B.done } }],
    // the workspaces themselves, and the whole backup
    ['POST', '/api/workspaces/switch', { body: { id: 'bolt' } }, [403]], ['PUT', '/api/workspaces/bolt', { body: { limit: 1000 } }, [403]], ['GET', '/api/workspaces/audit', {}, [403]],
    ['GET', '/api/storage/server', {}, [403]], ['POST', '/api/storage/sync', {}, [403]],
    ['GET', '/api/films', { header: 'bolt' }, [403]],
    // files, by their URLs, and by walking out of A's folders
    ['GET', `/films/${B.film}/content.json`], ['GET', `/films/${B.film}/meta.json`], ['GET', `/films/${B.done}/final.mp4`], ['GET', `/films/${B.prod}/production.json`],
    ['GET', `/films/${B.prod}/boards/s1.svg`], ['GET', `/films/${B.deck}/deck.json`], ['GET', `/brands/${B.brand}/logo.png`], ['GET', `/brands/${B.brand}/brand.json`], ['GET', `/uploads/${B.upload}`],
    ['GET', `/films/..%2F..%2Fbolt%2Ffilms%2F${B.film}%2Fmeta.json`, {}, [403]], ['GET', `/brands/..%2F..%2Fbolt%2Fbrands%2F${B.brand}%2Flogo.png`, {}, [403]],
    ['GET', `/uploads/..%2F..%2Fbolt%2Fuploads%2F${B.upload}`, {}, [403]], ['GET', `/api/films/..%2F..%2Fbolt%2Ffilms%2F${B.film}`, {}, [400]],
  ];
  for (const [m, u, o = {}, want = [404]] of tries) {
    r = await asA(m, u, o);
    ok(want.includes(r.status) && !r.text.includes('BOLT-SECRET'), `${m} ${name(u)}${o.header ? ' (as if in B)' : ''} → ${r.status}`, r.text.slice(0, 200));
  }

  section('Nothing A sees lists anything of B’s');
  const marks = ['BOLT-SECRET', 'bob@bolt.test', '"bolt"', ...Object.values(B)];
  const lists = ['/api/films', '/api/brands', '/api/proof', '/api/reviews', '/api/reviews/candidates', '/api/spend', '/api/audit', '/api/audit?target=' + B.review, '/api/team',
    '/api/storage', '/api/storage/usage', '/api/workspaces', '/api/me'];
  for (const u of lists) {
    r = await asA('GET', u);
    const seen = marks.filter(x => r.text.includes(x));
    ok(r.status === 200 && !seen.length, `GET ${name(u)}`, r.status + ' ' + seen.join(', '));
  }
  r = await call('alice', 'GET', '/api/films', { ws: 'bolt' });
  ok(r.status === 200 && r.json.some(f => f.id === A.film) && !marks.some(x => r.text.includes(x)), 'with a cookie asking for B, A’s admin still gets A’s Library');

  section('Work inside a workspace still works');
  ok((await asA('GET', `/api/films/${A.film}`)).status === 200, 'A’s admin opens A’s film');
  ok((await asA('GET', `/films/${A.film}/content.json`)).status === 200, 'and its files');
  ok((await asA('PUT', `/api/proof/${A.proof}`, { body: { claim: 'Acme claim, edited' } })).json?.claim === 'Acme claim, edited', 'and edits A’s proof');
  r = await asA('DELETE', `/api/films/${A.film}`);
  ok(r.status === 200 && !fs.existsSync(`${W}/workspaces/acme/films/${A.film}`), 'and deletes A’s film', r.text);
  ok((await asB('GET', `/api/films/${B.film}`)).status === 200, 'B’s admin opens B’s film');

  section('Changes A makes stay in A');
  ok((await asA('PUT', '/api/spend/caps', { body: { total: 100 } })).status === 200, 'A sets its own cap');
  ok((await asA('DELETE', '/api/team/bob%40bolt.test')).status === 200, 'A shuts out B’s admin from A');
  ok((await asA('DELETE', '/api/team/carol%40acme.test')).status === 200, 'A removes Carol, who joined through A’s domain');
  ok((await call('carol', 'GET', '/api/me')).status === 403, 'Carol is out at once, although her domain matches');
  ok((await asB('GET', '/api/me')).json?.workspace?.id === 'bolt', 'B’s admin still works in B');

  section('Spending: each workspace is charged, and capped, on its own');
  r = await asB('POST', '/api/films', { body: { template: T, prompt: 'x' } });
  ok(r.status === 402 && /cap of \$1\.00/.test(r.json?.error), 'B is over its own cap, so B’s paid work is refused', r.text);
  r = await asA('POST', '/api/films', { body: { template: T } });
  ok(r.status === 400 && /prompt/.test(r.json?.error), 'B’s spending doesn’t count against A: A’s request gets past the caps (and stops at the missing prompt)', r.text);
  ok((await call('op', 'PUT', '/api/workspaces/acme', { body: { limit: 0.5 } })).status === 200, 'an operator limits A to $0.50 a month');
  write(ledgerA, beforeLedgerA + JSON.stringify({ at: new Date().toISOString(), who: 'alice@acme.test', name: 'Alice', brandId: null, asset: A.film, kind: 'writer', engine: null, amount: 1, note: null }) + '\n');
  r = await asA('POST', '/api/films', { body: { template: T } });
  ok(r.status === 402 && /workspace past its monthly limit of \$0\.50/.test(r.json?.error), 'A is past its operator’s limit, so A’s paid work is refused', r.text);
  r = await asB('POST', '/api/films', { body: { template: T, prompt: 'x' } });
  ok(r.status === 402 && !/limit/.test(r.json?.error), 'A’s limit is A’s alone: B is still refused only by its own cap', r.text);
  const spentA = (await asA('GET', '/api/spend')).json, spentB = (await asB('GET', '/api/spend')).json;
  ok(spentA.total === 1 && spentB.total === 5 && spentA.limit === 0.5 && spentB.limit === null, 'each workspace’s Spend page shows its own total and limit', `A ${spentA.total}/${spentA.limit}, B ${spentB.total}/${spentB.limit}`);

  section('Afterwards');
  const afterB = snapshot(W + '/workspaces/bolt');
  const changed = [...new Set([...Object.keys(beforeB), ...Object.keys(afterB)])].filter(f => beforeB[f] !== afterB[f]);
  ok(!changed.length, `B’s folder is unchanged, byte for byte (${Object.keys(afterB).length} files)`, changed.join(', '));
  const ledA = fs.readFileSync(ledgerA, 'utf8');
  ok(ledA.startsWith(beforeLedgerA) && ledA.split('\n').filter(Boolean).length === beforeLedgerA.split('\n').filter(Boolean).length + 1, 'A’s ledger has only the line this check wrote: none of the attempts charged anything');
  const calls = fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').split('\n').filter(l => l && l !== '--version') : [];
  ok(!calls.length, 'no AI writer was called', calls.join(' | '));
  const auditA = chainOK(W + '/workspaces/acme/governance/audit.jsonl'), auditB = chainOK(W + '/workspaces/bolt/governance/audit.jsonl');
  ok(auditA.ok && auditB.ok, `each workspace’s audit chain is intact (A ${auditA.lines.length} entries, B ${auditB.lines.length})`);
  ok(auditA.lines.some(e => e.action === 'workspace.created' && e.who === 'op@studio.test') && auditA.lines.some(e => e.action === 'workspace.changed'), 'A’s audit trail shows the operator creating A and changing its limit');
  const ofA = [A.film, A.proof, 'Acme claim'], ofB = ['BOLT-SECRET', ...Object.values(B)];
  ok(!auditA.lines.some(e => ofB.some(x => JSON.stringify(e).includes(x))) && !auditB.lines.some(e => ofA.some(x => JSON.stringify(e).includes(x))), 'neither audit trail records anything done to the other workspace’s things');
}

// —— 3. the backup, against a stand-in bucket ——
async function backupChecks(dir) {
  const bucket = new Map(), deleted = [];
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const reply = (body = {}, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    if (url.includes('/computeMetadata/')) return url.includes('/token') ? reply({ access_token: 't', expires_in: 3600 }) : reply('check-project');
    if (url.includes('/upload/')) { const k = decodeURIComponent(/name=([^&]+)/.exec(url)[1]); let n = 0; for await (const c of opts.body) n += c.length; bucket.set(k, n); return reply({}); }
    if (opts.method === 'DELETE') { const k = decodeURIComponent(url.split('/o/')[1]); deleted.push(k); bucket.delete(k); return reply(); }
    if (url.includes('alt=media')) { const k = decodeURIComponent(url.split('/o/')[1].split('?')[0]); return bucket.has(k) ? reply('restored') : reply('', 404); }
    if (url.includes('/o?prefix=')) return reply({ items: [...bucket].map(([name, size]) => ({ name, size: String(size) })) });
    return reply('', 404);
  };
  const old = new Date(Date.now() - 3600e3), age = d => { for (const f of fs.readdirSync(d, { recursive: true })) fs.utimesSync(path.join(d, f), old, old); };
  // a studio from before workspaces whose files are already in the bucket at their old place
  for (let i = 0; i < 3; i++) write(`${dir}/old/films/q-${i}/meta.json`, JSON.stringify({ id: `q-${i}`, mode: 'production', created: old.toISOString() }));
  write(dir + '/old/brands/_fonts/Inter.ttf', 'font');
  write(dir + '/old/governance/audit.jsonl', chain(['team.roles-set']));
  const legacy = ['studio/films/q-0/meta.json', 'studio/films/q-1/meta.json', 'studio/films/q-2/meta.json', 'studio/brands/_fonts/Inter.ttf', 'studio/governance/audit.jsonl'];
  for (const k of legacy) bucket.set(k, 1);
  write(dir + '/old/governance/storage-manifest.json', JSON.stringify({ files: Object.fromEntries(legacy.map(k => [k, { size: 1, mtime: 1 }])), lastSync: null }));
  age(dir + '/old');
  const { migrate, createWorkspace } = await import('../lib/workspaces.mjs');
  const { syncNow, workspaceStatus, restore, deletedOnPurpose } = await import('../lib/storage.mjs');
  migrate(() => {});
  createWorkspace({ id: 'acme', name: 'Acme' }, { email: 'op@studio.test' });
  for (let i = 0; i < 40; i++) write(`${dir}/workspaces/acme/films/q-a${i}/meta.json`, JSON.stringify({ id: `q-a${i}`, mode: 'production' }));
  age(dir + '/workspaces'); age(dir + '/platform');
  let pass = await syncNow();
  ok(pass.errorCount === 0, 'the first pass after the move has no problems', JSON.stringify(pass.errors));
  ok(bucket.has('studio/workspaces/careplix/films/q-0/meta.json') && bucket.has('studio/workspaces/acme/films/q-a0/meta.json'), 'each workspace’s files go to its own folder: studio/workspaces/<id>/…');
  ok(bucket.has('studio/platform/workspaces.json') && bucket.has('studio/platform/fonts/Inter.ttf'), 'the list of workspaces and the font cache go to studio/platform/');
  ok(legacy.every(k => !bucket.has(k)), 'each file at its old place in the bucket is removed once its copy at the new place is up', legacy.filter(k => bucket.has(k)).join(', '));
  ok(![...bucket.keys()].some(k => k.endsWith('storage-manifest.json')), 'the backup’s own manifest isn’t backed up');
  // many of one workspace's files missing at once: that workspace's are held back, the other's removal goes ahead
  for (let i = 0; i < 30; i++) fs.rmSync(`${dir}/workspaces/acme/films/q-a${i}`, { recursive: true });
  fs.rmSync(`${dir}/workspaces/careplix/films/q-2`, { recursive: true });
  pass = await syncNow();
  ok(bucket.has('studio/workspaces/acme/films/q-a0/meta.json') && pass.errors.some(e => e.startsWith('studio/workspaces/acme/')), 'when too many of A’s files go missing at once, none of A’s are removed from the bucket', JSON.stringify(pass.errors));
  ok(!bucket.has('studio/workspaces/careplix/films/q-2/meta.json'), 'while CarePlix’s ordinary removal goes ahead in the same pass');
  ok(workspaceStatus('acme').lastSync.errorCount === 1 && workspaceStatus('careplix').lastSync.errorCount === 0, 'each workspace’s admins see only their own backup problems');
  ok(workspaceStatus('careplix').files === 3 && workspaceStatus('acme').files === 41, 'and only their own files', `careplix ${workspaceStatus('careplix').files}, acme ${workspaceStatus('acme').files}`);
  // a folder deleted on purpose in A passes the guard
  deletedOnPurpose(`${dir}/workspaces/acme/films`, 'q-a0');
  pass = await syncNow();
  ok(!bucket.has('studio/workspaces/acme/films/q-a0/meta.json') && bucket.has('studio/workspaces/acme/films/q-a1/meta.json'), 'a film deleted on purpose in A leaves the bucket; the rest of A’s missing files stay');
  // one workspace restored on its own: a file CarePlix lost stays lost
  fs.rmSync(`${dir}/workspaces/careplix/films/q-1`, { recursive: true });
  const r = await restore({ workspace: 'acme', log: () => {} });
  ok(r.fetched === 29 && fs.existsSync(`${dir}/workspaces/acme/films/q-a5/meta.json`) && !fs.existsSync(`${dir}/workspaces/careplix/films/q-1/meta.json`), 'restoring one workspace fetches its files and nothing of another’s', JSON.stringify(r));
}
