// VideoGen: a local web app for prompt-to-film on top of the Lemo-Opuscar library.
//   node app/server.mjs   →  http://localhost:5178
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { APP, FILMS, LIB } from './lib/paths.mjs';
import { TEMPLATES, VOICES, libraryStyles } from './lib/templates.mjs';
import { startJob, getJob, emit, subscribe, cancel, readMeta, writeMeta, readLog } from './lib/jobs.mjs';
import { renderQuick } from './lib/pipeline.mjs';
import { writeScript, runDirector, writeBrand } from './lib/claude.mjs';
import { AUTH, authOn, configProblems, currentUser, startLogin, finishLogin, logout } from './lib/auth.mjs';
import { writeOutline, writeDeck, rewriteSlide, checkDeck, readDeck, saveDeck, sampleDeck, exportDeck, deckToScript, AUDIENCES } from './lib/decks.mjs';
import { LAYOUTS } from './public/js/deck-render.js';
import { listProof, addProof, updateProof, deleteProof, importCSV, searchPubMed } from './lib/proof.mjs';
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
const LIMITS = { script: lim('LIMIT_SCRIPTS_PER_HOUR', 15), render: lim('LIMIT_RENDERS_PER_HOUR', 8), claude: lim('LIMIT_CLAUDE_PER_HOUR', 150) };
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
  if (claude && !allow('claude', 'site', LIMITS.claude)) return send(res, 429, { error: 'This site has reached its hourly limit for writing with Claude. Try again later, or start from the sample script.' }), true;
  if (!allow(bucket, ip, LIMITS[bucket])) return send(res, 429, { error: `You've hit this site's limit of ${LIMITS[bucket]} ${bucket === 'render' ? 'export' : 'script'}${LIMITS[bucket] === 1 ? '' : 's'} an hour. Try again a little later.` }), true;
  return false;
}
if (configProblems().length) { console.error('Sign-in is misconfigured:\n  - ' + configProblems().join('\n  - ')); process.exit(1); }
const SIZES = { '16:9': '1920x1080', '9:16': '1080x1920' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
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
function createQuickFilm({ template, aspect, prompt, voice, narration, model, brandId, owner }) {
  const id = `q-${stamp()}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = filmDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(APP, 'templates', 'shared'), dir, { recursive: true });
  fs.copyFileSync(path.join(APP, 'templates', template, 'scenes.js'), path.join(dir, 'scenes.js'));
  const meta = { id, mode: 'quick', template, aspect, size: SIZES[aspect] || SIZES['16:9'], prompt, voice, narration, model, brandId: brandId || null, owner: owner?.email, ownerName: owner?.name, created: new Date().toISOString(), status: 'draft' };
  writeMeta(dir, meta);
  return { id, dir, meta };
}
function saveContent(dir, script, template, brand) {
  const tpl = TEMPLATES[template];
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf8')); } catch {}
  const content = { template, title: script.title, accent: script.accent || tpl.accents[0], bpm: script.bpm || tpl.bpm, scenes: script.scenes };
  // the brand comes from the film's brand kit, never from the editor's copy
  const b = brand === undefined ? prev?.brand : brand;
  if (b) content.brand = b;
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
      templates: Object.values(TEMPLATES).map(({ id, name, blurb, accents }) => ({ id, name, blurb, accents })),
      voices: VOICES, styles: libraryStyles(), claude: claudeStatus(), lib: LIB, films: FILMS,
      libReady: fs.existsSync(path.join(LIB, 'core/render/video.mjs')), voiceReady: fs.existsSync(path.join(LIB, 'core/tts/kokoro-v1.0.onnx')),
    });
  }
  if (M === 'GET' && parts[0] === 'me') return send(res, 200, { ...user, auth: authOn(), open: OPEN, domains: AUTH.domains, canDirect: canDirect(user) });
  if (M === 'GET' && parts[0] === 'films' && !parts[1]) return send(res, 200, listFilms());

  // quick mode: write the script with Claude, or start from the built-in sample
  if (M === 'POST' && parts[0] === 'films' && !parts[1]) {
    const b = await body(req);
    if (!b.sample && limited(res, req, 'script', true)) return;
    if (!TEMPLATES[b.template]) return send(res, 400, { error: 'unknown template' });
    let script, info = {};
    if (b.sample) {
      script = JSON.parse(fs.readFileSync(path.join(APP, 'templates', 'sample.json'), 'utf8'));
      script.accent = TEMPLATES[b.template].accents.includes(script.accent) ? script.accent : TEMPLATES[b.template].accents[1];
    } else {
      if (!String(b.prompt || '').trim()) return send(res, 400, { error: 'Write a prompt first.' });
      const brand = b.brandId ? readBrand(b.brandId) : null;
      const r = await writeScript({ prompt: b.prompt, template: b.template, seconds: +b.seconds || 30, aspect: b.aspect, narration: b.narration !== false, model: b.model || 'sonnet', brand });
      script = r.script;
      info = { cost: r.cost, ms: r.ms };
    }
    const { id, dir, meta } = createQuickFilm({ ...b, owner: user });
    const content = saveContent(dir, script, b.template, b.brandId ? (await brandIntoFilm(b.brandId, dir)).page : null);
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
const PUBLIC = p => p === '/login' || p.startsWith('/auth/') || p === '/css/studio.css' || p.startsWith('/gallery/frames/') || p === '/favicon.ico';

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
server.listen(PORT, HOST, () => console.log(`VideoGen running at ${AUTH.publicURL || `http://localhost:${PORT}`}  (${authOn() ? `Google sign-in for ${AUTH.domains.join(', ')}` : OPEN ? `OPEN to everyone, no sign-in; Director off; limits per hour: ${LIMITS.script} scripts and ${LIMITS.render} exports per visitor, ${LIMITS.claude} Claude calls site-wide` : 'local mode, no sign-in'}; library: ${LIB}, films: ${FILMS})`));
