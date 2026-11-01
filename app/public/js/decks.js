// Deck Studio: brief → outline → slides that cite only approved proof → editable PowerPoint, PDF, or a film.
import { $, $$, h, api, icon, toast, sheet, app, go, pillSelect, segmented, fmtLong } from './core.js';
import { useFont } from './brands.js';
import { loadProof } from './proof.js';
import { renderSlideHTML, themeFrom, LAYOUTS, DEFAULT_THEME, W, H } from './deck-render.js';

const AUDIENCE = [['hospital', 'Hospitals'], ['insurer', 'Insurers'], ['partner', 'Partners'], ['investor', 'Investors'], ['general', 'General']];
const LAYOUT_NAME = Object.fromEntries(LAYOUTS);
// the inspector's fields for each layout; paths into the slide object
const FIELDS = {
  title: [['kicker', 'Kicker'], ['title', 'Title', 'area'], ['body', 'Subtitle', 'area'], ['footer', 'Presenter or date']],
  agenda: [['title', 'Title'], ['bullets', 'Items (one per line)', 'lines']],
  statement: [['kicker', 'Kicker'], ['title', 'Statement', 'area'], ['bullets', 'Supporting points (one per line)', 'lines'], ['body', 'Or a paragraph', 'area']],
  bignumber: [['kicker', 'Kicker'], ['number.value', 'Number'], ['number.label', 'What it measures'], ['title', 'Takeaway', 'area'], ['body', 'Context', 'area']],
  chart: [['kicker', 'Kicker'], ['title', 'Takeaway title', 'area'], ['chart', 'Chart', 'chart'], ['number.value', 'Side number'], ['number.label', 'Side number label'], ['body', 'Side note', 'area']],
  compare: [['kicker', 'Kicker'], ['title', 'Title', 'area'], ['left.label', 'Left label'], ['left.value', 'Left value'], ['left.points', 'Left points (one per line)', 'lines'], ['right.label', 'Right label (recommended)'], ['right.value', 'Right value'], ['right.points', 'Right points (one per line)', 'lines']],
  process: [['kicker', 'Kicker'], ['title', 'Title', 'area'], ['steps', 'Steps', 'rows']],
  quote: [['quote.text', 'Quote', 'area'], ['quote.name', 'Name'], ['quote.role', 'Role'], ['quote.org', 'Organisation']],
  cards: [['kicker', 'Kicker'], ['title', 'Title', 'area'], ['cards', 'Cards', 'rows']],
  closing: [['kicker', 'Kicker'], ['title', 'Call to action', 'area'], ['body', 'Next step', 'area'], ['footer', 'Contact']],
};
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const set = (o, p, v) => { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach(k => { a = a[k] = a[k] || {}; }); a[ks.at(-1)] = v; };

let root, D = null;   // D: the open deck { id, deck, meta, issues, sel, ... }

export function mountDecks(el) {
  root = el;
  document.addEventListener('keydown', onKey);
}

export async function showDecks(args) {
  if (args[0] === 'new') return composer();
  if (args[0]) {
    if (D?.id === args[0] && root.querySelector('.deck-editor')) return;
    try { const r = await api('decks/' + args[0]); D = { id: args[0], ...r, sel: 0 }; await editor(); }
    catch (e) { toast(e.message, 'error'); go('decks'); }
    return;
  }
  list();
}

// —— theme and proof for rendering ——
function themeFor(brandId) {
  const b = (app.brands || []).find(x => x.id === brandId);
  return b ? themeFrom({ name: b.name, colors: b.colors, fonts: b.fonts, logo: b.page?.logo || null }) : DEFAULT_THEME;
}
// slides must be measured in their real fonts, never a fallback
const fontsFor = theme => Promise.all([useFont(theme.fonts.display), useFont(theme.fonts.body)]).catch(() => {});
// the logo trimmed, with one-colour versions for backgrounds that would hide it (made once per logo, as for films)
const logos = new Map();
async function logoReady(theme) {
  if (!theme.logo) return theme;
  if (!logos.has(theme.logo)) logos.set(theme.logo, import('/shared/logo.js').then(async m => m.logoAssets(await m.loadLogo(theme.logo))).catch(() => null));
  const a = await logos.get(theme.logo);
  return a ? { ...theme, logo: a.logo, logoLight: a.light, logoDark: a.dark, logoR: a.r, logoHist: a.hist } : theme;
}
const proofMap = () => Object.fromEntries((app.proof || []).map(e => [e.id, e]));

