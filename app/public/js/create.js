// Create: compose a prompt → Claude writes the script → live editor (viewer, timeline, inspector) → export.
import { $, $$, h, api, icon, toast, sheet, fmt, app, go, pillSelect, segmented, codeSpans } from './core.js';

const IDEAS = [
  ['Product launch', 'A 30-second launch film for Tidal, a new app that turns messy meeting notes into a clean weekly plan. Confident and minimal.'],
  ['Explainer', 'Why the ocean is salty but rivers are not: a calm, clear explainer for curious 10-year-olds.'],
  ['Data story', 'How solar power went from the most expensive electricity to the cheapest in about a decade.'],
  ['Team update', 'Our quarter in 30 seconds: we shipped 3 features, doubled weekly users and hired 4 engineers. Upbeat and proud.'],
  ['Advice', 'Three small habits that help teenagers sleep better, for parents. Calm and practical.'],
];
const TYPES = ['title', 'statement', 'number', 'list', 'compare', 'end'];
export const TYPE_COLOR = { title: '#0a84ff', statement: '#bf5af2', number: '#ff9f0a', list: '#30d158', compare: '#ff375f', product: '#ffd60a', end: '#64d2ff' };
// what is being made: the format changes Claude's brief (a hook first, one message, a call to action) and the defaults
const KINDS = [
  { v: 'film', label: 'Film', placeholder: 'Describe your film: the story, who it’s for, the mood.' },
  { v: 'ad', label: 'Ad', placeholder: 'Describe your ad: the product, who it’s for, the one message and the call to action. Attach product photos to show them.' },
  { v: 'reel', label: 'Reel', placeholder: 'Describe your reel: the product or idea, who it’s for and the vibe. Attach product photos to show them.' },
];
const FIELDS = {
  title: [['kicker', 'Kicker'], ['text', 'Title', 2], ['sub', 'Subtitle', 2]],
  statement: [['kicker', 'Kicker'], ['text', 'Headline', 2], ['sub', 'Supporting line', 2], ['emphasis', 'Words to highlight']],
  number: [['kicker', 'Kicker'], ['number', 'Number'], ['unit', 'Unit'], ['text', 'What it measures', 2]],
  list: [['kicker', 'Kicker'], ['text', 'Heading', 2], ['items', 'Items (one per line)', 4]],
  compare: [['kicker', 'Kicker'], ['text', 'Heading', 2], ['left', 'Left'], ['right', 'Right (the hero)']],
  product: [['kicker', 'Kicker'], ['text', 'Headline', 2], ['sub', 'Supporting line', 2], ['items', 'Callouts (one per line, up to 3)', 3]],
  end: [['kicker', 'Kicker'], ['text', 'Closing line', 2], ['sub', 'Sign-off', 2]],
};
const WRITING = ['Reading your brief', 'Finding the arc of the story', 'Choosing a palette and a tempo', 'Writing the narration', 'Timing every scene to the beat'];
const MODELS = [['sonnet', 'Claude Sonnet'], ['haiku', 'Claude Haiku'], ['opus', 'Claude Opus']];
const LENGTHS = [['15', '15 seconds'], ['30', '30 seconds'], ['45', '45 seconds'], ['60', '60 seconds']];

// media: product photos shown in the film; refs: reference images Claude reads but doesn't show ({ id, url } from /api/uploads)
const opts = { template: 'swiss', kind: 'film', seconds: '30', aspect: '16:9', narration: true, voice: 'af_heart', model: 'sonnet', prompt: '', brandId: '', media: [], refs: [], notes: '' };
let root, film = null;
const P = { win: null, canvas: null, t: 0, dur: 0, playing: false, last: 0, raf: 0 };
let sel = 0, saveTimer = 0, exporting = null, thumbs = [];

export function mountCreate(el) {
  root = el;
  document.addEventListener('keydown', onKey);
}
export function useTemplate(id) { opts.template = id; }

export async function showCreate(args) {
  const id = args[0];
  if (!id) return renderCompose();
  if (film?.id === id && root.querySelector('.editor')) return;
  if (film?.id === id && film.fresh) return renderEditor();
  try {
    const r = await api('films/' + id);
    film = { id, meta: r.meta, content: r.content, job: r.job };
    renderEditor();
  } catch (e) { toast(e.message, 'error'); go('create'); }
}

