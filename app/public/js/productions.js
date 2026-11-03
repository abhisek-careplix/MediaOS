// Productions (ad films and reels): a brief and product references → three concepts → a cast (each with a look and a
// voice), locations and a storyboard drawn shot by shot → video takes (presenter shots performed in their speaker's voice,
// each take checked and given its own sound) → a cut with the voices, the sound and a composed score, which opens in
// Create to review and export.
import { $$, h, api, icon, toast, sheet, app, go, pillSelect, segmented } from './core.js';
import { attachments, dropPhotos, uploading, attachedIds } from './attach.js';
import { mayDelete, confirmDelete } from './remove.js';

const FORMATS = [
  ['influencer', 'Influencer reel', 'A creator talks to camera, uses the product, jump cuts and captions.'],
  ['brand', 'Brand film', 'A cinematic story with characters, ending on the brand.'],
  ['mascot', 'Mascot story', 'An animated brand creature shows the benefit.'],
  ['product', 'Product hero', 'The product and the app are the stars.'],
];
const ENGINE = { video: ['Scene', '#bf5af2'], presenter: ['Presenter', '#ff9f0a'], code: ['Graphics', '#30d158'], product: ['Product', '#0a84ff'] };
const SIZES = ['Extreme wide', 'Wide', 'Medium', 'Medium close-up', 'Close-up', 'Extreme close-up', 'Insert', 'Over the shoulder', 'POV', 'Two shot'];
const MOVES = ['Static', 'Push in', 'Pull out', 'Pan left', 'Pan right', 'Tilt up', 'Tilt down', 'Tracking', 'Handheld', 'Orbit', 'Crane up'];
const LENGTHS = [['15', '15 seconds'], ['30', '30 seconds'], ['45', '45 seconds'], ['60', '60 seconds']];
const MODELS = [['sonnet', 'Balanced writer'], ['opus', 'Best writer'], ['haiku', 'Quick writer']];

const brief = { brief: '', format: 'brand', kind: 'ad', seconds: '30', aspect: '16:9', brandId: '', model: 'sonnet', style: '', media: [], refs: [], notes: '' };
let root, P = null, events = null, saveTimer = 0, META = null;
// shooting: the video engine and takes per shot (engines are listed by the server, by plain name)
const SHOOT = { engine: null, takes: 1 };
let headCost = null;   // the storyboard header's shooting cost, kept current by the shoot bar
const shootable = s => s.engine !== 'code' && /\.png$/.test(s.board || '');
const lengthFor = (e, d) => e.durations.find(x => x >= d) || e.durations.at(-1);
// where a line sits in its shot (as lib/productions.mjs LEAD and TAIL)
const LEAD = Math.round(0.35 * 24) / 24, TAIL = 0.75;
const lineSecs = s => { const vo = String(s.vo || '').trim(); return !vo ? 0 : s.line?.text === vo ? s.line.dur : vo.split(/\s+/).length / 2.6; };
const needs = s => Math.max(+s.dur || 2.5, 0.8, lineSecs(s) ? LEAD + lineSecs(s) + TAIL : 0);
// how long the film runs (as lib/productions.mjs cutLength): each shot as long as it, its line or its talking take
const chosen = s => (s.take && s.takes?.find(t => t.id === s.take)) || null;
const filmLength = p => p.shots.reduce((t, s) => t + Math.max(needs(s), chosen(s)?.engine === 'talking' ? chosen(s).seconds : 0), 0);
const tooLong = p => filmLength(p) > (META.maxSeconds || 60) + 0.05;
// presenter shots with a line are performed by a talking character when the server can (priced by the line's length,
// at the server's price and minimum)
const performed = s => s.engine === 'presenter' && META.talking && !!String(s.vo || '').trim();
const talkCost = s => Math.max(LEAD + lineSecs(s) + TAIL, META.talkPrice.min) * META.talkPrice.rate;
const estimate = (shots, e, takes) => shots.reduce((t, s) => t + (s.engine === 'code' ? 0 : performed(s) ? talkCost(s) : lengthFor(e, Math.max(+s.dur || 3, needs(s))) * e.rate) * takes, 0);
// frame styles this server can make: Sketch always; Illustrated and Cinematic when Vertex AI is reachable
const meta = async () => META || (META = await api('productions/meta').catch(() => ({ styles: [{ id: 'sketch', name: 'Sketch' }], vertex: { ok: false } })));
const styles = () => META.styles.filter(s => !s.vertex || META.vertex.ok);