function slideView(slide, theme, index, scale, extra = '') {
  const outer = h('div', { class: 'slide-frame ' + extra, style: { width: W * scale + 'px', height: H * scale + 'px' } });
  const inner = h('div', { class: 'slide-scale', style: { transform: `scale(${scale})` }, html: renderSlideHTML(slide, theme, { index, proof: proofMap() }) });
  outer.append(inner);
  return outer;
}

// —— list ——
async function list() {
  const films = await api('films');
  const decks = films.filter(f => f.mode === 'deck');
  root.replaceChildren(h('div', { class: 'library' },
    h('div', { class: 'g-top' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Deck Studio'), h('h1', { class: 'title-xl' }, 'Decks that only say what’s true.'),
        h('p', { class: 'sub' }, 'Claude drafts the story and the slides, citing your Proof Library. Export editable PowerPoint, PDF, or turn a deck into a film.')),
      h('button', { class: 'btn primary big', onclick: () => go('decks/new') }, icon('plus', 16), 'New deck')),
    decks.length ? h('div', { class: 'lib-grid' }, decks.map(f => h('button', { class: 'lcard', onclick: () => go('decks/' + f.id) },
      h('div', { class: 'frame' }, f.poster ? h('img', { src: `/films/${f.id}/${f.poster}?v=${encodeURIComponent(f.exported || '')}`, alt: '' }) : h('div', { class: 'ph' }, icon('slides', 22), 'Not exported yet'),
        h('span', { class: 'badge ' + (f.status === 'done' ? (f.draft ? 'failed' : 'done') : '') }, f.status === 'done' ? (f.draft ? 'Draft export' : 'Exported') : 'Draft')),
      h('b', {}, f.title || 'Untitled deck'),
      h('small', {}, [AUDIENCE.find(a => a[0] === f.audience)?.[1], (app.brands || []).find(b => b.id === f.brandId)?.name, new Date(f.created).toLocaleDateString()].filter(Boolean).join(' · '))))) :
      h('div', { class: 'empty-state' }, icon('slides', 30), 'No decks yet.', h('div', { class: 'actions', style: { justifyContent: 'center' } },
        h('button', { class: 'btn primary', onclick: () => go('decks/new') }, 'Make the first one'), h('button', { class: 'btn', onclick: () => openSample() }, 'Open the sample deck')))));
}

async function openSample(brandId) {
  try { const r = await api('decks', { method: 'POST', body: { sample: true, brandId: brandId || null } }); D = { id: r.id, ...r, sel: 0 }; go('decks/' + r.id); }
  catch (e) { toast(e.message, 'error'); }
}

// —— composer: brief → outline ——
const C = { brief: '', audience: 'hospital', count: '8', brandId: '', model: 'sonnet', outline: null };
async function composer() {
  await loadProof().catch(() => {});
  C.brandId = (app.brands || []).some(b => b.id === localStorage.getItem('vg.brand')) ? localStorage.getItem('vg.brand') : '';
  const approved = (app.proof || []).filter(e => e.state === 'approved').length;
  const ta = h('textarea', { rows: 4, placeholder: 'e.g. A first-meeting deck for a hospital network: how continuous overnight monitoring with our smart ring finds sleep apnea patients who are never referred for a sleep study, and what a 90-day pilot looks like.', oninput: e => { C.brief = e.target.value; } }, C.brief);
  const go1 = h('button', { class: 'btn primary big', onclick: () => draftOutline() }, icon('sparkles', 16), 'Draft the outline');
  const box = h('div', { class: 'compose' },
    h('div', { class: 'hero' }, h('h1', { class: 'title-xl' }, 'Make a deck.'), h('p', { class: 'sub' }, 'Describe the meeting. Claude plans the story, you shape it, then it writes every slide.')),
    h('div', { style: { display: 'grid', gap: '14px' } },
      h('div', { class: 'glow' }, h('div', { class: 'prompt' }, ta,
        h('div', { class: 'prompt-bar' },
          segmented(AUDIENCE.map(([v, label]) => ({ v, label })), C.audience, v => { C.audience = v; }, { label: 'Audience' }),
          pillSelect([['6', '6 slides'], ['8', '8 slides'], ['10', '10 slides'], ['12', '12 slides']], C.count, v => { C.count = v; }, 'Slides'),
          pillSelect([['', 'No brand kit'], ...(app.brands || []).map(b => [b.id, b.name])], C.brandId, v => { C.brandId = v; localStorage.setItem('vg.brand', v); }, 'Brand kit'),
          pillSelect([['sonnet', 'Claude Sonnet'], ['opus', 'Claude Opus'], ['haiku', 'Claude Haiku']], C.model, v => { C.model = v; }, 'Writer')))),
      h('div', { class: 'callout' }, icon('shield', 18), h('div', {}, approved
        ? [h('b', {}, `${approved} approved proof entr${approved === 1 ? 'y' : 'ies'}. `), 'Claude may use only these for numbers, results, customers and quotes. ', h('a', { href: '#proof' }, 'Review the Proof Library')]
        : [h('b', {}, 'Your Proof Library is empty. '), 'Claude will write without numbers or customer claims. ', h('a', { href: '#proof' }, 'Add approved facts first'), ' for a stronger deck.'])),
      h('div', { class: 'actions' }, go1, h('button', { class: 'btn ghost', onclick: () => openSample(C.brandId) }, 'or open the sample deck'))),
    h('div', { id: 'outline' }));
  root.replaceChildren(box);
  if (C.outline) paintOutline();
  setTimeout(() => ta.focus(), 50);
}