// —— compose ——
function renderCompose() {
  stop();
  root.innerHTML = '';
  opts.brandId = (app.brands || []).some(b => b.id === localStorage.getItem('vg.brand')) ? localStorage.getItem('vg.brand') : '';
  const kind = KINDS.find(k => k.v === opts.kind);
  const ta = h('textarea', { rows: 3, placeholder: kind.placeholder, 'aria-label': `Describe your ${kind.label.toLowerCase()}`, oninput: e => { opts.prompt = e.target.value; goBtn.disabled = !e.target.value.trim(); } });
  ta.value = opts.prompt;
  const goBtn = h('button', { class: 'go', 'aria-label': 'Create film', title: 'Create (⌘↵)', disabled: !opts.prompt.trim(), onclick: () => create(false) }, icon('arrowUp', 18));
  const voice = pillSelect(app.cfg.voices, opts.voice, v => { opts.voice = v; }, 'Narrator voice');
  const narr = h('label', { class: 'pill-select', title: 'Narration' }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: opts.narration, 'aria-label': 'Narration', onchange: e => { opts.narration = e.target.checked; voice.style.opacity = e.target.checked ? 1 : .4; } }), h('span')));
  const brandSel = pillSelect([['', 'No brand kit'], ...(app.brands || []).map(b => [b.id, b.name])], opts.brandId, v => {
    opts.brandId = v;
    localStorage.setItem('vg.brand', v);
    const b = app.brands.find(x => x.id === v);
    if (b?.voice) { opts.voice = b.voice; voice.querySelector('select').value = b.voice; }
    brandDot.style.background = b ? b.colors.accent : 'transparent';
  }, 'Brand kit');
  const brandDot = h('i', { class: 'brand-dot', style: { background: (app.brands || []).find(b => b.id === opts.brandId)?.colors.accent || 'transparent' } });
  brandSel.prepend(brandDot);
  const bar = h('div', { class: 'prompt-bar' },
    segmented(KINDS.map(k => ({ v: k.v, label: k.label })), opts.kind, v => {
      opts.kind = v;
      if (v === 'reel') Object.assign(opts, { aspect: '9:16', seconds: '30' });
      if (v === 'ad') opts.seconds = '15';
      renderCompose();
    }, { label: 'Make a' }),
    brandSel,
    pillSelect(LENGTHS, opts.seconds, v => { opts.seconds = v; }, 'Length'),
    segmented([{ v: '16:9', icon: 'landscape', label: '16:9' }, { v: '9:16', icon: 'portrait', label: '9:16' }], opts.aspect, v => { opts.aspect = v; }, { label: 'Format' }),
    narr, voice,
    pillSelect(MODELS, opts.model, v => { opts.model = v; }, 'Writer'),
    h('span', { class: 'spacer' }), h('span', { class: 'kbd' }, '⌘↵'), goBtn);
  const box = h('div', { class: 'glow' }, h('div', { class: 'prompt' }, ta, attachments(), bar));
  // images dropped anywhere on the prompt become product photos
  box.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); box.classList.add('over'); } });
  box.addEventListener('dragleave', e => { if (!box.contains(e.relatedTarget)) box.classList.remove('over'); });
  box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('over'); attach([...e.dataTransfer.files], 'media'); });

  const ideas = h('div', { class: 'ideas' }, IDEAS.map(([label, text]) => h('button', { class: 'chip', onclick: () => { ta.value = opts.prompt = text; goBtn.disabled = false; ta.focus(); } }, icon('sparkles', 13), label)));

  const looks = h('div', { class: 'looks' });
  for (const t of app.gallery.templates) {
    const card = h('button', { class: 'look' + (t.id === opts.template ? ' on' : ''), 'data-id': t.id, 'aria-pressed': t.id === opts.template, onclick: () => {
      opts.template = t.id;
      $$('.look[data-id]', looks).forEach(c => { const on = c.dataset.id === t.id; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); });
    } },
    h('video', { src: t.teaser, poster: t.teaser.replace('.mp4', '.jpg'), muted: true, loop: true, autoplay: true, playsinline: true }),
    h('span', { class: 'badge instant tag' }, icon('bolt', 11), 'Instant'),
    h('span', { class: 'check' }, icon('check', 14)),
    h('div', { class: 'meta' }, h('b', {}, t.name), h('span', {}, t.blurb)));
    card.querySelector('video').muted = true;
    looks.append(card);
  }
  const pics = app.gallery.styles.filter(s => s.frame && !s.instant).sort(() => 0.5 - Math.random()).slice(0, 4);
  looks.append(h('button', { class: 'look', onclick: () => go('gallery') },
    h('div', { class: 'mosaic' }, pics.map(s => h('img', { src: s.frame, alt: '' }))),
    h('div', { class: 'meta' }, h('b', {}, `${app.gallery.styles.length} directed styles →`), h('span', {}, 'Watercolor, ukiyo-e, LiDAR, brick toys… Claude directs every frame.'))));

  root.append(h('div', { class: 'compose' },
    h('div', { class: 'hero' }, h('h1', { class: 'title-xl' }, 'Make a film.'), h('p', { class: 'sub' }, 'Describe it. Claude writes it, the studio draws it, and you watch it in seconds.')),
    h('div', { style: { display: 'grid', gap: '16px' } }, box, ideas),
    h('div', {},
      h('div', { class: 'section-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Look'), h('h2', { class: 'title-m' }, 'Choose how it’s drawn')),
        h('button', { class: 'btn ghost', onclick: () => create(true) }, 'Try the sample script')),
      looks)));
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); create(false); } });
  setTimeout(() => ta.focus(), 50);
}

