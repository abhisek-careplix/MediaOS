// CarePlix Studio (VideoGen): a web app for films, decks and storyboards on top of the Lemo-Opuscar library.
//   node app/server.mjs   →  http://localhost:5178
import './lib/localenv.mjs';   // first: local keys must be in place before any module reads its settings
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { APP, FILMS, LIB, UPLOADS } from './lib/paths.mjs';
import { TEMPLATES, VOICES, libraryStyles } from './lib/templates.mjs';
import { startJob, getJob, emit, subscribe, cancel, readMeta, writeMeta, readLog } from './lib/jobs.mjs';
import { renderQuick } from './lib/pipeline.mjs';
import { writeScript, runDirector, writeBrand } from './lib/claude.mjs';
import { AUTH, authOn, configProblems, currentUser, startLogin, finishLogin, logout } from './lib/auth.mjs';
import { writeOutline, writeDeck, rewriteSlide, checkDeck, readDeck, saveDeck, sampleDeck, exportDeck, deckToScript, AUDIENCES } from './lib/decks.mjs';
import { LAYOUTS } from './public/js/deck-render.js';
import { listProof, addProof, updateProof, deleteProof, importCSV, searchPubMed } from './lib/proof.mjs';
import { FORMATS, STYLES, readProduction, saveProduction, writeConcepts, writeShots, drawBoard, drawBoards, ensureCast, review, animaticScript, shootShots, shootable, clipsInto } from './lib/productions.mjs';
import { engines, ENGINES } from './lib/video.mjs';
import { vertexStatus } from './lib/vertex.mjs';
import { BRANDS, FONTS, FONT_LIST, PRESETS, listBrands, readBrand, saveBrand, saveLogo, removeLogo, deleteBrand, ensureFont, brandIntoFilm, brandForPreview } from './lib/brands.mjs';