async function draftOutline() {
  if (!C.brief.trim()) return toast('Write the brief first.', 'error');
  const out = $('#outline', root);
  out.replaceChildren(h('div', { class: 'glow active', style: { borderRadius: '22px' } }, h('div', { class: 'writing-stage', style: { aspectRatio: 'auto', padding: '40px' } }, h('div', { class: 'orb' }), h('div', { class: 'line' }, 'Planning the storyline'), h('div', { class: 'faint' }, 'Claude is choosing what each slide must prove'))));
  try {
    const r = await api('decks/outline', { method: 'POST', body: { brief: C.brief, audience: C.audience, count: +C.count, brandId: C.brandId || null, model: C.model } });
    C.outline = { title: r.title, slides: r.slides };
    paintOutline(r.cost);
  } catch (e) { out.replaceChildren(); toast(e.message, 'error', 10000); }
}

function paintOutline(cost) {
  const out = $('#outline', root), o = C.outline;
  const rows = h('div', { class: 'outline' });
  const paint = () => rows.replaceChildren(...o.slides.map((s, i) => h('div', { class: 'orow' },
    h('span', { class: 'onum' }, i + 1),
    h('label', { class: 'pill-select' }, h('select', { onchange: e => { s.layout = e.target.value; } }, LAYOUTS.map(([v, l]) => h('option', { value: v, selected: v === s.layout }, l))), icon('chevronD', 12)),
    h('div', { class: 'otext' }, h('input', { value: s.title, oninput: e => { s.title = e.target.value; } }), h('input', { class: 'opurpose', value: s.purpose, oninput: e => { s.purpose = e.target.value; } })),
    h('div', { class: 'oacts' },
      h('button', { class: 'btn ghost round', title: 'Move up', disabled: i === 0, onclick: () => { o.slides.splice(i - 1, 0, o.slides.splice(i, 1)[0]); paint(); } }, icon('arrowUp', 14)),
      h('button', { class: 'btn ghost round', title: 'Remove', disabled: o.slides.length <= 3, onclick: () => { o.slides.splice(i, 1); paint(); } }, icon('x', 14))))));
  paint();
  const title = h('input', { class: 'bname', value: o.title, oninput: e => { o.title = e.target.value; } });
  out.replaceChildren(h('section', { class: 'panel-ish' },
    h('div', { class: 'section-head' }, h('div', {}, h('div', { class: 'eyebrow' }, `Outline${cost ? ` · $${cost.toFixed(3)}` : ''}`), title),
      h('button', { class: 'btn ghost', onclick: () => draftOutline() }, 'Redraft')),
    rows,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { o.slides.splice(o.slides.length - 1, 0, { layout: 'statement', title: 'New slide', purpose: '' }); paint(); } }, icon('plus', 14), 'Add a slide'),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn primary big', onclick: writeAll }, icon('sparkles', 16), `Write ${o.slides.length} slides`))));
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function writeAll() {
  const out = $('#outline', root), n = C.outline.slides.length, t0 = Date.now();
  const line = h('div', { class: 'faint' }, `Claude is writing ${n} slides and their speaker notes`);
  out.replaceChildren(h('div', { class: 'glow active', style: { borderRadius: '22px' } }, h('div', { class: 'writing-stage', style: { aspectRatio: 'auto', padding: '40px' } }, h('div', { class: 'orb' }), h('div', { class: 'line' }, 'Writing the deck'), line)));
  const tick = setInterval(() => { line.textContent = `Claude is writing ${n} slides and their speaker notes · ${fmtLong((Date.now() - t0) / 1000)}`; }, 1000);
  try {
    const r = await api('decks', { method: 'POST', body: { brief: C.brief, audience: C.audience, brandId: C.brandId || null, model: C.model, outline: C.outline } });
    C.outline = null; C.brief = '';
    D = { id: r.id, ...r, sel: 0, cost: r.cost, took: (Date.now() - t0) / 1000 };
    go('decks/' + r.id);
  } catch (e) { toast(e.message, 'error', 10000); paintOutline(); }
  finally { clearInterval(tick); }
}

// —— editor ——
async function editor() {
  await loadProof().catch(() => {});
  const theme = await logoReady(themeFor(D.deck.brandId));
  D.theme = theme;
  await fontsFor(theme);
  const status = h('span', { class: 'faint' }, D.took ? `Written in ${D.took.toFixed(0)} s${D.cost ? ` · $${D.cost.toFixed(3)}` : ''}` : '');
  const checksBtn = h('button', { class: 'btn', onclick: checksSheet });
  const titleIn = h('input', { value: D.deck.title, 'aria-label': 'Deck title', oninput: e => { D.deck.title = e.target.value; save(); } });
  const bar = h('header', { class: 'ed-bar' },
    h('button', { class: 'btn ghost', onclick: () => go('decks') }, icon('chevronL', 15), 'Decks'),
    h('div', { class: 'ed-title' }, titleIn, h('small', {}, `${D.deck.slides.length} slides · ${AUDIENCE.find(a => a[0] === D.deck.audience)?.[1] || 'General'}${theme.name ? ' · ' + theme.name : ''}`)),
    status, checksBtn,
    h('button', { class: 'btn', onclick: () => present(D.sel) }, icon('play', 14), 'Present'),
    h('button', { class: 'btn', onclick: videoSheet }, icon('film', 14), 'Make a film'),
    h('button', { class: 'btn primary', onclick: exportSheet }, icon('export', 15), 'Export'));
  const rail = h('nav', { class: 'deck-rail', 'aria-label': 'Slides' });
  const stage = h('div', { class: 'deck-stage' });
  const notes = h('textarea', { class: 'deck-notes', rows: 3, placeholder: 'Speaker notes', oninput: e => { D.deck.slides[D.sel].notes = e.target.value; save(); } });
  const insp = h('aside', { class: 'inspector deck-insp' });
  root.replaceChildren(h('div', { class: 'deck-editor' }, bar, h('div', { class: 'deck-main' }, rail, h('div', { class: 'deck-center' }, stage, notes), insp)));
  Object.assign(D, { rail, stage, notes, insp, status, checksBtn });
  paintRail(); paintStage(); paintInspector(); paintChecks();
}

function paintRail() {
  D.rail.replaceChildren(...D.deck.slides.map((s, i) => h('button', { class: 'thumb' + (i === D.sel ? ' on' : ''), onclick: () => select(i), 'aria-label': `Slide ${i + 1}: ${s.title}` },
    h('span', { class: 'tn' }, i + 1, D.issues.some(x => x.slide === i && x.level === 'error') ? h('i', { class: 'tdot' }) : null),
    slideView(s, D.theme, i, 176 / W))),
    h('button', { class: 'btn ghost', onclick: addSlideMenu }, icon('plus', 14), 'Add slide'));
}
function paintStage() {
  const w = Math.min(D.stage.clientWidth - 48, (window.innerHeight - 300) * W / H, 1100);
  const view = slideView(D.deck.slides[D.sel], D.theme, D.sel, Math.max(0.3, w / W), 'big');
  D.stage.replaceChildren(view);
  D.notes.value = D.deck.slides[D.sel].notes || '';
  // overflow check: text taller than its box in the real browser layout
  requestAnimationFrame(() => {
    // compare laid-out line boxes with the box (glyph ink poking past a tight line height is not overflow)
    D.overflow = $$('[data-fit]', view).filter(el => (el.firstElementChild?.offsetHeight || 0) > el.clientHeight + 2).length;
    paintChecks();
  });
}
function select(i) {
  D.sel = i;
  $$('.thumb', D.rail).forEach((t, k) => t.classList.toggle('on', k === i));
  paintStage(); paintInspector();
}
const refresh = () => { paintStage(); paintRail(); };

function paintInspector() {
  const s = D.deck.slides[D.sel], body = h('div', { class: 'insp-body' });
  const head = h('div', { class: 'insp-head' }, h('span', { class: 'num', style: { background: 'var(--blue)' } }, D.sel + 1), h('div', { style: { flex: 1 } }, h('b', {}, LAYOUT_NAME[s.layout] || s.layout)),
    h('button', { class: 'btn ghost round', title: 'Move up', disabled: D.sel === 0, onclick: () => move(-1) }, icon('arrowUp', 14)),
    h('button', { class: 'btn ghost round', title: 'Move down', disabled: D.sel === D.deck.slides.length - 1, onclick: () => move(1) }, icon('chevronD', 14)),
    h('button', { class: 'btn ghost round', title: 'Duplicate', onclick: () => { D.deck.slides.splice(D.sel + 1, 0, JSON.parse(JSON.stringify(s))); D.sel++; changed(true); } }, icon('plus', 14)),
    h('button', { class: 'btn ghost round danger', title: 'Delete', disabled: D.deck.slides.length <= 1, onclick: () => { D.deck.slides.splice(D.sel, 1); D.sel = Math.max(0, D.sel - 1); changed(true); } }, icon('x', 14)));
  body.append(head, h('label', { class: 'field' }, h('span', {}, 'Layout'), h('label', { class: 'pill-select', style: { width: '100%' } },
    h('select', { onchange: e => { s.layout = e.target.value; changed(true); } }, LAYOUTS.map(([v, l]) => h('option', { value: v, selected: v === s.layout }, l))), icon('chevronD', 12))));
  for (const [path, label, kind] of FIELDS[s.layout] || FIELDS.statement) body.append(fieldEditor(s, path, label, kind));
  // citations
  const cited = (s.proof || []).map(id => proofMap()[id]).filter(Boolean);
  body.append(h('div', { class: 'field' }, h('span', { style: { display: 'flex', justifyContent: 'space-between' } }, 'Proof cited', h('a', { href: '#', onclick: e => { e.preventDefault(); citeSheet(s); } }, '+ Cite proof')),
    cited.length ? h('div', { class: 'cites' }, cited.map(p => h('div', { class: 'cite ' + p.state }, h('b', {}, p.value || '✓'), h('span', {}, p.claim), h('button', { class: 'btn ghost round', title: 'Remove', onclick: () => { s.proof = s.proof.filter(x => x !== p.id); changed(true); } }, icon('x', 12))))) : h('small', { class: 'faint' }, 'No proof cited. Any number on this slide will fail the checks.')));
  // rewrite
  const ins = h('input', { placeholder: 'e.g. make it shorter, focus on cost, more confident' });
  const btn = h('button', { class: 'btn', onclick: async () => {
    btn.disabled = true; btn.replaceChildren(h('span', { class: 'spin' }), 'Rewriting…');
    try { await save(true); const r = await api(`decks/${D.id}/slides/${D.sel}/rewrite`, { method: 'POST', body: { instruction: ins.value } }); D.deck.slides[D.sel] = r.slide; changed(true); toast(`Slide rewritten${r.cost ? ` ($${r.cost.toFixed(3)})` : ''}.`, 'ok'); }
    catch (e) { toast(e.message, 'error'); }
    btn.disabled = false; btn.replaceChildren(icon('sparkles', 14), 'Rewrite');
  } }, icon('sparkles', 14), 'Rewrite');
  ins.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
  body.append(h('div', { class: 'field' }, h('span', {}, 'Rewrite with Claude'), h('div', { class: 'gen' }, ins, btn)));
  // this slide's checks
  const mine = D.issues.filter(x => x.slide === D.sel);
  body.append(h('div', { class: 'field', id: 'slide-checks' }, h('span', {}, 'Checks'), mine.length ? mine.map(x => h('div', { class: 'issue ' + x.level }, icon(x.level === 'error' ? 'info' : 'eye', 13), x.message)) : h('small', { class: 'faint' }, 'All checks pass on this slide.')));
  D.insp.replaceChildren(body);
}

function fieldEditor(s, path, label, kind) {
  const v = get(s, path);
  if (kind === 'lines') {
    const ta = h('textarea', { rows: 4 }, (v || []).join('\n'));
    ta.addEventListener('input', () => { set(s, path, ta.value.split('\n').map(x => x.trim()).filter(Boolean)); changed(); });
    return h('label', { class: 'field' }, h('span', {}, label), ta);
  }
  if (kind === 'rows') {
    const box = h('div', { class: 'rows' });
    const paint = () => {
      const arr = s[path] = s[path] || [];
      box.replaceChildren(...arr.map((r, i) => h('div', { class: 'rowed' },
        h('input', { value: r.title || '', placeholder: 'Title', oninput: e => { r.title = e.target.value; changed(); } }),
        h('textarea', { rows: 2, placeholder: 'Text', oninput: e => { r.text = e.target.value; changed(); } }, r.text || ''),
        h('button', { class: 'btn ghost round', title: 'Remove', onclick: () => { arr.splice(i, 1); paint(); changed(); } }, icon('x', 12)))),
      arr.length < (path === 'steps' ? 5 : 6) ? h('button', { class: 'btn ghost', onclick: () => { arr.push({ title: '', text: '' }); paint(); changed(); } }, icon('plus', 13), 'Add') : null);
    };
    paint();
    return h('div', { class: 'field' }, h('span', {}, label), box);
  }
  if (kind === 'chart') {
    const ch = s.chart = s.chart || { type: 'column', unit: '', categories: [], series: [] };
    const csv = [['', ...(ch.series || []).map(x => x.name)].join(', '), ...(ch.categories || []).map((c, i) => [c, ...(ch.series || []).map(x => x.values?.[i] ?? '')].join(', '))].join('\n');
    const ta = h('textarea', { rows: 6, class: 'mono' }, csv);
    ta.addEventListener('input', () => {
      const rows = ta.value.split('\n').map(r => r.split(',').map(x => x.trim())).filter(r => r.some(Boolean));
      if (rows.length < 2) return;
      const names = rows[0].slice(1);
      ch.categories = rows.slice(1).map(r => r[0]);
      ch.series = names.map((n, k) => ({ name: n || `Series ${k + 1}`, values: rows.slice(1).map(r => parseFloat(String(r[k + 1] || '0').replace(/[^\d.-]/g, '')) || 0) }));
      changed();
    });
    return h('div', { class: 'field' }, h('span', {}, label),
      h('div', { class: 'row2' }, h('label', { class: 'pill-select', style: { width: '100%' } }, h('select', { onchange: e => { ch.type = e.target.value; changed(); } }, [['column', 'Columns'], ['bar', 'Bars'], ['line', 'Line'], ['donut', 'Donut']].map(([x, l]) => h('option', { value: x, selected: x === ch.type }, l))), icon('chevronD', 12)),
        h('input', { value: ch.unit || '', placeholder: 'Unit, e.g. %', oninput: e => { ch.unit = e.target.value; changed(); } })),
      ta, h('small', { class: 'faint' }, 'First row: series names. Then one row per category: label, values. Every value needs approved proof.'));
  }
  const input = kind === 'area' ? h('textarea', { rows: 2 }, v || '') : h('input', { value: v || '' });
  input.addEventListener('input', () => { set(s, path, input.value); changed(); });
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function move(d) {
  const i = D.sel, j = i + d, a = D.deck.slides;
  [a[i], a[j]] = [a[j], a[i]];
  D.sel = j;
  changed(true);
}
function addSlideMenu() {
  sheet(close => h('div', { class: 'sheet-body' }, h('h2', { class: 'title-l' }, 'Add a slide'),
    h('div', { class: 'layout-pick' }, LAYOUTS.map(([v, l]) => h('button', { class: 'lp', onclick: () => {
      const blank = { layout: v, title: l === 'Title' ? D.deck.title : 'New slide', notes: '', proof: [] };
      D.deck.slides.splice(D.sel + 1, 0, blank); D.sel++; changed(true); close();
    } }, slideView({ layout: v, title: l, kicker: 'Layout', body: '', bullets: ['Point one', 'Point two'], number: { value: '42%', label: 'label' }, chart: { type: 'column', categories: ['A', 'B', 'C'], series: [{ name: 'S', values: [3, 5, 4] }] }, left: { label: 'Before', value: '1' }, right: { label: 'After', value: '2' }, steps: [{ title: 'One', text: '' }, { title: 'Two', text: '' }, { title: 'Three', text: '' }], quote: { text: 'A short quote.', name: 'Name' }, cards: [{ title: 'One', text: '' }, { title: 'Two', text: '' }, { title: 'Three', text: '' }] }, D.theme, 0, 200 / W), h('span', {}, l))))));
}

let saveTimer = 0;
function changed(structural = false) {
  if (structural) { paintRail(); paintStage(); paintInspector(); }
  else { paintStage(); clearTimeout(D.railTimer); D.railTimer = setTimeout(paintRail, 500); }
  save();
}
function save(now = false) {
  clearTimeout(saveTimer);
  D.status.textContent = 'Editing…';
  const run = async () => {
    try {
      const r = await api('decks/' + D.id, { method: 'PUT', body: D.deck });
      D.issues = r.issues;
      D.status.textContent = 'Saved';
      paintChecks();
      const sc = $('#slide-checks', D.insp);
      if (sc) { const mine = D.issues.filter(x => x.slide === D.sel); sc.replaceChildren(h('span', {}, 'Checks'), ...(mine.length ? mine.map(x => h('div', { class: 'issue ' + x.level }, icon(x.level === 'error' ? 'info' : 'eye', 13), x.message)) : [h('small', { class: 'faint' }, 'All checks pass on this slide.')])); }
    } catch (e) { D.status.textContent = 'Not saved'; toast(e.message, 'error'); }
  };
  if (now) return run();
  saveTimer = setTimeout(run, 600);
}
function paintChecks() {
  if (!D?.checksBtn) return;
  const errors = D.issues.filter(x => x.level === 'error').length + (D.overflow ? 1 : 0), warns = D.issues.filter(x => x.level === 'warn').length;
  D.checksBtn.replaceChildren(icon(errors ? 'info' : 'shield', 14), errors ? `${errors} to fix` : warns ? `${warns} warning${warns > 1 ? 's' : ''}` : 'Checks pass');
  D.checksBtn.className = 'btn ' + (errors ? 'danger' : '');
}
function checksSheet() {
  sheet(close => h('div', { class: 'sheet-body' }, h('div', { class: 'eyebrow' }, 'Checks'), h('h2', { class: 'title-l' }, 'Before you export'),
    D.overflow ? h('div', { class: 'issue warn' }, icon('eye', 13), `Slide ${D.sel + 1}: text may not fit its box. Shorten it, or it will shrink.`) : null,
    D.issues.length ? D.issues.map(x => h('button', { class: 'issue-row ' + x.level, onclick: () => { if (x.slide != null) { select(x.slide); close(); } } },
      h('b', {}, x.slide != null ? `Slide ${x.slide + 1}` : 'Deck'), h('span', {}, x.message))) : h('p', { class: 'muted' }, 'Every number is backed by approved proof, every layout has its content, and the colours read clearly.')));
}
function citeSheet(s) {
  const live = (app.proof || []).filter(e => e.state === 'approved');
  sheet(close => {
    let q = '';
    const listEl = h('div', { class: 'cites' });
    const paint = () => listEl.replaceChildren(...live.filter(e => !q || [e.claim, e.value, ...(e.tags || [])].join(' ').toLowerCase().includes(q)).map(e => h('button', { class: 'cite pick', onclick: () => {
      s.proof = [...new Set([...(s.proof || []), e.id])]; changed(true); close(); toast('Cited. Use its wording on the slide.', 'ok');
    } }, h('b', {}, e.value || '✓'), h('span', {}, e.claim), h('small', { class: 'faint' }, e.source?.title || ''))));
    paint();
    return h('div', { class: 'sheet-body' }, h('h2', { class: 'title-l' }, 'Cite approved proof'),
      live.length ? h('label', { class: 'search', style: { width: '100%' } }, icon('search', 15), h('input', { placeholder: 'Search approved claims', autofocus: true, oninput: e => { q = e.target.value.toLowerCase(); paint(); } })) : h('p', { class: 'muted' }, 'No approved proof yet. ', h('a', { href: '#proof', onclick: close }, 'Add some in the Proof Library.')),
      listEl);
  }, { wide: true });
}

// —— export / film / present ——
function exportSheet() {
  sheet(close => {
    const kinds = { pptx: true, pdf: true };
    const result = h('div');
    const run = async draft => {
      result.replaceChildren(h('div', { class: 'faint' }, h('span', { class: 'spin' }), ' Exporting…'));
      try {
        await save(true);
        const r = await api(`decks/${D.id}/export`, { method: 'POST', body: { kinds: Object.keys(kinds).filter(k => kinds[k]), draft } });
        const b = (app.brands || []).find(x => x.id === D.deck.brandId);
        result.replaceChildren(h('div', { class: 'export-done' },
          h('img', { src: `/films/${D.id}/poster.jpg?v=${Date.now()}`, alt: '' }),
          h('div', { class: 'actions' },
            r.files.pptx ? h('a', { class: 'btn white', href: `/films/${D.id}/${r.files.pptx}`, download: r.files.pptx }, icon('download', 15), 'PowerPoint') : null,
            r.files.pdf ? h('a', { class: 'btn', href: `/films/${D.id}/${r.files.pdf}`, download: r.files.pdf }, icon('download', 15), 'PDF') : null),
          r.draft ? h('div', { class: 'issue error' }, icon('info', 13), 'Exported as a draft: every slide says “contains unverified claims” until the checks pass.') : null,
          b ? h('small', { class: 'faint' }, 'The PowerPoint uses ', b.fonts.display, ' and ', b.fonts.body, '. Anyone without them sees a substitute: ',
            ...[b.fonts.display, b.fonts.body].filter((f, i, a) => a.indexOf(f) === i).flatMap((f, i) => [i ? ', ' : '', h('a', { href: `/fonts/${f.replace(/\s+/g, '')}.ttf`, download: true }, f + '.ttf')]), ' (free, SIL Open Font License).') : null));
      } catch (e) {
        if (e.status === 409) result.replaceChildren(h('div', { class: 'issue error' }, icon('info', 13), e.message),
          h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { close(); checksSheet(); } }, 'See what to fix'), h('button', { class: 'btn ghost danger', onclick: () => run(true) }, 'Export as a draft')));
        else result.replaceChildren(h('div', { class: 'issue error' }, icon('info', 13), e.message));
      }
    };
    return h('div', { class: 'sheet-body' }, h('div', { class: 'eyebrow' }, 'Export'), h('h2', { class: 'title-l' }, D.deck.title),
      h('div', { class: 'actions' }, ...[['pptx', 'Editable PowerPoint'], ['pdf', 'PDF']].map(([k, l]) => h('label', { class: 'chip on-toggle' }, h('input', { type: 'checkbox', checked: true, onchange: e => { kinds[k] = e.target.checked; } }), l))),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => run(false) }, icon('export', 16), 'Export')), result);
  }, { wide: true });
}