// —— attachments: product photos, reference images and notes ——
async function upload(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(`${file.name}: use PNG, JPEG or WebP images.`);
  if (file.size > 12e6) throw new Error(`${file.name} is over 12 MB.`);
  const r = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function attach(files, list) {
  const room = 4 - opts[list].length;
  if (files.length > room) toast(`Up to 4 ${list === 'media' ? 'product photos' : 'reference images'}.`, 'error');
  const adding = files.slice(0, Math.max(0, room)).map(file => ({ file, url: URL.createObjectURL(file), busy: true }));
  opts[list].push(...adding);
  paintAttachments();
  await Promise.all(adding.map(async a => {
    try { Object.assign(a, await upload(a.file), { busy: false }); } catch (e) { toast(e.message, 'error'); opts[list].splice(opts[list].indexOf(a), 1); }
    paintAttachments();
  }));
}
let attachBox = null;
function attachments() {
  attachBox = h('div', { class: 'attach' });
  paintAttachments();
  return attachBox;
}
function paintAttachments() {
  if (!attachBox) return;
  const pick = list => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true, onchange: e => attach([...e.target.files], list) });
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  };
  const tile = (a, list, tag) => h('div', { class: 'att' + (a.busy ? ' busy' : ''), title: tag },
    h('img', { src: a.url, alt: tag }), h('span', { class: 'tag' }, tag),
    h('button', { class: 'rm', 'aria-label': 'Remove ' + tag.toLowerCase(), onclick: () => { opts[list].splice(opts[list].indexOf(a), 1); paintAttachments(); } }, icon('x', 11)));
  const notes = h('textarea', { rows: 3, class: 'notes', placeholder: 'Reference notes: product facts, the offer, links, words to use or avoid…', 'aria-label': 'Reference notes', oninput: e => { opts.notes = e.target.value; } });
  notes.value = opts.notes;
  attachBox.replaceChildren(
    ...opts.media.map((a, i) => tile(a, 'media', `Product ${i + 1}`)),
    ...opts.refs.map((a, i) => tile(a, 'refs', `Ref ${i + 1}`)),
    h('button', { class: 'chip', onclick: () => pick('media'), title: 'Product photos are shown in the video' }, icon('photo', 13), 'Product photo'),
    h('button', { class: 'chip', onclick: () => pick('refs'), title: 'References guide Claude (an example ad, a landing page, a brand guide) but are not shown' }, icon('eye', 13), 'Reference'),
    h('button', { class: 'chip' + (attachBox.notesOpen || opts.notes ? ' on' : ''), onclick: () => { attachBox.notesOpen = !(attachBox.notesOpen || opts.notes); if (!attachBox.notesOpen) opts.notes = ''; paintAttachments(); } }, icon('pencil', 13), 'Notes'),
    ...(attachBox.notesOpen || opts.notes ? [notes] : []));
}

// —— writing ——
async function create(sample) {
  if (!sample && !opts.prompt.trim()) return toast('Describe your film first.', 'error');
  if ([...opts.media, ...opts.refs].some(a => a.busy)) return toast('Still uploading your images…');
  const looking = !sample && opts.media.length + opts.refs.length > 0;
  const model = MODELS.find(m => m[0] === opts.model)[1];
  const steps = looking ? ['Looking at your images', ...WRITING] : WRITING;
  const line = h('div', { class: 'line' }, sample ? 'Loading the sample script' : steps[0]);
  const clock = h('div', { class: 'faint' }, sample ? '' : `${model} is writing your script`);
  root.innerHTML = '';
  root.append(h('div', { class: 'writing' },
    h('div', { class: 'glow active' }, h('div', { class: 'writing-stage' }, h('div', { class: 'orb' }), line, clock)),
    h('div', { class: 'skeleton' }, [...Array(6)].map((_, i) => h('i', { style: { flex: [1.2, 1, 1.4, 1.6, 1.2, .9][i], animationDelay: i * .12 + 's' } }))),
    h('p', { class: 'faint', style: { textAlign: 'center' } }, `“${opts.prompt.slice(0, 140) || 'Sample: The Quiet Commute'}${opts.prompt.length > 140 ? '…' : ''}”`)));
  const t0 = performance.now();
  let k = 0;
  const tick = setInterval(() => {
    const s = Math.round((performance.now() - t0) / 1000);
    if (!sample) clock.textContent = `${model} is writing your script · ${s} s`;
    if (s && s % 3 === 0 && !sample) {
      line.classList.add('out');
      setTimeout(() => { line.textContent = steps[++k % steps.length]; line.classList.remove('out'); }, 380);
    }
  }, 1000);
  try {
    const r = await api('films', { method: 'POST', body: { ...opts, seconds: +opts.seconds, sample, media: opts.media.map(a => a.id), refs: opts.refs.map(a => a.id) } });
    if (!sample) Object.assign(opts, { media: [], refs: [], notes: '' });
    film = { id: r.id, meta: r.meta, content: r.content, cost: r.cost, took: (performance.now() - t0) / 1000, fresh: true };
    go('create/' + r.id);
  } catch (e) {
    toast(e.message, 'error', 10000);
    renderCompose();
  } finally { clearInterval(tick); }
}