export function mountProductions(el) { root = el; }
export async function showProductions(args) {
  if (!args[0]) return home();
  if (P?.id !== args[0] || !root.querySelector('.preprod')) await open(args[0]);
}

// —— home: the brief, and earlier productions ——
async function home() {
  stopEvents();
  P = null;
  await meta();
  if (!brief.style || !styles().some(s => s.id === brief.style)) brief.style = META.vertex.ok ? 'illustrated' : 'sketch';
  brief.brandId = (app.brands || []).some(b => b.id === localStorage.getItem('vg.brand')) ? localStorage.getItem('vg.brand') : '';
  const ta = h('textarea', { rows: 3, placeholder: 'The brief: the product, who it’s for, the one thing they should feel or do, the offer and the call to action.', 'aria-label': 'Brief', oninput: e => { brief.brief = e.target.value; go_.disabled = !e.target.value.trim(); } });
  ta.value = brief.brief;
  const go_ = h('button', { class: 'go', 'aria-label': 'Pitch concepts', title: 'Pitch concepts (⌘↵)', disabled: !brief.brief.trim(), onclick: pitch }, icon('arrowUp', 18));
  const att = attachments(brief);
  const bar = h('div', { class: 'prompt-bar' },
    segmented([{ v: 'ad', label: 'Ad' }, { v: 'reel', label: 'Reel' }, { v: 'film', label: 'Film' }], brief.kind, v => { brief.kind = v; }, { label: 'Runs as' }),
    pillSelect([['', 'No brand kit'], ...(app.brands || []).map(b => [b.id, b.name])], brief.brandId, v => { brief.brandId = v; localStorage.setItem('vg.brand', v); }, 'Brand kit'),
    pillSelect(LENGTHS, brief.seconds, v => { brief.seconds = v; }, 'Length'),
    segmented([{ v: '16:9', icon: 'landscape', label: '16:9' }, { v: '9:16', icon: 'portrait', label: '9:16' }], brief.aspect, v => { brief.aspect = v; }, { label: 'Format' }),
    pillSelect(styles().map(s => [s.id, `${s.name} frames`]), brief.style, v => { brief.style = v; }, 'Storyboard frames'),
    pillSelect(MODELS, brief.model, v => { brief.model = v; }, 'Writer'),
    h('span', { class: 'spacer' }), h('span', { class: 'kbd' }, '⌘↵'), go_);
  const box = h('div', { class: 'glow' }, h('div', { class: 'prompt' }, ta, att, bar));
  dropPhotos(box, att);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); pitch(); } });
  const formats = h('div', { class: 'formats', role: 'radiogroup', 'aria-label': 'Format' }, FORMATS.map(([id, name, line]) =>
    h('button', { class: 'format' + (brief.format === id ? ' on' : ''), role: 'radio', 'aria-checked': brief.format === id, 'data-id': id, onclick: () => {
      brief.format = id;
      if (id === 'influencer') { brief.aspect = '9:16'; brief.kind = brief.kind === 'film' ? 'reel' : brief.kind; return home(); }
      $$('.format', formats).forEach(c => { c.classList.toggle('on', c.dataset.id === id); c.setAttribute('aria-checked', c.dataset.id === id); });
    } }, h('b', {}, name), h('span', {}, line))));
  const list = h('div', { class: 'prod-list' });
  root.replaceChildren(h('div', { class: 'compose prod-home' },
    h('div', { class: 'hero' }, h('h1', { class: 'title-xl' }, 'Pre-production.'), h('p', { class: 'sub' }, 'A brief and your product photos in; three concepts, a storyboard and an animatic out.')),
    h('div', {}, h('div', { class: 'eyebrow' }, 'Format'), formats),
    box,
    h('div', {}, h('div', { class: 'section-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Productions'), h('h2', { class: 'title-m' }, 'In progress'))), list)));
  try {
    const all = (await api('films')).filter(f => f.mode === 'production');
    list.replaceChildren(...(all.length ? all.map(card) : [h('p', { class: 'faint' }, 'Nothing yet. Your productions will appear here.')]));
  } catch {}
}
const card = f => h('a', { class: 'prod-card', href: '#productions/' + f.id },
  h('div', { class: 'sb-frame' + (f.aspect === '9:16' ? ' tall' : '') }, f.cover ? h('img', { src: `/films/${f.id}/${f.cover}`, alt: '' }) : h('span', { class: 'faint' }, 'Concepts')),
  h('b', {}, f.title || 'Untitled'), h('small', { class: 'faint' }, `${FORMATS.find(x => x[0] === f.format)?.[1] || ''} · ${f.length ? f.length + ' s · ' : ''}${f.aspect}`));