function videoSheet() {
  sheet(close => {
    const o = { template: 'keynote', aspect: '16:9', voice: (app.brands || []).find(b => b.id === D.deck.brandId)?.voice || 'af_heart' };
    return h('div', { class: 'sheet-body' }, h('div', { class: 'eyebrow' }, 'Make a film'), h('h2', { class: 'title-l' }, 'The same story, as a film'),
      h('p', { class: 'muted' }, 'Each slide becomes a scene, and its speaker notes become the narration. You can edit everything in Create before exporting.'),
      h('div', { class: 'actions' },
        segmented(app.gallery.templates.map(t => ({ v: t.id, label: t.name })), o.template, v => { o.template = v; }, { label: 'Template' }),
        segmented([{ v: '16:9', icon: 'landscape', label: '16:9' }, { v: '9:16', icon: 'portrait', label: '9:16' }], o.aspect, v => { o.aspect = v; }, { label: 'Format' }),
        pillSelect(app.cfg.voices, o.voice, v => { o.voice = v; }, 'Narrator')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: async () => {
        try { await save(true); const r = await api(`decks/${D.id}/video`, { method: 'POST', body: o }); close(); go('create/' + r.id); toast('Film created from the deck. Review it, then export.', 'ok'); }
        catch (e) { toast(e.message, 'error'); }
      } }, icon('film', 16), 'Create the film')));
  });
}