// —— editor ——
function renderEditor() {
  stop();
  root.innerHTML = '';
  sel = 0;
  const c = film.content, portrait = film.meta.aspect === '9:16';
  const tpl = app.gallery.templates.find(t => t.id === film.meta.template);
  const title = h('input', { value: c.title || '', 'aria-label': 'Film title', oninput: e => { c.title = e.target.value; queueSave(); } });
  const metaLine = h('small', {}, `${tpl.name} · ${film.meta.aspect}`);
  const exportBtn = h('button', { class: 'btn primary', onclick: startExport }, icon('export', 15), 'Export');
  const status = h('span', { class: 'faint', id: 'ed-status' }, film.fresh ? `Written in ${film.took.toFixed(1)} s${film.cost ? ` · $${film.cost.toFixed(3)}` : ''}` : '');
  const bar = h('header', { class: 'ed-bar' },
    h('button', { class: 'btn ghost', onclick: () => { film = null; go('create'); } }, icon('chevronL', 15), 'New film'),
    h('div', { class: 'ed-title' }, title, metaLine), status, exportBtn);

  const frame = h('iframe', { title: 'Film preview', tabindex: '-1' });
  const snap = h('img', { class: 'snap', alt: '', hidden: true });
  const playBtn = h('button', { class: 'tbtn', 'aria-label': 'Play', onclick: () => togglePlay() }, icon('play', 15));
  const scrub = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Seek', oninput: e => seek((e.target.value / 1000) * P.dur) });
  const time = h('span', { class: 'time' }, '0:00 / 0:00');
  const viewer = h('div', { class: 'viewer paused' + (portrait ? ' portrait' : '') }, frame, snap, h('div', { class: 'transport' }, playBtn, scrub, time));
  const inspector = h('aside', { class: 'inspector', 'aria-label': 'Inspector' });
  const timeline = h('div', { class: 'timeline' });
  root.append(h('div', { class: 'editor' }, bar, h('div', { class: 'ed-main' }, h('div', { class: 'viewer-wrap' }, viewer), inspector), timeline));
  Object.assign(P, { frame, snap, playBtn, scrub, time, viewer, inspector, timeline, exportBtn, status });
  load(true).then(() => {
    if (film.fresh) { film.fresh = false; play(true); }
  });
  renderInspector('scene');
  if (film.job?.status === 'running') followExport(false);
  else if (film.meta.output) markExported();
}

// load (or reload) the film page in the viewer, keeping the playhead
async function load(first = false) {
  const keep = P.t;
  if (!first && P.canvas) { try { P.snap.src = P.canvas.toDataURL('image/jpeg', .85); P.snap.hidden = false; } catch {} }
  const portrait = film.meta.aspect === '9:16';
  const ready = new Promise((res, rej) => {
    const t0 = Date.now();
    const poll = () => {
      const w = P.frame.contentWindow;
      if (w?.READY) return res(w);
      if (w?.BOOT_ERROR) return rej(new Error('Preview failed: ' + w.BOOT_ERROR));
      if (Date.now() - t0 > 20000) return rej(new Error('The preview did not load.'));
      setTimeout(poll, 40);
    };
    P.frame.onload = poll;
  });
  P.frame.src = `/films/${film.id}/index.html?size=${portrait ? '720x1280' : '1280x720'}&v=${Date.now()}`;
  try {
    P.win = await ready;
  } catch (e) { toast(e.message, 'error'); return; }
  P.canvas = P.frame.contentDocument.querySelector('canvas');
  P.dur = P.win.DUR;
  P.t = first ? 0 : Math.min(keep, P.dur - 0.01);
  makeThumbs();
  drawTimeline(first);
  draw();
  P.snap.hidden = true;
}