const PORT = +process.env.PORT || 5178;
const HOST = process.env.HOST || '127.0.0.1';
// OPEN_ACCESS=1: a public site with no sign-in (ignored once Google sign-in is configured)
const OPEN = /^(1|true|yes)$/i.test(process.env.OPEN_ACCESS || '') && !authOn();
// Director runs a shell-capable agent and costs dollars per film: never offered to anonymous visitors
const MAX_DIRECTORS = OPEN ? 0 : /^\d+$/.test(process.env.MAX_DIRECTORS || '') ? +process.env.MAX_DIRECTORS : 1;   // 0 turns Director mode off
const GUEST = { email: 'guest', name: 'Guest', guest: true };
const DIRECTOR_USERS = (process.env.DIRECTOR_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const PUBLIC_HOST = AUTH.publicURL ? new URL(AUTH.publicURL).host : null;

// never face a network without sign-in
const exposed = !/^(127\.0\.0\.1|localhost|::1)$/.test(HOST);
if (exposed && !authOn() && !OPEN) { console.error('Refusing to listen on ' + HOST + ' without sign-in. For a public site with no sign-in set OPEN_ACCESS=1; for CarePlix-only access set GOOGLE_CLIENT_ID (see DEPLOY.md); or use HOST=127.0.0.1.'); process.exit(1); }

// —— hourly limits for the open site: per visitor and site-wide ——
const lim = (name, d) => /^\d+$/.test(process.env[name] || '') ? +process.env[name] : d;
const LIMITS = { script: lim('LIMIT_SCRIPTS_PER_HOUR', 15), render: lim('LIMIT_RENDERS_PER_HOUR', 8), upload: lim('LIMIT_UPLOADS_PER_HOUR', 60), claude: lim('LIMIT_CLAUDE_PER_HOUR', 150) };
const hits = new Map();
// true if allowed (and counted); key is per visitor, or 'site' for the global budget
function allow(bucket, key, max) {
  const k = bucket + ':' + key, now = Date.now(), list = (hits.get(k) || []).filter(t => now - t < 3600e3);
  if (list.length >= max) { hits.set(k, list); return false; }
  list.push(now);
  hits.set(k, list);
  return true;
}
// behind Caddy or a tunnel the visitor's address arrives in a header
const clientIP = req => (OPEN || process.env.TRUST_PROXY ? String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress;
function limited(res, req, bucket, claude = false) {
  if (!OPEN) return false;
  const ip = clientIP(req);
  if (claude && !allow('claude', 'site', LIMITS.claude)) return send(res, 429, { error: 'This site has reached its hourly limit for AI writing. Try again later, or start from the sample script.' }), true;
  if (!allow(bucket, ip, LIMITS[bucket])) return send(res, 429, { error: `You've hit this site's limit of ${LIMITS[bucket]} ${{ render: 'export', script: 'script', upload: 'upload' }[bucket]}${LIMITS[bucket] === 1 ? '' : 's'} an hour. Try again a little later.` }), true;
  return false;
}
if (configProblems().length) { console.error('Sign-in is misconfigured:\n  - ' + configProblems().join('\n  - ')); process.exit(1); }
const SIZES = { '16:9': '1920x1080', '9:16': '1080x1920' };
const KINDS = ['film', 'ad', 'reel'];
// ids from POST /api/uploads → their files (at most 4)
function uploaded(list) {
  return (Array.isArray(list) ? list : []).slice(0, 4).map(id => {
    const file = path.join(UPLOADS, String(id));
    if (!/^[0-9a-f]{20}\.(png|jpg|webp)$/.test(String(id)) || !fs.existsSync(file)) throw Object.assign(new Error('An attached image is missing. Attach it again.'), { code: 400 });
    return file;
  });
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.srt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

fs.mkdirSync(FILMS, { recursive: true });

// —— helpers ——
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function body(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 2e6) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}
async function rawBody(req, limit = 5e6) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('file too large'), { code: 400 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
// serve a file under root, with byte ranges so <video> can seek
function serveFile(req, res, root, rel) {
  const p = path.resolve(root, '.' + path.sep + decodeURIComponent(rel));
  if (p !== root && !p.startsWith(root + path.sep)) return send(res, 403, 'outside root', 'text/plain');
  fs.stat(p, (e, st) => {
    if (e || !st.isFile()) return send(res, 404, 'not found', 'text/plain');
    const type = TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const a = range[1] ? +range[1] : 0, b = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Cache-Control': 'no-store' });
      return fs.createReadStream(p, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const filmDir = id => {
  if (!/^[a-z0-9-]+$/.test(id)) throw Object.assign(new Error('bad film id'), { code: 400 });
  return path.join(FILMS, id);
};

// a quick-mode film folder: the template page + runtime + fonts, ready for content.json
function createQuickFilm({ template, aspect, prompt, voice, narration, model, brandId, owner, kind }) {
  const id = `q-${stamp()}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = filmDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(APP, 'templates', 'shared'), dir, { recursive: true });
  fs.copyFileSync(path.join(APP, 'templates', template, 'scenes.js'), path.join(dir, 'scenes.js'));
  const meta = { id, mode: 'quick', kind: KINDS.includes(kind) ? kind : 'film', template, aspect, size: SIZES[aspect] || SIZES['16:9'], prompt, voice, narration, model, brandId: brandId || null, owner: owner?.email, ownerName: owner?.name, created: new Date().toISOString(), status: 'draft' };
  writeMeta(dir, meta);
  return { id, dir, meta };
}
// media: the film's product photos ([{ src }]); like the brand, kept from the saved film unless the server passes them
function saveContent(dir, script, template, brand, media) {
  const tpl = TEMPLATES[template];
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf8')); } catch {}
  const content = { template, title: script.title, accent: script.accent || tpl.accents[0], bpm: script.bpm || tpl.bpm, scenes: script.scenes };
  // the brand comes from the film's brand kit, never from the editor's copy
  const b = brand === undefined ? prev?.brand : brand;
  if (b) content.brand = b;
  const m = media === undefined ? prev?.media : media;
  if (m?.length) content.media = m;
  fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(content, null, 1));
  const meta = readMeta(dir);
  writeMeta(dir, { ...meta, title: content.title });
  return content;
}

const canDirect = user => MAX_DIRECTORS > 0 && (!authOn() || !DIRECTOR_USERS.length || DIRECTOR_USERS.includes(user.email));

function claudeStatus() {
  try {
    const v = execFileSync(process.env.CLAUDE_BIN || 'claude', ['--version'], { encoding: 'utf8', timeout: 8000 }).trim();
    return { installed: true, version: v, apiKey: !!process.env.ANTHROPIC_API_KEY };
  } catch { return { installed: false }; }
}

function listFilms() {
  return fs.readdirSync(FILMS).map(id => {
    const dir = path.join(FILMS, id), meta = readMeta(dir);
    if (!meta) return null;
    const job = getJob(id);
    const status = job?.status === 'running' ? 'running' : meta.status === 'running' ? 'interrupted' : meta.status;
    return { ...meta, status, step: job?.step, pct: job?.pct, poster: fs.existsSync(path.join(dir, 'poster.jpg')) ? 'poster.jpg' : null };
  }).filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
}

// —— routes ——
async function api(req, res, url, user) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);   // after /api
  const M = req.method;

  if (M === 'GET' && parts[0] === 'config') {
    return send(res, 200, {
      templates: Object.values(TEMPLATES).filter(t => !t.hidden).map(({ id, name, blurb, accents }) => ({ id, name, blurb, accents })),
      voices: VOICES, styles: libraryStyles(), claude: claudeStatus(), lib: LIB, films: FILMS,
      libReady: fs.existsSync(path.join(LIB, 'core/render/video.mjs')), voiceReady: fs.existsSync(path.join(LIB, 'core/tts/kokoro-v1.0.onnx')),
    });
  }
  if (M === 'GET' && parts[0] === 'me') return send(res, 200, { ...user, auth: authOn(), open: OPEN, domains: AUTH.domains, canDirect: canDirect(user) });
  if (M === 'GET' && parts[0] === 'films' && !parts[1]) return send(res, 200, listFilms());

  // —— pre-production: brief → concepts → storyboard → animatic ——
  if (parts[0] === 'productions') {
    if (M === 'GET' && parts[1] === 'meta') {
      const v = await vertexStatus();
      return send(res, 200, { formats: Object.entries(FORMATS).map(([id, f]) => ({ id, name: f.name })), styles: Object.entries(STYLES).map(([id, s]) => ({ id, name: s.name, vertex: !!s.vertex })), vertex: { ok: v.ok }, engines: await engines() });
    }
    if (M === 'POST' && !parts[1]) {
      const b = await body(req);
      if (!String(b.brief || '').trim()) return send(res, 400, { error: 'Write a brief first.' });
      if (!FORMATS[b.format]) return send(res, 400, { error: 'Pick a format.' });
      const photos = uploaded(b.media), looks = uploaded(b.refs);
      if (limited(res, req, 'script', true)) return;
      const id = `p-${stamp()}-${Math.random().toString(36).slice(2, 6)}`, dir = filmDir(id);
      fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
      const copy = (files, sub, stem) => files.map((f, i) => {
        const name = `${sub}/${stem}-${i + 1}${path.extname(f)}`;
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
        fs.copyFileSync(f, path.join(dir, name));
        return name;
      });
      const brand = b.brandId ? readBrand(b.brandId) : null;
      const style = STYLES[b.style] && (!STYLES[b.style].vertex || (await vertexStatus()).ok) ? b.style : 'sketch';
      let p = { brief: String(b.brief).slice(0, 4000), format: b.format, style, kind: KINDS.includes(b.kind) ? b.kind : 'ad', seconds: Math.max(10, Math.min(90, +b.seconds || 30)),
        aspect: b.aspect === '9:16' ? '9:16' : '16:9', brandId: brand?.id || null, brand: brand ? { name: brand.name, tone: brand.tone } : null, notes: String(b.notes || '').slice(0, 4000),
        model: ['sonnet', 'opus', 'haiku'].includes(b.model) ? b.model : 'sonnet', media: copy(photos, 'media', 'product').map(src => ({ src })), refs: copy(looks, 'refs', 'reference'),
        concepts: [], concept: null, cast: [], locations: [], shots: [], cost: 0 };
      writeMeta(dir, { id, mode: 'production', title: p.brief.split(/[.\n]/)[0].slice(0, 70), format: p.format, kind: p.kind, aspect: p.aspect, seconds: p.seconds, brandId: p.brandId, owner: user.email, ownerName: user.name, created: new Date().toISOString(), status: 'draft' });
      try { ({ p } = await writeConcepts(dir, p, { model: p.model })); } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
      saveProduction(dir, p);
      return send(res, 200, { id, meta: readMeta(dir), production: p, review: review(p) });
    }
    const id = parts[1], dir = filmDir(id), p = readProduction(dir);
    if (!p) return send(res, 404, { error: 'no such production' });
    const state = () => ({ meta: readMeta(dir), production: readProduction(dir), review: review(readProduction(dir)), job: getJob(id)?.status === 'running' ? { status: 'running', step: getJob(id).step, pct: getJob(id).pct } : null });
    // the storyboard is drawn in the background; the editor follows /api/films/<id>/events and refetches
    const drawAll = ids => {
      if (getJob(id)?.status === 'running') return false;
      const job = startJob(id, dir, 'boards');
      let done = 0;
      emit(job, { step: `Drawing ${ids.length} frames`, pct: 2 });
      drawBoards(dir, ids, { model: p.model, onStep: step => emit(job, { step }), onShot: (sid, err) => emit(job, { pct: Math.round(100 * ++done / ids.length), step: `Drew ${done} of ${ids.length}` }, err ? `frame ${sid} failed: ${err.message}` : `frame ${sid}`) })
        .then(() => {
          const now = readProduction(dir), first = now.shots.find(s => s.board);
          writeMeta(dir, { ...readMeta(dir), cover: first?.board || null });
          emit(job, { status: 'done', step: 'Storyboard ready', pct: 100 });
        })
        .catch(e => emit(job, { status: 'failed', step: 'Failed', error: String(e.message || e) }, 'Error: ' + e.message));
      return true;
    };
    if (M === 'GET' && !parts[2]) return send(res, 200, state());
    if (M === 'PUT' && !parts[2]) {
      // edits from the storyboard editor; frames, boxes and photos stay the server's
      const b = await body(req), keep = new Map(p.shots.map(s => [s.id, s]));
      const text = (v, n = 600) => String(v ?? '').slice(0, n);
      if (b.title != null) p.title = text(b.title, 120);
      if (b.style && STYLES[b.style]) {
        if (STYLES[b.style].vertex && !(await vertexStatus()).ok) return send(res, 400, { error: 'Generated frames aren’t available on this server right now.' });
        p.style = b.style;
      }
      if (Array.isArray(b.cast)) {
        const refs = new Map(p.cast.map(c => [c.id, c]));
        p.cast = b.cast.slice(0, 6).map(c => ({ id: text(c.id, 12), name: text(c.name, 60), look: text(c.look), wardrobe: text(c.wardrobe, 300), voice: text(c.voice, 200), ref: refs.get(c.id)?.ref || null, refKey: refs.get(c.id)?.refKey || null }));
      }
      if (Array.isArray(b.locations)) p.locations = b.locations.slice(0, 6).map(l => ({ id: text(l.id, 12), name: text(l.name, 60), look: text(l.look) }));
      if (Array.isArray(b.shots)) {
        const photos = (p.media || []).length;
        p.shots = b.shots.slice(0, 30).map(s => {
          const old = keep.get(s.id);
          return { id: old ? old.id : 's' + Math.random().toString(36).slice(2, 8), size: text(s.size, 40), angle: text(s.angle, 80), move: text(s.move, 40), dur: Math.max(0.5, Math.min(12, +s.dur || 2.5)),
            engine: ['video', 'presenter', 'code', 'product'].includes(s.engine) ? s.engine : 'video', action: text(s.action, 900), vo: text(s.vo), super: text(s.super, 200),
            cast: Array.isArray(s.cast) ? s.cast.map(c => text(c, 12)).slice(0, 6) : [], location: text(s.location, 12),
            product: Number.isInteger(s.product) && s.product >= 0 && s.product < photos ? s.product : -1, proof: Array.isArray(s.proof) ? s.proof.map(x => text(x, 40)).slice(0, 6) : [],
            board: old?.board || null, box: old?.box || null, fallback: old?.fallback || null,
            takes: old?.takes || [], take: old?.takes?.some(t => t.id === s.take) ? s.take : old?.take || null };
        });
        for (const [sid, s] of keep) if (!p.shots.some(x => x.id === sid)) {
          if (s.board && /^boards\/[\w-]+\.(svg|png)$/.test(s.board)) fs.rmSync(path.join(dir, s.board), { force: true });
          for (const t of s.takes || []) for (const f of [t.file, t.poster]) if (/^takes\/[\w-]+\.(mp4|jpg)$/.test(f || '')) fs.rmSync(path.join(dir, f), { force: true });
        }
      }
      saveProduction(dir, p);
      if (p.title) writeMeta(dir, { ...readMeta(dir), title: p.title });
      return send(res, 200, state());
    }
    if (M === 'POST' && parts[2] === 'concepts') {
      if (limited(res, req, 'script', true)) return;
      saveProduction(dir, (await writeConcepts(dir, p, { model: p.model })).p);
      return send(res, 200, state());
    }
    if (M === 'POST' && parts[2] === 'shots') {
      const b = await body(req);
      if (!(b.concept >= 0 && b.concept < p.concepts.length)) return send(res, 400, { error: 'Pick a concept.' });
      if (getJob(id)?.status === 'running') return send(res, 409, { error: 'The storyboard is still being drawn.' });
      if (limited(res, req, 'script', true)) return;
      for (const s of p.shots) if (s.board && /^boards\/[\w-]+\.(svg|png)$/.test(s.board)) fs.rmSync(path.join(dir, s.board), { force: true });
      for (const c of p.cast) if (c.ref && /^cast\/[\w-]+\.png$/.test(c.ref)) fs.rmSync(path.join(dir, c.ref), { force: true });
      fs.rmSync(path.join(dir, 'takes'), { recursive: true, force: true });
      p.concept = b.concept;
      const { p: next } = await writeShots(dir, p, { model: p.model });
      saveProduction(dir, next);
      writeMeta(dir, { ...readMeta(dir), title: next.title || readMeta(dir).title, cover: null });
      drawAll(next.shots.map(s => s.id));
      return send(res, 200, state());
    }
    if (M === 'POST' && parts[2] === 'boards') {
      const b = await body(req), ids = Array.isArray(b.ids) && b.ids.length ? b.ids.filter(x => p.shots.some(s => s.id === x)) : p.shots.map(s => s.id);
      if (limited(res, req, 'script', true)) return;
      if (!drawAll(ids)) return send(res, 409, { error: 'The storyboard is already being drawn.' });
      return send(res, 200, state());
    }
    if (M === 'POST' && parts[2] === 'board' && parts[3]) {
      const shot = p.shots.find(s => s.id === parts[3]);
      if (!shot) return send(res, 404, { error: 'no such shot' });
      if (limited(res, req, 'script', true)) return;
      const b = await body(req);
      if (STYLES[p.style]?.vertex) await ensureCast(dir).catch(() => {});
      const r = await drawBoard(dir, readProduction(dir), shot, { note: String(b.note || '').slice(0, 400), model: p.model });
      const fresh = readProduction(dir), s = fresh.shots.find(x => x.id === shot.id);
      if (s) { Object.assign(s, { board: r.board, box: r.box, fallback: r.fallback }); fresh.cost = (fresh.cost || 0) + (r.cost || 0); saveProduction(dir, fresh); }
      return send(res, 200, state());
    }
    // shooting: video takes from the storyboard frames, in the background like the frames
    if (M === 'POST' && parts[2] === 'shoot') {
      const b = await body(req), engine = ENGINES[b.engine] ? b.engine : 'veo-fast';
      if (!(await engines()).some(e => e.id === engine)) return send(res, 400, { error: 'That video engine isn’t available on this server.' });
      const ids = (Array.isArray(b.ids) && b.ids.length ? b.ids : p.shots.map(s => s.id)).filter(x => { const s = p.shots.find(y => y.id === x); return s && shootable(s); });
      if (!ids.length) return send(res, 400, { error: 'No shot can be filmed yet: shots need an Illustrated or Cinematic frame (graphics stay as cards).' });
      if (limited(res, req, 'render')) return;
      if (getJob(id)?.status === 'running') return send(res, 409, { error: 'Something is already running for this production.' });
      const takes = Math.max(1, Math.min(3, +b.takes || 1)), total = ids.length * takes, job = startJob(id, dir, 'shoot');
      let done = 0;
      emit(job, { step: `Shooting ${total} take${total > 1 ? 's' : ''}`, pct: 2 });
      shootShots(dir, ids, { engine, takes, onTake: (sid, err) => emit(job, { pct: Math.round(100 * ++done / total), step: `Shot ${done} of ${total}` }, err ? `take for ${sid} failed: ${err.message}` : `take ${sid}`) })
        .then(() => emit(job, { status: 'done', step: 'Takes ready', pct: 100 }))
        .catch(e => emit(job, { status: 'failed', step: 'Failed', error: String(e.message || e) }, 'Error: ' + e.message));
      return send(res, 200, state());
    }
    // the rough cut: the chosen takes (and the frames of shots not filmed) as a film to review and export in Create
    if (M === 'POST' && parts[2] === 'cut') {
      if (!p.shots.some(s => s.take)) return send(res, 400, { error: 'Shoot at least one shot first.' });
      const b = await body(req), brand = p.brandId ? readBrand(p.brandId) : null;
      const film = createQuickFilm({ template: 'animatic', aspect: p.aspect, prompt: `Rough cut: ${p.title || p.brief.slice(0, 60)}`, voice: b.voice || brand?.voice || 'af_heart', narration: true, model: null, brandId: p.brandId, owner: user, kind: p.kind });
      for (const s of p.shots) if (s.board && /^boards\/[\w-]+\.(svg|png)$/.test(s.board)) {
        fs.mkdirSync(path.join(film.dir, 'boards'), { recursive: true });
        fs.copyFileSync(path.join(dir, s.board), path.join(film.dir, s.board));
      }
      if (p.media?.length) fs.cpSync(path.join(dir, 'media'), path.join(film.dir, 'media'), { recursive: true });
      const clips = await clipsInto(dir, p, film.dir);
      saveContent(film.dir, animaticScript(p, clips), 'animatic', p.brandId ? (await brandIntoFilm(p.brandId, film.dir)).page : null, p.media?.length ? p.media : undefined);
      writeMeta(film.dir, { ...readMeta(film.dir), production: id });
      writeMeta(dir, { ...readMeta(dir), cut: film.id });
      return send(res, 200, { id: film.id });
    }
    if (M === 'POST' && parts[2] === 'animatic') {
      if (!p.shots.length) return send(res, 400, { error: 'Board a concept first.' });
      const b = await body(req), brand = p.brandId ? readBrand(p.brandId) : null;
      const film = createQuickFilm({ template: 'animatic', aspect: p.aspect, prompt: `Animatic: ${p.title || p.brief.slice(0, 60)}`, voice: b.voice || brand?.voice || 'af_heart', narration: true, model: null, brandId: p.brandId, owner: user, kind: p.kind });
      // the film carries its own boards and photos, so it renders on its own
      for (const s of p.shots) if (s.board && /^boards\/[\w-]+\.(svg|png)$/.test(s.board)) {
        fs.mkdirSync(path.join(film.dir, 'boards'), { recursive: true });
        fs.copyFileSync(path.join(dir, s.board), path.join(film.dir, s.board));
      }
      if (p.media?.length) fs.cpSync(path.join(dir, 'media'), path.join(film.dir, 'media'), { recursive: true });
      saveContent(film.dir, animaticScript(p), 'animatic', p.brandId ? (await brandIntoFilm(p.brandId, film.dir)).page : null, p.media?.length ? p.media : undefined);
      writeMeta(film.dir, { ...readMeta(film.dir), production: id });
      writeMeta(dir, { ...readMeta(dir), animatic: film.id });
      return send(res, 200, { id: film.id });
    }
    return send(res, 404, { error: 'no such route' });
  }

  // a product photo or reference image for a brief: stored once by its content, then referred to by id
  if (M === 'POST' && parts[0] === 'uploads' && !parts[1]) {
    if (limited(res, req, 'upload')) return;
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[String(req.headers['content-type'] || '').split(';')[0]];
    if (!ext) return send(res, 400, { error: 'Images must be PNG, JPEG or WebP.' });
    const buf = await rawBody(req, 12e6);
    const magic = { '.png': buf.subarray(0, 4).toString('hex') === '89504e47', '.jpg': buf.subarray(0, 3).toString('hex') === 'ffd8ff', '.webp': buf.subarray(8, 12).toString() === 'WEBP' }[ext];
    if (!magic) return send(res, 400, { error: 'That file is not a valid image.' });
    const id = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20) + ext;
    fs.mkdirSync(UPLOADS, { recursive: true });
    if (!fs.existsSync(path.join(UPLOADS, id))) fs.writeFileSync(path.join(UPLOADS, id), buf);
    return send(res, 200, { id, url: '/uploads/' + id });
  }

  // quick mode: write the script with Claude, or start from the built-in sample
  if (M === 'POST' && parts[0] === 'films' && !parts[1]) {
    const b = await body(req);
    if (!b.sample && limited(res, req, 'script', true)) return;
    if (!TEMPLATES[b.template]) return send(res, 400, { error: 'unknown template' });
    const photos = b.sample ? [] : uploaded(b.media);
    let script, info = {};
    if (b.sample) {
      script = JSON.parse(fs.readFileSync(path.join(APP, 'templates', 'sample.json'), 'utf8'));
      script.accent = TEMPLATES[b.template].accents.includes(script.accent) ? script.accent : TEMPLATES[b.template].accents[1];
    } else {
      if (!String(b.prompt || '').trim()) return send(res, 400, { error: 'Write a prompt first.' });
      const brand = b.brandId ? readBrand(b.brandId) : null;
      const r = await writeScript({ prompt: b.prompt, template: b.template, seconds: +b.seconds || 30, aspect: b.aspect, narration: b.narration !== false, model: b.model || 'sonnet', brand,
        kind: b.kind, media: photos, refs: uploaded(b.refs), notes: String(b.notes || '').slice(0, 4000) });
      script = r.script;
      info = { cost: r.cost, ms: r.ms };
    }
    const { id, dir, meta } = createQuickFilm({ ...b, owner: user });
    // the photos travel with the film, so it renders without the upload store
    let media;
    if (!b.sample && photos.length) {
      fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
      media = photos.map((file, i) => {
        const name = `product-${i + 1}${path.extname(file)}`;
        fs.copyFileSync(file, path.join(dir, 'media', name));
        return { src: 'media/' + name };
      });
    }
    const content = saveContent(dir, script, b.template, b.brandId ? (await brandIntoFilm(b.brandId, dir)).page : null, media);
    return send(res, 200, { id, meta: { ...meta, title: content.title }, content, ...info });
  }

  // director mode: the full lemo-opuscar pipeline, run headless by Claude
  if (M === 'POST' && parts[0] === 'director') {
    const b = await body(req);
    if (!String(b.prompt || '').trim()) return send(res, 400, { error: 'Write a prompt first.' });
    if (!canDirect(user)) return send(res, 403, { error: MAX_DIRECTORS === 0 ? 'Director mode is turned off on this server.' : 'Director mode is limited to a few people on this server. Ask an admin to add you to DIRECTOR_USERS.' });
    const running = listFilms().filter(f => f.mode === 'director' && f.status === 'running').length;
    if (running >= MAX_DIRECTORS) return send(res, 429, { error: `${running} production${running > 1 ? 's are' : ' is'} already running; this server runs ${MAX_DIRECTORS} at a time. Try again when it finishes.` });
    const style = libraryStyles().find(s => s.slug === b.style);
    if (!style) return send(res, 400, { error: 'Pick a style.' });
    const id = `d-${stamp()}-${style.slug}`.slice(0, 60);
    const dir = filmDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const meta = { id, mode: 'director', style: style.slug, title: `${style.name}: ${String(b.prompt).slice(0, 60)}`, aspect: b.aspect, prompt: b.prompt, notes: b.notes, model: b.model || 'opus', seconds: undefined, length: +b.seconds || 45, brandId: b.brandId || null, owner: user.email, ownerName: user.name, created: new Date().toISOString(), status: 'running' };
    const brand = b.brandId ? (await brandIntoFilm(b.brandId, dir)).brand : null;
    writeMeta(dir, meta);
    const job = startJob(id, dir, 'director');
    runDirector(job, { prompt: b.prompt, style: `${style.name} (styles/${style.slug})`, seconds: +b.seconds || 45, aspect: b.aspect, notes: b.notes, model: meta.model, brand })
      .catch(e => emit(job, { status: 'failed', step: 'Failed', error: String(e.message || e) }, 'Error: ' + e.message));
    return send(res, 200, { id, meta });
  }

  // —— decks ——
  if (parts[0] === 'decks') {
    if (M === 'GET' && parts[1] === 'meta') return send(res, 200, { layouts: LAYOUTS, audiences: AUDIENCES });
    if (M === 'POST' && parts[1] === 'outline') {
      const b = await body(req);
      if (limited(res, req, 'script', true)) return;
      return send(res, 200, await writeOutline({ brief: b.brief, audience: b.audience, count: Math.min(16, Math.max(3, +b.count || 8)), brandId: b.brandId, model: b.model }));
    }
    if (M === 'POST' && !parts[1]) {
      const b = await body(req);
      let deck, cost = null;
      if (b.sample) deck = { ...sampleDeck(), brandId: b.brandId || null };
      else {
        if (limited(res, req, 'script', true)) return;
        const r = await writeDeck({ brief: b.brief, audience: b.audience, outline: b.outline, brandId: b.brandId, model: b.model });
        deck = r.deck; cost = r.cost;
      }
      const id = `k-${stamp()}-${Math.random().toString(36).slice(2, 6)}`, dir = filmDir(id);
      fs.mkdirSync(dir, { recursive: true });
      deck = saveDeck(dir, deck);
      const meta = { id, mode: 'deck', title: deck.title, audience: deck.audience, brandId: deck.brandId, owner: user.email, ownerName: user.name, created: new Date().toISOString(), status: 'draft' };
      writeMeta(dir, meta);
      return send(res, 200, { id, meta, deck, issues: checkDeck(deck), cost });
    }
    const id = parts[1], dir = filmDir(id);
    if (!fs.existsSync(path.join(dir, 'deck.json'))) return send(res, 404, { error: 'no such deck' });
    if (M === 'GET' && !parts[2]) { const deck = readDeck(dir); return send(res, 200, { meta: readMeta(dir), deck, issues: checkDeck(deck) }); }
    if (M === 'PUT' && !parts[2]) {
      const deck = saveDeck(dir, await body(req));
      writeMeta(dir, { ...readMeta(dir), title: deck.title, brandId: deck.brandId, audience: deck.audience });
      return send(res, 200, { deck, issues: checkDeck(deck) });
    }
    if (M === 'POST' && parts[2] === 'slides' && parts[4] === 'rewrite') {
      if (limited(res, req, 'script', true)) return;
      const b = await body(req);
      return send(res, 200, await rewriteSlide({ deck: readDeck(dir), index: +parts[3], instruction: b.instruction, model: b.model }));
    }
    if (M === 'POST' && parts[2] === 'export') {
      if (limited(res, req, 'render')) return;
      const b = await body(req), deck = readDeck(dir), issues = checkDeck(deck);
      const blocking = issues.filter(i => i.level === 'error');
      if (blocking.length && !b.draft) return send(res, 409, { error: `${blocking.length} check${blocking.length > 1 ? 's' : ''} failed. Fix them, or export a draft.`, issues });
      const files = await exportDeck(dir, deck, b.kinds?.length ? b.kinds : ['pptx', 'pdf'], { draft: !!blocking.length });
      writeMeta(dir, { ...readMeta(dir), status: 'done', output: files.pptx || files.pdf, files, draft: !!blocking.length, exported: new Date().toISOString() });
      return send(res, 200, { files, draft: !!blocking.length });
    }
    if (M === 'POST' && parts[2] === 'video') {
      const b = await body(req), deck = readDeck(dir), template = TEMPLATES[b.template] ? b.template : 'keynote';
      const script = deckToScript(deck, template);
      const film = createQuickFilm({ template, aspect: b.aspect === '9:16' ? '9:16' : '16:9', prompt: `From the deck "${deck.title}"`, voice: b.voice, narration: b.narration !== false, model: null, brandId: deck.brandId, owner: user });
      const content = saveContent(film.dir, script, template, deck.brandId ? (await brandIntoFilm(deck.brandId, film.dir)).page : null);
      return send(res, 200, { id: film.id, title: content.title });
    }
  }

  // —— proof library ——
  if (parts[0] === 'proof') {
    const who = user.email;
    if (M === 'GET' && !parts[1]) return send(res, 200, listProof());
    if (M === 'GET' && parts[1] === 'pubmed') {
      const q = String(url.searchParams.get('q') || '').trim();
      if (!q) return send(res, 400, { error: 'Search for something.' });
      return send(res, 200, await searchPubMed(q));
    }
    if (M === 'POST' && parts[1] === 'import') return send(res, 200, importCSV((await body(req)).csv, who));
    if (M === 'POST' && !parts[1]) return send(res, 200, addProof(await body(req), who));
    if (M === 'PUT' && parts[1]) return send(res, 200, updateProof(parts[1], await body(req), who));
    if (M === 'DELETE' && parts[1]) { deleteProof(parts[1]); return send(res, 200, { ok: true }); }
  }

  // —— brand kits ——
  if (parts[0] === 'brands') {
    if (M === 'GET' && !parts[1]) return send(res, 200, { brands: listBrands().map(b => ({ ...b, page: brandForPreview(b) })), presets: PRESETS, fonts: FONT_LIST.map(({ family, kind, fixed, local }) => ({ family, kind, fixed, url: '/fonts/' + local })) });
    if (M === 'POST' && parts[1] === 'generate') {
      const b = await body(req);
      if (limited(res, req, 'script', true)) return;
      if (!String(b.prompt || '').trim()) return send(res, 400, { error: 'Describe the brand first.' });
      return send(res, 200, await writeBrand({ prompt: b.prompt, model: b.model || 'sonnet' }));
    }
    if (M === 'POST' && !parts[1]) { const brand = await saveBrand({ ...(await body(req)), editor: user.email }); return send(res, 200, { ...brand, page: brandForPreview(brand) }); }
    const id = parts[1];
    if (M === 'PUT' && !parts[2]) { const brand = await saveBrand({ ...(await body(req)), editor: user.email }, id); return send(res, 200, { ...brand, page: brandForPreview(brand) }); }
    if (M === 'DELETE' && !parts[2]) { deleteBrand(id); return send(res, 200, { ok: true }); }
    if (M === 'POST' && parts[2] === 'logo') { const brand = saveLogo(id, await rawBody(req), String(req.headers['content-type'] || '').split(';')[0]); return send(res, 200, { ...brand, page: brandForPreview(brand) }); }
    if (M === 'DELETE' && parts[2] === 'logo') { const brand = removeLogo(id); return send(res, 200, { ...brand, page: brandForPreview(brand) }); }
  }
  if (M === 'GET' && parts[0] === 'fonts' && parts[1]) {
    const f = await ensureFont(decodeURIComponent(parts[1]));
    return send(res, 200, { ...f, url: '/fonts/' + f.file });
  }

  if (parts[0] === 'films' && parts[1]) {
    const id = parts[1], dir = filmDir(id);
    if (!fs.existsSync(dir)) return send(res, 404, { error: 'no such film' });
    const meta = readMeta(dir);
    if (M === 'GET' && !parts[2]) {
      let content = null;
      try { content = JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf8')); } catch {}
      return send(res, 200, { meta, content, job: getJob(id) ? { status: getJob(id).status, step: getJob(id).step, pct: getJob(id).pct } : null });
    }
    if (M === 'PUT' && parts[2] === 'content') {
      const b = await body(req);
      if (!Array.isArray(b.scenes) || !b.scenes.length) return send(res, 400, { error: 'content needs scenes' });
      const content = saveContent(dir, b, meta.template);
      return send(res, 200, { content });
    }
    if (M === 'PUT' && parts[2] === 'brand') {
      const b = await body(req);
      const content = JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf8'));
      const page = b.brandId ? (await brandIntoFilm(b.brandId, dir)).page : null;
      if (!page) fs.rmSync(path.join(dir, 'brand'), { recursive: true, force: true });
      const saved = saveContent(dir, content, meta.template, page);
      writeMeta(dir, { ...readMeta(dir), brandId: b.brandId || null, output: null });
      return send(res, 200, { content: saved });
    }
    if (M === 'PUT' && parts[2] === 'settings') {
      const b = await body(req);
      writeMeta(dir, { ...meta, voice: b.voice ?? meta.voice, narration: b.narration ?? meta.narration });
      return send(res, 200, { ok: true });
    }
    if (M === 'POST' && parts[2] === 'render') {
      if (limited(res, req, 'render')) return;
      if (meta.mode !== 'quick') return send(res, 400, { error: 'only quick films render here' });
      if (getJob(id)?.status === 'running') return send(res, 409, { error: 'already rendering' });
      const job = startJob(id, dir, 'render');
      writeMeta(dir, { ...meta, status: 'running' });
      renderQuick(job, readMeta(dir));
      return send(res, 200, { ok: true });
    }
    // the production's images, documents and films, for the studio's dailies and reader
    if (M === 'GET' && parts[2] === 'files') {
      const files = [];
      const walk = (d, depth) => {
        if (depth > 4) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name.startsWith('.') || ['node_modules', 'fonts', 'voice', 'instruments'].includes(e.name)) continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) { walk(p, depth + 1); continue; }
          const ext = path.extname(e.name).toLowerCase();
          const kind = ['.jpg', '.jpeg', '.png'].includes(ext) ? 'image' : ext === '.md' ? 'doc' : ext === '.mp4' ? 'video' : null;
          if (!kind || (kind === 'video' && /out\/video\.mp4$/.test(p))) continue;
          const st = fs.statSync(p);
          files.push({ path: path.relative(dir, p).split(path.sep).join('/'), kind, size: st.size, mtime: st.mtimeMs });
        }
      };
      walk(dir, 0);
      return send(res, 200, files.sort((a, b) => a.mtime - b.mtime).slice(-600));
    }
    if (M === 'POST' && parts[2] === 'cancel') {
      const job = getJob(id);
      if (job) cancel(job);
      return send(res, 200, { ok: true });
    }
    if (M === 'GET' && parts[2] === 'events') {
      const job = getJob(id);
      if (!job) {
        // not running in this server: replay what was saved
        const status = meta.status === 'running' ? 'interrupted' : meta.status;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ id, status, output: meta.output, error: meta.error || (status === 'interrupted' ? 'The server restarted while this was running.' : null), step: status, pct: meta.status === 'done' ? 100 : 0, elapsed: meta.seconds, backlog: readLog(dir) })}\n\n`);
        return res.end();
      }
      return subscribe(job, res);
    }
  }
  send(res, 404, { error: 'no such route' });
}

// paths a signed-out visitor may load: the login page and what it shows
const PUBLIC = p => p === '/login' || p.startsWith('/auth/') || p === '/css/studio.css' || p.startsWith('/gallery/frames/') || p.startsWith('/img/') || p === '/favicon.ico';

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    // DNS-rebinding guard for a private server; an open site is meant to be reached by any name
    if (!OPEN && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && host !== PUBLIC_HOST) return send(res, 403, 'bad host', 'text/plain');
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    if (authOn()) {
      if (p === '/auth/google') return startLogin(res, url.searchParams.get('next'));
      if (p === '/auth/google/callback') return await finishLogin(req, res, url);
      if (p === '/auth/logout') return logout(res);
      if (p === '/auth/info') return send(res, 200, { domains: AUTH.domains });
    }
    if (p === '/login') {
      if (!authOn() || currentUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return serveFile(req, res, path.join(APP, 'public'), 'login.html');
    }
    const user = OPEN ? GUEST : currentUser(req);
    if (!user && !PUBLIC(p)) {
      if (p.startsWith('/api/')) return send(res, 401, { error: 'Sign in required', login: '/login' });
      res.writeHead(302, { Location: '/login?next=' + encodeURIComponent(p + url.search), 'Cache-Control': 'no-store' });
      return res.end();
    }
    // writes must come from the site itself
    if (authOn() && !['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== AUTH.publicURL && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Cross-site request refused' });
    }

    if (p.startsWith('/api/')) return await api(req, res, url, user);
    if (p.startsWith('/films/')) return serveFile(req, res, FILMS, p.slice('/films/'.length));
    if (p.startsWith('/fonts/')) return serveFile(req, res, FONTS, p.slice('/fonts/'.length));
    if (p.startsWith('/uploads/')) return serveFile(req, res, UPLOADS, p.slice('/uploads/'.length));
    if (p === '/shared/logo.js') return serveFile(req, res, path.join(APP, 'templates', 'shared'), 'logo.js');
    if (p.startsWith('/brands/') && !p.endsWith('.json')) return serveFile(req, res, BRANDS, p.slice('/brands/'.length));
    if (p.startsWith('/tpl/')) {
      // a template page outside any film, for live brand previews: /tpl/<template>/<file>
      const [, , tid, ...rest] = p.split('/');
      if (!TEMPLATES[tid]) return send(res, 404, 'no such template', 'text/plain');
      const file = rest.join('/') || 'index.html';
      return file === 'scenes.js' ? serveFile(req, res, path.join(APP, 'templates', tid), 'scenes.js') : serveFile(req, res, path.join(APP, 'templates', 'shared'), file);
    }
    if (p.startsWith('/core/') || p.startsWith('/node_modules/')) return serveFile(req, res, LIB, p.slice(1));
    return serveFile(req, res, path.join(APP, 'public'), p === '/' ? 'index.html' : p.slice(1));
  } catch (e) {
    if (!res.headersSent) send(res, [400, 403, 404, 429].includes(e.code) ? e.code : 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, HOST, () => console.log(`CarePlix Studio running at ${AUTH.publicURL || `http://localhost:${PORT}`}  (${authOn() ? `Google sign-in for ${AUTH.domains.join(', ')}` : OPEN ? `OPEN to everyone, no sign-in; Director off; limits per hour: ${LIMITS.script} scripts and ${LIMITS.render} exports per visitor, ${LIMITS.claude} Claude calls site-wide` : 'local mode, no sign-in'}; library: ${LIB}, films: ${FILMS})`));