// a waiting screen with lines that change while Claude works
function working(lines, sub) {
  const line = h('div', { class: 'line' }, lines[0]), clock = h('div', { class: 'faint' }, sub);
  root.replaceChildren(h('div', { class: 'writing' }, h('div', { class: 'glow active' }, h('div', { class: 'writing-stage' }, h('div', { class: 'orb' }), line, clock))));
  const t0 = performance.now();
  let k = 0;
  const tick = setInterval(() => {
    const s = Math.round((performance.now() - t0) / 1000);
    clock.textContent = `${sub} · ${s} s`;
    if (s && s % 4 === 0) { line.classList.add('out'); setTimeout(() => { line.textContent = lines[++k % lines.length]; line.classList.remove('out'); }, 380); }
  }, 1000);
  return () => clearInterval(tick);
}

async function pitch() {
  if (!brief.brief.trim()) return toast('Write a brief first.', 'error');
  if (uploading(brief)) return toast('Still uploading your images…');
  const done = working([brief.media.length ? 'Looking at your product' : 'Reading the brief', 'Finding three different routes', 'Checking claims against the Proof Library', 'Writing the pitches'], 'Pitching concepts');
  try {
    const r = await api('productions', { method: 'POST', body: { ...brief, seconds: +brief.seconds, ...attachedIds(brief) } });
    Object.assign(brief, { brief: '', media: [], refs: [], notes: '' });
    P = { id: r.id, ...r };
    go('productions/' + r.id);
    render();
  } catch (e) { toast(e.message, 'error', 10000); home(); }
  finally { done(); }
}

// —— a production ——
async function open(id) {
  stopEvents();
  await meta();
  try {
    const r = await api('productions/' + id);
    P = { id, ...r };
    render();
    if (r.job?.status === 'running') follow();
  } catch (e) { toast(e.message, 'error'); go('productions'); }
}
async function refresh() {
  const r = await api('productions/' + P.id);
  Object.assign(P, r);
  render();
}

function render() {
  const p = P.production, view = p.concept == null ? 'concepts' : 'board';
  const steps = [['Brief', true], ['Concept', p.concept != null], ['Storyboard', p.shots.some(s => s.board)], ['Shoot', p.shots.some(s => s.takes?.length)], ['Cut', !!P.meta.cut]];
  const bar = h('header', { class: 'ed-bar prod-bar' },
    h('button', { class: 'btn ghost', onclick: () => go('productions') }, icon('chevronL', 15), 'Productions'),
    h('div', { class: 'ed-title' }, h('input', { value: p.title || P.meta.title || '', 'aria-label': 'Title', oninput: e => { p.title = e.target.value; queueSave(); } }),
      h('small', {}, `${FORMATS.find(f => f[0] === p.format)?.[1]} · ${p.kind === 'ad' ? 'Ad' : p.kind === 'reel' ? 'Reel' : 'Film'} · ${p.seconds} s · ${p.aspect}${p.brand ? ' · ' + p.brand.name : ''}`)),
    h('ol', { class: 'steps' }, steps.map(([s, on]) => h('li', { class: on ? 'on' : '' }, s))),
    mayDelete(P.meta) ? h('button', { class: 'btn ghost danger round', title: 'Delete this production', 'aria-label': 'Delete this production', onclick: async () => { await save(true); confirmDelete(P.id, { onDone: () => go('productions') }); } }, icon('trash', 15)) : null);
  root.replaceChildren(h('div', { class: 'preprod' }, bar, view === 'concepts' ? concepts() : board()));
}