function makeThumbs() {
  const portrait = film.meta.aspect === '9:16';
  thumbs = P.win.TL.scenes.map(s => {
    P.win.render(s.t0 + Math.min(s.dur * 0.6, 2.6));
    const c = document.createElement('canvas');
    c.width = portrait ? 90 : 192; c.height = portrait ? 160 : 108;
    c.getContext('2d').drawImage(P.canvas, 0, 0, c.width, c.height);
    return c;
  });
}

function drawTimeline(animate) {
  const tl = P.timeline, scenes = P.win.TL.scenes, cues = P.win.CUES || [];
  tl.innerHTML = '';
  const width = Math.max(600, tl.clientWidth - 40);
  const pps = Math.max(width / P.dur, 26);
  P.pps = pps;
  const inner = h('div', { class: 'tl-inner', style: { width: P.dur * pps + 'px' } });
  const ruler = h('div', { class: 'ruler' });
  const step = P.dur > 50 ? 10 : 5;
  for (let s = 0; s <= P.dur; s += step) ruler.append(h('span', { style: { left: s * pps + 'px' } }, fmt(s)));
  const track = h('div', { class: 'track' });
  scenes.forEach((s, i) => {
    const clip = h('button', { class: 'clip' + (i === sel ? ' on' : '') + (animate ? ' enter' : ''), style: { left: s.t0 * pps + 'px', width: Math.max(10, s.dur * pps - 3) + 'px' }, 'aria-label': `Scene ${i + 1}: ${s.type}`, onclick: e => { e.stopPropagation(); select(i); seek(s.t0 + 0.01); } },
      thumbs[i], h('span', { class: 'lab' }, h('i', { style: { background: TYPE_COLOR[s.type] } }), `${i + 1} · ${s.type}`));
    track.append(clip);
    if (animate) setTimeout(() => clip.classList.remove('enter'), 80 + i * 70);
  });
  const voice = h('div', { class: 'track voice' }, cues.map(c => h('div', { class: 'vchunk', style: { left: c.t0 * pps + 'px', width: Math.max(6, (c.t1 - c.t0) * pps - 2) + 'px' }, title: c.text }, c.text)));
  P.head = h('div', { class: 'playhead' });
  inner.append(ruler, track, voice, P.head);
  inner.addEventListener('pointerdown', e => {
    const rect = inner.getBoundingClientRect();
    const at = t => seek(Math.max(0, Math.min(P.dur - 0.01, (t - rect.left) / pps)));
    if (e.target.closest('.clip')) return;
    at(e.clientX);
    const move = ev => at(ev.clientX);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  });
  const n = scenes.length;
  tl.append(h('div', { class: 'tl-head' }, icon('film', 14), `${n} scenes · ${fmt(P.dur)}`, h('span', { style: { flex: 1 } }), icon('wave', 14), cues.length ? 'Narration (timing estimated until export)' : 'No narration'),
    h('div', { class: 'tl-scroll' }, inner));
}

function draw() {
  if (!P.win) return;
  P.win.render(P.t);
  P.scrub.value = Math.round((P.t / P.dur) * 1000);
  P.time.textContent = `${fmt(P.t)} / ${fmt(P.dur)}`;
  if (P.head) P.head.style.left = P.t * P.pps + 'px';
}
function seek(t) { P.t = t; draw(); }
function play(on) {
  P.playing = on;
  P.viewer.classList.toggle('paused', !on);
  P.playBtn.replaceChildren(icon(on ? 'pause' : 'play', 15));
  P.playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
  cancelAnimationFrame(P.raf);
  if (on) { P.last = performance.now(); P.raf = requestAnimationFrame(tick); }
}
function togglePlay() {
  if (!P.win) return;
  if (!P.playing && P.t >= P.dur - 0.05) P.t = 0;
  play(!P.playing);
}
function tick(now) {
  if (!P.playing) return;
  P.t += (now - P.last) / 1000;
  P.last = now;
  if (P.t >= P.dur) { P.t = P.dur - 0.001; draw(); return play(false); }
  draw();
  P.raf = requestAnimationFrame(tick);
}
function stop() { P.playing = false; cancelAnimationFrame(P.raf); P.win = null; }

function select(i) {
  sel = i;
  $$('.clip', P.timeline).forEach((c, k) => c.classList.toggle('on', k === i));
  renderInspector('scene');
}