function present(start = 0) {
  let i = start;
  const holder = h('div', { class: 'present' });
  const count = h('div', { class: 'present-count' });
  const paint = () => {
    const sc = Math.min(window.innerWidth / W, window.innerHeight / H);
    holder.replaceChildren(slideView(D.deck.slides[i], D.theme, i, sc), count);
    count.textContent = `${i + 1} / ${D.deck.slides.length}`;
  };
  const key = e => {
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); i = Math.min(D.deck.slides.length - 1, i + 1); paint(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); i = Math.max(0, i - 1); paint(); }
    else if (e.key === 'Escape') exit();
  };
  const exit = () => { document.removeEventListener('keydown', key, true); window.removeEventListener('resize', paint); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); holder.remove(); };
  holder.addEventListener('click', e => { i = e.clientX > window.innerWidth / 3 ? Math.min(D.deck.slides.length - 1, i + 1) : Math.max(0, i - 1); paint(); });
  document.body.append(holder);
  document.addEventListener('keydown', key, true);
  window.addEventListener('resize', paint);
  holder.requestFullscreen?.().catch(() => {});
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && holder.isConnected) exit(); }, { once: false });
  paint();
}

function onKey(e) {
  if ($('#view-decks').hidden || !root.querySelector('.deck-editor') || $('#sheets').children.length || document.querySelector('.present')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); select(Math.min(D.deck.slides.length - 1, D.sel + 1)); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); select(Math.max(0, D.sel - 1)); }
}
window.addEventListener('resize', () => { if (D?.stage?.isConnected) paintStage(); });