// —— concepts ——
function concepts() {
  const p = P.production;
  const wrap = h('div', { class: 'prod-body' },
    h('div', { class: 'section-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Step 2'), h('h2', { class: 'title-m' }, 'Pick a concept')),
      h('button', { class: 'btn ghost', onclick: more }, icon('sparkles', 14), 'Three more')),
    h('div', { class: 'concepts' }, p.concepts.map((c, i) => h('article', { class: 'concept' },
      h('div', { class: 'tones' }, c.tone.map(t => h('span', { class: 'chip' }, t))),
      h('h3', {}, c.name), h('p', { class: 'logline' }, c.logline),
      h('p', {}, h('b', {}, 'Hook  '), c.hook),
      h('p', { class: 'muted' }, c.story),
      h('ol', { class: 'keys' }, c.keyframes.map(k => h('li', {}, k))),
      h('p', { class: 'why' }, h('b', {}, 'Why it works  '), c.why),
      /^none\.?$/i.test(c.watchouts.trim()) ? null : h('p', { class: 'watch' }, icon('shield', 13), c.watchouts),
      h('button', { class: 'btn primary', onclick: () => boardIt(i) }, icon('grid', 14), 'Storyboard this')))));
  if (p.shots.length && P.was != null) wrap.prepend(h('p', { class: 'faint' }, (p.shots.some(s => s.takes?.length) ? 'Picking a concept replaces the current storyboard, its cast and every take you’ve shot. ' : 'Picking a concept replaces the current storyboard. '), h('a', { href: '#', onclick: e => { e.preventDefault(); p.concept = P.was; render(); } }, 'Back to the storyboard')));
  return wrap;
}
async function more() {
  const done = working(['Finding new routes', 'Writing the pitches'], 'Pitching three more');
  try { const r = await api(`productions/${P.id}/concepts`, { method: 'POST', body: {} }); Object.assign(P, r); }
  catch (e) { toast(e.message, 'error'); }
  finally { done(); render(); }
}
async function boardIt(i) {
  const done = working(['Casting the characters', 'Scouting the locations', 'Breaking the story into shots', 'Timing the voice-over', 'Checking every claim'], 'Planning the shots');
  try {
    const r = await api(`productions/${P.id}/shots`, { method: 'POST', body: { concept: i } });
    Object.assign(P, r);
    done();
    render();
    follow();
  } catch (e) { done(); toast(e.message, 'error', 10000); render(); }
}