// —— inspector ——
function renderInspector(tab) {
  const ins = P.inspector, c = film.content;
  ins.innerHTML = '';
  const tabs = segmented([{ v: 'scene', label: 'Scene' }, { v: 'film', label: 'Film' }], tab, v => renderInspector(v), { label: 'Inspector' });
  const body = h('div', { class: 'insp-body' });
  ins.append(h('div', { class: 'insp-tabs' }, tabs), body);
  if (tab === 'film') return filmPanel(body, c);
  const s = c.scenes[sel];
  if (!s) return;
  const tl = P.win?.TL?.scenes?.[sel];
  body.append(h('div', { class: 'insp-head' },
    h('span', { class: 'num', style: { background: TYPE_COLOR[s.type] } }, sel + 1),
    h('div', { style: { flex: 1 } }, h('b', {}, `Scene ${sel + 1} of ${c.scenes.length}`), h('div', { class: 'faint' }, tl ? `${tl.dur.toFixed(1)} s · starts at ${fmt(tl.t0)}` : '')),
    h('button', { class: 'btn ghost round', title: 'Duplicate scene', 'aria-label': 'Duplicate scene', onclick: () => { c.scenes.splice(sel + 1, 0, JSON.parse(JSON.stringify(s))); sel++; queueSave(true); } }, icon('plus', 15)),
    h('button', { class: 'btn ghost round danger', title: 'Delete scene', 'aria-label': 'Delete scene', disabled: c.scenes.length <= 2, onclick: () => { c.scenes.splice(sel, 1); sel = Math.max(0, sel - 1); queueSave(true); } }, icon('x', 15))));
  const types = c.media?.length ? [...TYPES.slice(0, -1), 'product', 'end'] : TYPES;
  body.append(h('div', { class: 'field' }, h('span', {}, 'Scene type'),
    segmented(types.map(t => ({ v: t, label: t[0].toUpperCase() + t.slice(1) })), s.type, v => { s.type = v; if (v === 'product') s.image ??= 0; queueSave(true); }, { label: 'Scene type', cls: 'typeseg' })));
  if (s.type === 'product' && c.media?.length) {
    body.append(h('div', { class: 'field' }, h('span', {}, 'Photo'), h('div', { class: 'photo-pick' }, c.media.map((m, i) =>
      h('button', { class: (s.image | 0) === i ? 'on' : '', 'aria-label': `Photo ${i + 1}`, 'aria-pressed': (s.image | 0) === i, onclick: () => { s.image = i; queueSave(true); renderInspector('scene'); } },
        h('img', { src: `/films/${film.id}/${m.src}`, alt: '' }))))));
  }
  for (const [k, label, rows] of FIELDS[s.type] || FIELDS.statement) {
    if (k === 'left' || k === 'right') {
      const v = s[k] || (s[k] = { label: '', value: '' });
      body.append(h('div', { class: 'field' }, h('span', {}, label), h('div', { class: 'row2' },
        h('input', { value: v.label || '', placeholder: 'Label', oninput: e => { v.label = e.target.value; queueSave(); } }),
        h('input', { value: v.value || '', placeholder: 'Value', oninput: e => { v.value = e.target.value; queueSave(); } }))));
      continue;
    }
    const val = k === 'items' ? (s.items || []).join('\n') : (s[k] || '');
    const input = rows ? h('textarea', { rows }, val) : h('input', { value: val });
    input.addEventListener('input', e => { if (k === 'items') s.items = e.target.value.split('\n').map(x => x.trim()).filter(Boolean); else s[k] = e.target.value; queueSave(); });
    body.append(h('label', { class: 'field' }, h('span', {}, label), input));
  }
  const words = () => (s.narration || '').trim().split(/\s+/).filter(Boolean).length;
  const hint = h('div', { class: 'hint-line' }, h('span', {}, `${words()} words`), h('span', {}, `≈ ${(words() / 2.6).toFixed(1)} s spoken`));
  body.append(h('label', { class: 'field' }, h('span', {}, 'Narration'),
    h('textarea', { rows: 4, oninput: e => { s.narration = e.target.value; hint.children[0].textContent = `${words()} words`; hint.children[1].textContent = `≈ ${(words() / 2.6).toFixed(1)} s spoken`; queueSave(); } }, s.narration || ''), hint));
}

function filmPanel(body, c) {
  const tpl = app.gallery.templates.find(t => t.id === film.meta.template);
  const brandSel = pillSelect([['', 'No brand kit'], ...(app.brands || []).map(b => [b.id, b.name])], c.brand?.id || '', async v => {
    P.status.textContent = 'Applying brand…';
    try {
      const r = await api(`films/${film.id}/brand`, { method: 'PUT', body: { brandId: v || null } });
      film.content = r.content;
      const b = app.brands.find(x => x.id === v);
      if (b?.voice) setSetting({ voice: b.voice });
      await load();
      renderInspector('film');
      P.status.textContent = v ? `Brand: ${b.name}` : 'Brand removed';
      film.meta.output = null;
      P.exportBtn.replaceChildren(icon('export', 15), 'Export');
      P.exportBtn.onclick = startExport;
    } catch (e) { toast(e.message, 'error'); }
  }, 'Brand kit');
  body.append(h('div', { class: 'field' }, h('span', { style: { display: 'flex', justifyContent: 'space-between' } }, 'Brand kit', h('a', { href: c.brand ? '#brands/' + c.brand.id : '#brands' }, c.brand ? 'Edit kit' : 'New kit')), brandSel));
  if (c.brand) {
    body.append(h('div', { class: 'field' }, h('span', {}, 'Brand palette'), h('div', { class: 'swatches' }, ['bg', 'surface', 'ink', 'muted', 'accent'].map(r => h('span', { class: 'sw-static', style: { background: c.brand.colors[r] }, title: `${r} ${c.brand.colors[r]}` })))));
  }
  const sw = h('div', { class: 'swatches' }, tpl.accents.map(a => h('button', { class: a === c.accent ? 'on' : '', style: { background: a }, 'aria-label': 'Accent ' + a, onclick: e => { c.accent = a; $$('button', sw).forEach(b => b.classList.toggle('on', b === e.currentTarget)); queueSave(true); } })));
  const bpmV = h('span', { class: 'faint' }, `${c.bpm} bpm`);
  body.append(
    h('label', { class: 'field' }, h('span', {}, 'Title'), h('input', { value: c.title || '', oninput: e => { c.title = e.target.value; root.querySelector('.ed-title input').value = c.title; queueSave(); } })),
    c.brand ? null : h('div', { class: 'field' }, h('span', {}, 'Accent'), sw),
    h('label', { class: 'field' }, h('span', { style: { display: 'flex', justifyContent: 'space-between' } }, 'Tempo', bpmV),
      h('input', { type: 'range', min: 84, max: 132, value: c.bpm, oninput: e => { c.bpm = +e.target.value; bpmV.textContent = `${c.bpm} bpm`; queueSave(); } })),
    h('div', { class: 'field' }, h('span', {}, 'Narration'), h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: film.meta.narration !== false, 'aria-label': 'Narration', onchange: e => setSetting({ narration: e.target.checked }) }), h('span')),
      pillSelect(app.cfg.voices, film.meta.voice || 'af_heart', v => setSetting({ voice: v }), 'Voice'))),
    h('p', { class: 'faint' }, 'Edits update the preview instantly. Export records the narration, scores the music to the tempo and masters the film.'));
}
async function setSetting(patch) {
  Object.assign(film.meta, patch);
  try { await api(`films/${film.id}/settings`, { method: 'PUT', body: patch }); } catch (e) { toast(e.message, 'error'); }
}

function queueSave(rerenderInspector = false) {
  clearTimeout(saveTimer);
  P.status.textContent = 'Editing…';
  if (rerenderInspector) renderInspector('scene');
  saveTimer = setTimeout(async () => {
    try {
      const r = await api(`films/${film.id}/content`, { method: 'PUT', body: film.content });
      film.content = r.content;
      await load();
      $$('.clip', P.timeline).forEach((cl, k) => cl.classList.toggle('on', k === sel));
      P.status.textContent = 'Preview updated';
      film.meta.output = null;
      P.exportBtn.replaceChildren(icon('export', 15), 'Export');
    } catch (e) { toast(e.message, 'error'); }
  }, rerenderInspector ? 120 : 650);
}