// —— storyboard ——
function board() {
  const p = P.production, rv = P.review, running = P.job?.status === 'running';
  const c = p.concepts[p.concept];
  const warn = Object.fromEntries((rv.shots || []).map(s => [s.id, s.unsupported]));
  const long = tooLong(p), max = META.maxSeconds || 60;
  headCost = h('span', {});
  const head = h('div', { class: 'board-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Step 3 · Storyboard'), h('h2', { class: 'title-m' }, c?.name || 'Storyboard'),
      h('p', { class: 'muted' }, c?.logline || ''),
      h('p', { class: 'faint' }, `${p.shots.length} shots · ${filmLength(p).toFixed(1)} of ${max} s`, META.engines?.length ? [' · ', headCost] : null, ` · spent so far $${(p.cost || 0).toFixed(2)}`),
      long ? h('p', { class: 'length-warn' }, icon('info', 12), `Runs over ${max} seconds, the longest film the studio makes. Shorten a few lines or shots to shoot and cut it.`) : null),
    h('div', { class: 'actions' },
      styles().length > 1 ? segmented(styles().map(s => ({ v: s.id, label: s.name, title: s.vertex ? 'Generated images, about $0.07 a frame' : 'Quick pencil-style sketches, free' })), p.style || 'sketch', restyle, { label: 'Frame style' }) : null,
      h('button', { class: 'btn ghost', onclick: () => { P.was = p.concept; p.concept = null; render(); } }, 'Change concept'),
      h('button', { class: 'btn', disabled: running, onclick: redrawAll }, icon('brush', 14), running ? (P.job.step || 'Drawing…') : 'Redraw all'),
      running ? h('button', { class: 'btn ghost', onclick: stopJob, title: 'Takes and frames already under way finish (they’re paid for); no new ones start' }, icon('stop', 14), 'Stop') : null,
      h('button', { class: 'btn', disabled: running || !p.shots.some(s => s.board), onclick: animatic }, icon('film', 15), P.meta.animatic ? 'New animatic' : 'Make the animatic'),
      h('button', { class: 'btn primary', disabled: running || long || !p.shots.some(s => s.take), onclick: cut, title: META.sound ? 'The chosen takes, cut together with the voices, each shot’s sound and a composed score' : 'The chosen takes, cut together with the voice-over and music' }, icon('clapper', 15), P.meta.cut ? 'New cut' : 'Make the cut')));
  const grid = h('div', { class: 'board-grid' + (p.aspect === '9:16' ? ' tall' : '') }, p.shots.map((s, i) => shotCard(s, i, running, warn[s.id] || [])));
  return h('div', { class: 'prod-body' }, head, shootBar(running), castPanel(), grid,
    P.meta.cut || P.meta.animatic ? h('p', { class: 'faint' }, ...(P.meta.cut ? ['Latest cut: ', h('a', { href: '#create/' + P.meta.cut }, 'open it in Create'), '. '] : []), ...(P.meta.animatic ? ['Latest animatic: ', h('a', { href: '#create/' + P.meta.animatic }, 'open it in Create'), '.'] : [])) : null);
}
// Step 4: film the frames. Graphics shots stay brand cards; sketches need a generated frame first.
function shootBar(running) {
  const p = P.production, list = META.engines || [];
  if (!list.length) return h('p', { class: 'faint' }, 'Video shots aren’t available on this server yet.');
  if (!list.some(e => e.id === SHOOT.engine)) SHOOT.engine = list[0].id;
  const e = list.find(x => x.id === SHOOT.engine), ready = p.shots.filter(shootable);
  const cost = h('span', { class: 'faint' });
  // this bar's cost (the shots with frames ready) and the header's (every shot filmed), both with the engine picked here
  const paint = () => {
    const en = list.find(x => x.id === SHOOT.engine);
    cost.textContent = ready.length ? `${ready.length} shot${ready.length > 1 ? 's' : ''} · about $${estimate(ready, en, SHOOT.takes).toFixed(2)}` : 'No shots ready: switch the frames to Illustrated or Cinematic first.';
    if (headCost) headCost.textContent = `about $${estimate(p.shots, en, SHOOT.takes).toFixed(2)} to film every shot with ${en.name}`;
  };
  paint();
  return h('div', { class: 'shoot-bar' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Step 4 · Shoot'), h('b', {}, 'Turn the frames into video')),
    segmented(list.map(x => ({ v: x.id, label: x.name, title: `${x.hint}. About $${x.rate.toFixed(2)} a second.` })), SHOOT.engine, v => { SHOOT.engine = v; paint(); }, { label: 'Video engine' }),
    pillSelect([[1, '1 take'], [2, '2 takes'], [3, '3 takes']], SHOOT.takes, v => { SHOOT.takes = +v; paint(); }, 'Takes per shot'),
    cost,
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary', disabled: running || !ready.length || tooLong(p), onclick: () => shoot(ready.map(s => s.id)) }, icon('film', 15), running ? (P.job.step || 'Working…') : 'Shoot all'),
    META.talking && ready.some(performed) ? h('p', { class: 'faint shoot-note' }, icon('wave', 12), 'Presenter shots are performed by their character, speaking the line in their own voice.') : null);
}
async function shoot(ids) {
  const p = P.production, e = META.engines.find(x => x.id === SHOOT.engine), shots = p.shots.filter(s => ids.includes(s.id));
  const talking = shots.filter(performed).length;
  if (!confirm(`Shoot ${shots.length} shot${shots.length > 1 ? 's' : ''}, ${SHOOT.takes} take${SHOOT.takes > 1 ? 's' : ''} each, with ${e.name}${talking ? ` (${talking} performed as talking shots)` : ''}? About $${estimate(shots, e, SHOOT.takes).toFixed(2)}, and a minute or two per take.`)) return;
  await save(true);
  try { const r = await api(`productions/${P.id}/shoot`, { method: 'POST', body: { ids, engine: SHOOT.engine, takes: SHOOT.takes } }); Object.assign(P, r); render(); follow(); }
  catch (err) { toast(err.message, 'error'); }
}
async function cut() {
  await save(true);
  const done = working([...(META.sound ? ['Recording the voices', 'Adding the sound of each shot', 'Composing the score'] : []), 'Converting the chosen takes', 'Placing them on the timeline', 'Adding the end card'], 'Cutting the film');
  try { const r = await api(`productions/${P.id}/cut`, { method: 'POST', body: {} }); toast('Cut ready. Play it, adjust a line or the timing, then export.', 'ok'); go('create/' + r.id); }
  catch (e) { toast(e.message, 'error'); render(); }
  finally { done(); }
}

function frame(s, cls = '') {
  const p = P.production, [w, hh] = p.aspect === '9:16' ? [900, 1600] : [1600, 900];
  const m = s.product >= 0 && p.media?.[s.product];
  const take = s.take && s.takes?.find(t => t.id === s.take);
  if (take) {
    const v = h('video', { src: `/films/${P.id}/${take.file}`, poster: `/films/${P.id}/${take.poster}`, muted: true, loop: true, playsinline: true, preload: 'none', 'aria-label': s.action });
    v.muted = true;
    return h('div', { class: 'sb-frame has-take ' + cls + (p.aspect === '9:16' ? ' tall' : ''), onmouseenter: () => v.play().catch(() => {}), onmouseleave: () => v.pause() }, v,
      h('span', { class: 'take-badge' }, icon(take.engine === 'talking' ? 'wave' : 'film', 11), take.engine === 'talking' ? 'Talking' : 'Video'));
  }
  return h('div', { class: 'sb-frame ' + cls + (p.aspect === '9:16' ? ' tall' : '') },
    s.board ? h('img', { src: `/films/${P.id}/${s.board}`, alt: s.action }) : h('div', { class: 'drawing' }, P.job?.status === 'running' ? 'Drawing…' : 'Not drawn'),
    s.board && s.box && m ? h('img', { class: 'prod-photo', src: `/films/${P.id}/${m.src}`, alt: 'Product', style: { left: s.box.x / w * 100 + '%', top: s.box.y / hh * 100 + '%', width: s.box.w / w * 100 + '%', height: s.box.h / hh * 100 + '%' } }) : null);
}
function shotCard(s, i, running, unsupported) {
  const [label, color] = ENGINE[s.engine] || ENGINE.video;
  return h('article', { class: 'shot' + (s.board ? '' : running ? ' pending' : '') },
    h('button', { class: 'shot-frame', onclick: () => inspect(i), 'aria-label': `Edit shot ${i + 1}` }, frame(s)),
    h('div', { class: 'shot-meta' }, h('b', {}, String(i + 1).padStart(2, '0')), h('span', {}, `${s.size} · ${s.move} · ${(+s.dur).toFixed(1)} s`),
      h('i', { class: 'engine', style: { '--c': color } }, label)),
    s.vo ? h('p', { class: 'vo' }, icon('wave', 12), h('b', {}, speakerName(s) + '  '), s.vo) : null,
    s.super ? h('p', { class: 'super' }, '“', s.super, '”') : null,
    unsupported.length ? h('p', { class: 'warn' }, icon('shield', 12), `Not backed by the Proof Library: ${unsupported.join(', ')}`) : null,
    s.fallback ? h('p', { class: 'faint' }, `Drawn as a sketch: ${s.fallback}`) : null,
    takeStrip(s, running));
}
// the takes of a shot: pick one for the cut, or shoot another
function takeStrip(s, running) {
  if (!shootable(s) || !(META.engines || []).length) return null;
  const pick = async t => { s.take = t.id; await save(true); render(); };
  return h('div', { class: 'takes' },
    ...(s.takes || []).map((t, k) => {
      const c = t.check, low = c && Math.min(c.people || 5, c.product || 5, c.picture || 5);
      // a talking take of an earlier reading of the line no longer matches its voice
      const stale = t.engine === 'talking' && (!t.line || t.line !== s.line?.file);
      return h('button', { class: 'take' + (t.id === s.take ? ' on' : '') + (stale ? ' stale' : ''), title: `Take ${k + 1}${t.id === s.take ? ' (in the cut)' : ''}${t.engine === 'talking' ? ' · talking' : ''}${stale ? ' · performs an earlier reading of the line' : c ? ` · ${c.note}` : ''}`, 'aria-pressed': t.id === s.take, onclick: () => pick(t) },
        h('img', { src: `/films/${P.id}/${t.poster}`, alt: `Take ${k + 1}` }),
        c ? h('i', { class: 'take-check ' + (low >= 4 ? 'good' : low >= 3 ? 'fair' : 'poor'), 'aria-label': c.note }, icon(low >= 4 ? 'check' : 'info', 10)) : null);
    }),
    h('button', { class: 'chip', disabled: running, onclick: () => shoot([s.id]) }, icon('film', 12), s.takes?.length ? 'Another take' : 'Shoot'));
}

const speakerName = s => (s.speaker && s.speaker !== 'narrator' && P.production.cast.find(c => c.id === s.speaker)?.name) || 'VO';
// a studio voice picker with a Listen button (a character's first line, or the narrator's)
function voicePick(value, set, castId) {
  const list = META.voices || [];
  if (!list.length) return null;
  const audio = new Audio();
  const listen = h('button', { class: 'chip', type: 'button', onclick: async () => {
    if (!value()) return;
    listen.disabled = true;
    try { await save(true); const r = await api(`productions/${P.id}/voice-sample`, { method: 'POST', body: { voice: value(), cast: castId } }); audio.src = r.url; await audio.play(); }
    catch (e) { toast(e.message, 'error'); }
    finally { listen.disabled = false; }
  } }, icon('play', 11), 'Listen');
  return h('div', { class: 'voice-pick' }, pillSelect([['', 'Choose a voice'], ...list.map(v => [v.id, `${v.name} · ${v.tag}`])], value() || '', v => { set(v || null); queueSave(); }, 'Voice'), listen);
}
function castPanel() {
  const p = P.production;
  if (!p.cast.length && !p.locations.length) return null;
  const item = (o, kind) => h('div', { class: 'cast-item' },
    o.ref ? h('div', { class: 'cast-refs' }, h('img', { class: 'cast-ref', src: `/films/${P.id}/${o.ref}`, alt: `${o.name}, reference portrait` }),
      o.sheet ? h('img', { class: 'cast-ref full', src: `/films/${P.id}/${o.sheet}`, alt: `${o.name}, full length` }) : null) : null,
    h('b', {}, o.name), h('small', { class: 'faint' }, kind),
    h('textarea', { rows: 3, 'aria-label': `${o.name} look`, oninput: e => { o.look = e.target.value; queueSave(); } }, o.look),
    o.wardrobe != null ? h('small', { class: 'faint' }, 'Wears ' + o.wardrobe) : null,
    kind === 'Character' ? voicePick(() => o.voiceId, v => { o.voiceId = v; }, o.id) : null);
  const narrator = (META.voices || []).length ? h('div', { class: 'cast-item narrator' }, h('b', {}, 'Narrator'), h('small', { class: 'faint' }, 'The voice-over'),
    voicePick(() => p.narrator, v => { p.narrator = v; })) : null;
  return h('details', { class: 'cast-panel' }, h('summary', {}, icon('eye', 13), `Cast & locations · ${p.cast.length + p.locations.length}`, h('small', { class: 'faint' }, '  Edit a look, then redraw the frames it appears in. Pick each voice and listen to it.')),
    h('div', { class: 'cast-grid' }, narrator, p.cast.map(c => item(c, 'Character')), p.locations.map(l => item(l, 'Location'))));
}

// the shot inspector: edit, redraw with a note, move, insert, delete
function inspect(i) {
  const p = P.production, s = p.shots[i];
  sheet(close => {
    const field = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
    const sel = (opts, v, set) => pillSelect(opts.map(o => Array.isArray(o) ? o : [o, o]), v, set);
    const note = h('input', { placeholder: 'Note for the redraw, e.g. lower angle, she smiles, more of the city', 'aria-label': 'Redraw note' });
    const redraw = h('button', { class: 'btn', onclick: async () => {
      redraw.disabled = true; redraw.textContent = 'Drawing…';
      try { await save(true); const r = await api(`productions/${P.id}/board/${s.id}`, { method: 'POST', body: { note: note.value } }); Object.assign(P, r); close(); render(); }
      catch (e) { toast(e.message, 'error'); redraw.disabled = false; redraw.textContent = 'Redraw frame'; }
    } }, icon('brush', 14), 'Redraw frame');
    const edit = (k, v) => { s[k] = v; queueSave(); };
    return h('div', { class: 'sheet-body shot-sheet' },
      h('div', { class: 'eyebrow' }, `Shot ${i + 1} of ${p.shots.length}`),
      h('div', { class: 'shot-edit' }, frame(s, 'big'),
        h('div', { class: 'shot-fields' },
          h('div', { class: 'row2' }, field('Size', sel(SIZES, s.size, v => edit('size', v))), field('Camera', sel(MOVES, s.move, v => edit('move', v)))),
          h('div', { class: 'row2' }, field('Angle', h('input', { value: s.angle, oninput: e => edit('angle', e.target.value) })),
            field('Seconds', h('input', { type: 'number', min: 0.5, max: 12, step: 0.5, value: s.dur, oninput: e => edit('dur', +e.target.value) }))),
          h('div', { class: 'row2' }, field('Made with', sel(Object.entries(ENGINE).map(([k, [l]]) => [k, l]), s.engine, v => edit('engine', v))),
            p.media?.length ? field('Product photo', sel([[-1, 'None'], ...p.media.map((m, k) => [k, `Photo ${k + 1}`])], s.product, v => edit('product', +v))) : null),
          field('Action', h('textarea', { rows: 3, oninput: e => edit('action', e.target.value) }, s.action)),
          h('div', { class: 'row2' }, field('Spoken line', h('textarea', { rows: 2, oninput: e => edit('vo', e.target.value) }, s.vo)),
            field('Said by', sel([['narrator', 'Narrator (voice-over)'], ...p.cast.map(c => [c.id, c.name])], s.speaker || 'narrator', v => edit('speaker', v)))),
          field('Delivery', h('input', { value: s.delivery || '', placeholder: 'How it’s said, e.g. warm and conversational, like sharing a tip', oninput: e => edit('delivery', e.target.value) })),
          field('On-screen text', h('input', { value: s.super, oninput: e => edit('super', e.target.value) })),
          field('Sound', h('input', { value: s.ambience || '', placeholder: 'What we hear, e.g. quiet office, distant keyboard taps', oninput: e => edit('ambience', e.target.value) })))),
      h('div', { class: 'actions' }, note, redraw),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', disabled: i === 0, onclick: () => { p.shots.splice(i - 1, 0, p.shots.splice(i, 1)[0]); close(); save(true).then(render); } }, icon('chevronL', 14), 'Earlier'),
        h('button', { class: 'btn ghost', disabled: i === p.shots.length - 1, onclick: () => { p.shots.splice(i + 1, 0, p.shots.splice(i, 1)[0]); close(); save(true).then(render); } }, 'Later', icon('chevronR', 14)),
        h('button', { class: 'btn ghost', onclick: () => { p.shots.splice(i + 1, 0, { ...s, id: 'new', board: null, box: null, action: 'New shot: describe what we see.', vo: '', super: '' }); close(); save(true).then(() => { render(); inspect(i + 1); }); } }, icon('plus', 14), 'Add a shot after'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost danger', disabled: p.shots.length <= 2, onclick: () => { p.shots.splice(i, 1); close(); save(true).then(render); } }, 'Delete shot')));
  }, { wide: true, onClose: () => save(true).then(render) });
}

// —— saving and drawing ——
function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 600); }
async function save(now = false) {
  clearTimeout(saveTimer);
  const p = P.production;
  try {
    const r = await api('productions/' + P.id, { method: 'PUT', body: { title: p.title, narrator: p.narrator ?? null, cast: p.cast, locations: p.locations, shots: p.shots } });
    if (now) Object.assign(P, r); else P.review = r.review;
  } catch (e) { toast(e.message, 'error'); }
}
// a new frame style: save it, then redraw every frame in it
async function restyle(style) {
  const filmed = P.production.shots.some(s => s.takes?.length), running = P.job?.status === 'running';
  if (running) { toast('Wait until the current work finishes before changing the frame style.', 'error'); return render(); }
  if (!confirm(`Redraw every frame${filmed ? ' (your filmed takes stay)' : ''} and each character's portrait in the ${META.styles.find(s => s.id === style)?.name || style} style? About $${(0.07 * (P.production.shots.length + 2 * P.production.cast.length)).toFixed(2)}.`)) return render();
  P.production.style = style;
  try { await api('productions/' + P.id, { method: 'PUT', body: { style } }); } catch (e) { toast(e.message, 'error'); return render(); }
  redrawAll();
}
async function redrawAll() {
  await save(true);
  try { const r = await api(`productions/${P.id}/boards`, { method: 'POST', body: {} }); Object.assign(P, r); render(); follow(); }
  catch (e) { toast(e.message, 'error'); }
}
// frames land one by one: refetch as each is reported
function follow() {
  stopEvents();
  P.job = { status: 'running', step: 'Drawing…' };
  render();
  events = new EventSource(`/api/films/${P.id}/events`);
  let pending = 0;
  events.onmessage = e => {
    const d = JSON.parse(e.data);
    P.job = { status: d.status, step: d.step, pct: d.pct };
    if (/ failed: /.test(d.line || '')) toast(d.line.replace(/^(take for|frame) [\w-]+ failed: /, ''), 'error', 8000);
    clearTimeout(pending);
    pending = setTimeout(() => refresh().catch(() => {}), 150);
    if (d.status !== 'running') { stopEvents(); if (d.status === 'failed') toast(d.error || 'Drawing failed', 'error'); }
  };
  // a dropped connection (a proxy closing a quiet stream, say) reconnects while the work runs
  events.onerror = () => { stopEvents(); refresh().then(() => { if (P.job?.status === 'running') setTimeout(follow, 2000); }).catch(() => {}); };
}
async function stopJob(e) {
  e.currentTarget.disabled = true;
  try { await api(`films/${P.id}/cancel`, { method: 'POST' }); toast('Stopping. Work already under way finishes first.', 'ok'); }
  catch (err) { toast(err.message, 'error'); }
}
function stopEvents() { if (events) { events.close(); events = null; } }

async function animatic() {
  await save(true);
  try {
    const r = await api(`productions/${P.id}/animatic`, { method: 'POST', body: {} });
    toast('Animatic ready. Play it, adjust the voice or timing, then export.', 'ok');
    go('create/' + r.id);
  } catch (e) { toast(e.message, 'error'); }
}