// —— export ——
const STEPS = [['Recording narration', 'wave'], ['Laying out the timeline', 'sliders'], ['Rendering frames', 'film'], ['Scoring and mixing', 'music'], ['Mastering', 'sparkles']];
async function startExport() {
  if (exporting?.status === 'running') return openExportSheet();
  try {
    await api(`films/${film.id}/settings`, { method: 'PUT', body: { voice: film.meta.voice, narration: film.meta.narration } });
    await api(`films/${film.id}/render`, { method: 'POST' });
    followExport(true);
  } catch (e) { toast(e.message, 'error'); }
}
function followExport(open) {
  exporting = { id: film.id, status: 'running', pct: 0, step: '', started: Date.now() };
  const es = new EventSource(`/api/films/${film.id}/events`);
  es.onmessage = m => {
    const d = JSON.parse(m.data);
    Object.assign(exporting, { status: d.status, pct: d.pct || 0, step: d.step, output: d.output, error: d.error, elapsed: d.elapsed });
    if (exporting.id === film?.id && P.exportBtn) P.exportBtn.replaceChildren(icon('export', 15), d.status === 'running' ? `Exporting ${d.pct || 0}%` : 'Export');
    exporting.update?.();
    if (d.status && d.status !== 'running') {
      es.close();
      if (d.status === 'done' && exporting.id === film?.id) {
        film.meta.output = d.output;
        markExported();
        if (!exporting.update) toast(`“${film.content.title}” is ready.`, 'ok');
        film.content.voice = undefined;
        api('films/' + film.id).then(r => { film.content = r.content; load(); }).catch(() => {});
      }
      if (d.status === 'failed') toast('Export failed: ' + d.error, 'error', 10000);
    }
  };
  es.onerror = () => es.close();
  if (open) openExportSheet();
}
function markExported() {
  if (!P.exportBtn) return;
  P.exportBtn.replaceChildren(icon('check', 15), 'Exported');
  P.exportBtn.onclick = () => openResult();
}
function openResult() {
  sheet(close => resultView(film.id, film.meta.output, film.content.title, close, () => { close(); P.exportBtn.onclick = startExport; startExport(); }), { wide: true });
}
export function resultView(id, output, title, close, again) {
  const src = `/films/${id}/${output}`;
  return h('div', { class: 'export' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Ready'), h('h2', { class: 'title-l' }, title || 'Your film')),
    h('video', { class: 'result-video', src: src + '?v=' + Date.now(), controls: true, autoplay: true, playsinline: true }),
    h('div', { class: 'actions' },
      h('a', { class: 'btn white', href: src, download: output.split('/').pop() }, icon('download', 15), 'Download MP4'),
      output.endsWith('.mp4') ? h('a', { class: 'btn', href: src.replace(/\.mp4$/, '.srt'), download: true }, 'Subtitles') : null,
      again ? h('button', { class: 'btn ghost', onclick: again }, 'Export again') : null,
      h('span', { style: { flex: 1 } }), h('button', { class: 'btn ghost', onclick: close }, 'Done')),
    h('div', { class: 'pathline' }, `${app.cfg.films}/${id}/${output}`));
}
function openExportSheet() {
  const R = 36, C = 2 * Math.PI * R;
  sheet(close => {
    const fg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ringSvg.setAttribute('viewBox', '0 0 84 84');
    ringSvg.setAttribute('width', 84);
    ringSvg.setAttribute('height', 84);
    const bgc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [el, cls] of [[bgc, 'bg'], [fg, 'fg']]) { el.setAttribute('cx', 42); el.setAttribute('cy', 42); el.setAttribute('r', R); el.setAttribute('class', cls); ringSvg.append(el); }
    fg.setAttribute('stroke-dasharray', C);
    fg.setAttribute('stroke-dashoffset', C);
    const pctEl = h('b', {}, '0%');
    const eta = h('div', { class: 'faint' }, 'Starting…');
    const steps = h('div', { class: 'steps-v' }, STEPS.map(([s, ic]) => h('div', { 'data-s': s }, h('span', { class: 'dot' }), icon(ic, 15), s)));
    const box = h('div', { class: 'export' },
      h('div', { class: 'ring-wrap' }, h('div', { class: 'ring' }, ringSvg, pctEl),
        h('div', {}, h('div', { class: 'eyebrow' }, 'Exporting'), h('h2', { class: 'title-m' }, film.content.title || 'Your film'), eta)),
      steps,
      h('p', { class: 'faint' }, 'You can close this; the export keeps going and the Export button shows its progress.'));
    exporting.update = () => {
      const d = exporting;
      if (d.status === 'done') { exporting.update = null; box.replaceWith(resultView(film.id, d.output, film.content.title, close)); return; }
      if (d.status === 'failed' || d.status === 'cancelled') { eta.replaceChildren(h('span', { style: { color: 'var(--red)' } }, ...codeSpans(d.error || d.status))); return; }
      fg.setAttribute('stroke-dashoffset', C * (1 - d.pct / 100));
      pctEl.textContent = d.pct + '%';
      const el = (Date.now() - d.started) / 1000;
      eta.textContent = d.pct > 14 ? `About ${Math.max(1, Math.round(el / d.pct * (100 - d.pct)))} s left` : d.step || 'Starting…';
      const idx = STEPS.findIndex(s => s[0] === d.step);
      $$('div[data-s]', steps).forEach((s, i) => { s.className = i < idx ? 'ok' : i === idx ? 'now' : ''; if (i < idx) s.querySelector('.dot').replaceChildren(icon('check', 11)); });
    };
    exporting.update();
    return box;
  }, { onClose: () => { if (exporting) exporting.update = null; } });
}

function onKey(e) {
  if ($('#view-create').hidden) return;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (!root.querySelector('.editor') || $('#sheets').children.length) return;
  if (e.code === 'Space' && !typing) { e.preventDefault(); togglePlay(); }
  else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !typing && P.win) {
    e.preventDefault();
    const n = film.content.scenes.length, i = Math.max(0, Math.min(n - 1, sel + (e.key === 'ArrowRight' ? 1 : -1)));
    select(i);
    seek(P.win.TL.scenes[i].t0 + 0.01);
  } else if (e.key === 'e' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startExport(); }
}
