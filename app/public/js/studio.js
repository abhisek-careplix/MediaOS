// Studio: director productions. A composer to start one, and a live production board that reads Claude's
// activity stream and turns it into stages, a monitor of the frames it is reviewing, notes, documents and dailies.
import { $, $$, h, api, icon, toast, sheet, app, go, emit, segmented, pillSelect, markdown, fileURL, fmtLong, timeAgo } from './core.js';
import { pickStyle } from './gallery.js';
import { resultView } from './create.js';

export const STAGES = [
  ['brief', 'Brief', 'book'], ['treatment', 'Treatment', 'pencil'], ['look', 'Look', 'brush'], ['voice', 'Voice', 'wave'], ['music', 'Score', 'music'],
  ['animate', 'Animate', 'sparkles'], ['render', 'Render', 'film'], ['mix', 'Mix', 'sliders'], ['review', 'Review', 'eye'], ['deliver', 'Deliver', 'export'],
];
const SI = Object.fromEntries(STAGES.map(([id], i) => [id, i]));
const IMG = /([\w./~-]+\.(?:jpe?g|png))/i;

// Read one activity line from the director run and infer what Claude is doing.
export function classify(line, st) {
  const m = /^▸ (\w+)(?::\s?(.*))?$/s.exec(line);
  if (!m) {
    if (/^(Starting the director|Starting Claude|── )/.test(line)) return { kind: 'system', label: line.replace(/^── /, '').replace(/^Starting Claude.*/, 'Starting the director…') };
    if (/^Finished:/.test(line)) { const c = /\$([\d.]+)/.exec(line); return { kind: 'finish', cost: c ? +c[1] : null }; }
    if (/^(Error:|Cancelled\.)/.test(line)) return { kind: 'error', label: line };
    return { kind: 'note', text: line };
  }
  const [, tool, arg = ''] = m;
  const late = st.max >= SI.render;
  // commands as people read them: paths inside the film or the style library, without the server's folders
  const brief = s => s.replace(/(?:\/[\w.@-]+)+\/films\/[\w-]+\//g, '').replace(/(?:\/[\w.@-]+)*\/lemo-opuscar\//g, '').replace(/\s+/g, ' ').slice(0, 90);
  const file = (/([\w.-]+\.\w+)(?=\s|$|['"])/.exec(arg.split(/\s+/).find(w => /\.\w{1,5}$/.test(w)) || '') || [])[1] || arg.split('/').pop().slice(0, 60);
  const a = arg;
  const r = (stage, label, ic, extra = {}) => ({ kind: 'tool', tool, arg, stage, label, icon: ic, ...extra });
  if (tool === 'Skill') return r('brief', 'Opening the Lemo-Opuscar playbook', 'book');
  if (tool === 'TodoWrite') return r(null, 'Planning the next steps', 'sliders');
  if (tool === 'WebSearch' || tool === 'WebFetch') return r(st.max < SI.treatment ? 'treatment' : null, 'Researching sources', 'globe', { detail: a });
  if (/setup\.sh[^|]*\bdemo\b/.test(a)) return r('treatment', 'Studying the style’s demo techniques', 'book');
  if (/setup\.sh[^|]*\bdeps\b/.test(a)) return r('brief', 'Installing the tools this film needs', 'cpu');
  if (/setup\.sh/.test(a)) return r('brief', 'Getting the style library ready', 'cpu');
  if (/\bTREATMENT\.md/.test(a) && /Write|Edit/.test(tool)) return r('treatment', 'Writing the treatment', 'pencil', { doc: a });
  if (/\bFACTS\.md/.test(a) && /Write|Edit/.test(tool)) return r('treatment', 'Sourcing every fact', 'doc', { doc: a });
  if (/\bCREDITS\b/.test(a) && (/Write|Edit/.test(tool) || /cat >/.test(a))) return r('deliver', 'Writing the credits', 'doc', { doc: (/(\S*CREDITS\S*)/.exec(a) || [])[1] });
  if (/STYLE\.md/.test(a)) return r('brief', 'Studying the style guide', 'book', { detail: a });
  if (/(AGENTS|DIRECTOR|TECHNIQUE|MY-STYLES)\.md|core\/README/.test(a)) return r('brief', 'Reading the director’s handbook', 'book', { detail: file });
  if (/DEMO\.md|\/demo\//.test(a)) return r('treatment', 'Learning techniques from the demo', 'book', { detail: file });
  if (/asr_check/.test(a)) return r(late ? 'review' : 'voice', 'Listening back to the narration', 'wave');
  if (/tts(_zh)?\.py|kokoro/.test(a)) return r('voice', 'Recording the narration', 'wave');
  if (/lines\.json/.test(a) && /Write|Edit/.test(tool)) return r('voice', 'Writing the narration script', 'pencil');
  if (/sampler\.py|pluck\.py|score|music/.test(a) && !/mix\.py/.test(a)) return r('music', /Write|Edit/.test(tool) ? 'Writing the score' : 'Composing the score', 'music', { detail: file });
  if (/video\.mjs/.test(a)) return r('render', 'Rendering every frame', 'film');
  if (/mux\.sh/.test(a)) return r('mix', 'Mastering the film', 'sliders');
  if (/mix\.py/.test(a)) return r('mix', 'Mixing voice, score and sound', 'sliders');
  if (/ebur128|blackdetect|readcheck|cuecheck|subcheck/.test(a)) return r('review', 'Running final checks', 'eye');
  if (/final\.mp4/.test(a) && /\bcp\b/.test(a)) return r('deliver', 'Delivering the film', 'export');
  if (/still\.mjs|sheet\.py|-frames:v/.test(a)) return r(late ? 'review' : 'look', 'Rendering frames to check', 'photo', { image: (/sheet\.py\s+(\S+\.jpe?g)/.exec(a) || [])[1] });
  if (tool === 'Read' && IMG.test(a)) return r(late ? 'review' : 'look', 'Looking at a frame', 'eye', { image: a.trim(), detail: file });
  if (/events\.mjs/.test(a)) return r('animate', 'Exporting sound cues from the picture', 'sparkles');
  if (/Write|Edit/.test(tool) && /\.(html|js|mjs|css)\b/.test(a)) return r(late ? 'review' : 'animate', late ? 'Fixing the picture' : 'Drawing the film in code', 'brush', { detail: file });
  if (/Write|Edit/.test(tool)) return r(null, 'Writing ' + file, 'pencil', { detail: file });
  if (tool === 'Read') return r(null, 'Reading ' + file, 'doc', { detail: file });
  if (tool === 'Glob' || tool === 'Grep') return r(null, 'Searching the project', 'search');
  if (tool === 'Bash') return r(null, 'Running a command', 'terminal', { detail: brief(a) });
  return r(null, tool, 'cpu', { detail: brief(a) });
}

let root, current = null, es = null, filesTimer = 0, clockTimer = 0;

export function mountStudio(el) { root = el; }

export async function showStudio(args) {
  const films = (await api('films')).filter(f => f.mode === 'director');
  const layout = h('div', { class: 'studio' }, prodList(films, args[0]), h('div', { class: 'stage-main' }));
  if (args[0] === 'new') {
    teardown();
    root.replaceChildren(layout);
    composer(layout.lastChild, args[1]);
    return;
  }
  const id = args[0] || films.find(f => f.status === 'running')?.id || films[0]?.id;
  if (!id) { teardown(); root.replaceChildren(layout); return composer(layout.lastChild); }
  if (current?.id === id && root.querySelector('.board')) { root.querySelector('.prods').replaceWith(prodList(films, id)); return; }
  teardown();
  root.replaceChildren(layout);
  board(layout.lastChild, films.find(f => f.id === id) || (await api('films/' + id)).meta);
}

function teardown() {
  es?.close(); es = null;
  clearInterval(filesTimer); clearInterval(clockTimer);
  current = null;
}

function styleOf(slug) { return app.gallery.styles.find(s => s.slug === slug) || {}; }

function prodList(films, active) {
  return h('nav', { class: 'prods', 'aria-label': 'Productions' },
    h('div', { class: 'prods-head' }, h('span', { class: 'eyebrow' }, 'Productions'), h('button', { class: 'btn ghost round', title: 'New production', 'aria-label': 'New production', onclick: () => go('studio/new') }, icon('plus', 16))),
    films.length ? films.map(f => {
      const st = styleOf(f.style);
      return h('button', { class: 'prod' + (f.id === active ? ' on' : ''), onclick: () => go('studio/' + f.id) },
        st.frame ? h('img', { src: f.poster ? `/films/${f.id}/${f.poster}` : st.frame, alt: '' }) : h('span', { class: 'ph' }),
        h('div', { style: { minWidth: 0 } }, h('b', {}, f.filmTitle || (f.prompt || st.name || f.style).slice(0, 48)), h('small', {}, h('span', { class: 'badge ' + (f.status === 'running' ? 'live' : f.status) }, f.status === 'running' ? 'Live' : f.status), timeAgo(f.created))));
    }) : h('p', { class: 'faint', style: { padding: '0 8px' } }, 'No productions yet.'));
}

// —— composer ——
async function composer(el, preset) {
  const st = { style: preset || 'watercolor', seconds: '45', aspect: '16:9', model: 'opus', prompt: '', notes: '', brandId: (app.brands || []).some(b => b.id === localStorage.getItem('vg.brand')) ? localStorage.getItem('vg.brand') : '' };
  const pick = h('button', { class: 'style-pick', onclick: async () => { const s = await pickStyle(); if (s) { st.style = s; paintPick(); } } });
  const paintPick = () => {
    const s = styleOf(st.style);
    pick.replaceChildren(h('img', { src: s.frame, alt: '' }), h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, s.category), h('b', {}, s.name), h('small', {}, s.line)), h('span', { class: 'btn' }, 'Change'));
  };
  paintPick();
  const ta = h('textarea', { rows: 4, placeholder: 'What is the film about? Who is it for? Anything that must appear?', oninput: e => { st.prompt = e.target.value; } });
  const start = h('button', { class: 'btn primary big', onclick: async () => {
    if (!st.prompt.trim()) { ta.focus(); return toast('Describe the film first.', 'error'); }
    start.disabled = true;
    try {
      const r = await api('director', { method: 'POST', body: { ...st, seconds: +st.seconds } });
      emit('productions');
      go('studio/' + r.id);
    } catch (e) { toast(e.message, 'error'); start.disabled = false; }
  } }, icon('clapper', 16), 'Start production');
  el.append(h('div', { class: 'composer' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Director mode'), h('h1', { class: 'title-l' }, 'New production'), h('p', { class: 'sub' }, 'A complete film in any of the library’s styles, directed for you: treatment, drawing code, voice, score, mix and a self-check.')),
    h('div', { class: 'field' }, h('span', {}, 'Style'), pick),
    h('div', { class: 'field' }, h('span', {}, 'The film'), h('div', { class: 'glow' }, h('div', { class: 'prompt' }, ta))),
    h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' } },
      segmented([['30'], ['45'], ['60'], ['90']].map(([v]) => ({ v, label: v + ' s' })), st.seconds, v => { st.seconds = v; }, { label: 'Length' }),
      segmented([{ v: '16:9', icon: 'landscape', label: '16:9' }, { v: '9:16', icon: 'portrait', label: '9:16' }], st.aspect, v => { st.aspect = v; }, { label: 'Format' }),
      pillSelect([['opus', 'Best director (recommended)'], ['sonnet', 'Faster director (cheaper)']], st.model, v => { st.model = v; }, 'Director'),
      pillSelect([['', 'No brand kit'], ...(app.brands || []).map(b => [b.id, b.name])], st.brandId, v => { st.brandId = v; }, 'Brand kit')),
    h('label', { class: 'field' }, h('span', {}, 'Notes for the director (optional)'), h('input', { placeholder: 'e.g. warm British female voice, no music under the opening line', oninput: e => { st.notes = e.target.value; } })),
    app.me && !app.me.canDirect ? h('div', { class: 'callout' }, icon('info', 18), h('div', {}, app.me.open
      ? [h('b', {}, 'Director mode is off on the public site. '), 'It runs an agent with shell access and costs a few dollars per film, so it needs sign-in. Instant films in Create work as usual.']
      : [h('b', {}, 'Director mode isn’t available to you on this server. '), 'Instant films in Create work as usual; ask an admin for access.'])) : null,
    h('div', { class: 'callout' }, icon('info', 18), h('div', {}, h('b', {}, 'Takes 15–60 minutes. '), 'A 30-second test took 17 minutes and about $4 with the best director. It works on its own inside ', h('code', {}, 'films/<id>/'), ', can’t ask you questions, and fills gaps with sensible defaults. You can watch every step here.')),
    h('div', {}, start)));
  setTimeout(() => ta.focus(), 50);
}

// —— production board ——
function board(el, meta) {
  const s = styleOf(meta.style);
  const S = current = { id: meta.id, meta, max: -1, now: null, images: [], seen: new Set(), docMap: new Map(), notes: 0, tools: 0, writes: 0, looks: 0, cost: meta.cost, status: meta.status, elapsed: meta.seconds || 0, base: Date.now() };
  const pill = h('span', { class: 'badge' });
  const clock = h('span', { class: 'clock' }, '0:00');
  const cancelBtn = h('button', { class: 'btn ghost danger', onclick: async () => { if (confirm('Stop this production? It will stop where it is.')) await api(`films/${meta.id}/cancel`, { method: 'POST' }); } }, icon('stop', 14), 'Stop');
  const railBar = h('div', { class: 'bar' });
  const rail = h('div', { class: 'rail' }, railBar, STAGES.map(([id, name, ic]) => h('div', { class: 'stage', 'data-id': id }, h('span', { class: 'node' }, icon(ic, 15)), h('span', {}, name))));
  const monitor = h('div', { class: 'monitor' }, h('div', { class: 'idle' }, h('div', { class: 'orb' }), h('span', {}, 'Frames appear here as they’re drawn and reviewed.')));
  const nowCard = h('div', { class: 'now-card' });
  const stats = h('div', { class: 'stats' });
  const notes = h('div', { class: 'notes-list' });
  const dailies = h('div', { class: 'dailies' });
  const docs = h('div', { class: 'docs' });
  const raw = h('pre');
  const titleEl = h('h2', {}, meta.filmTitle || (meta.prompt || s.name || meta.style).slice(0, 70));
  el.append(h('div', { class: 'board' },
    h('div', { class: 'board-head' }, s.frame ? h('img', { class: 'thumb', src: s.frame, alt: '' }) : null,
      h('div', { class: 'grow' }, titleEl, h('div', { class: 'meta' }, pill, h('span', {}, `${s.name} · ${meta.aspect || '16:9'} · ${(meta.model || 'opus') === 'opus' ? 'best director' : 'faster director'}`), clock)),
      cancelBtn),
    rail,
    h('div', { class: 'board-grid' },
      h('div', { style: { display: 'grid', gap: '16px', minWidth: 0 } }, monitor,
        h('div', {}, h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, 'Dailies'), h('span', { class: 'faint', 'data-count': '' })), dailies),
        h('div', {}, h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, 'Documents')), docs),
        h('div', { class: 'faint' }, 'Brief: ', meta.prompt || '')),
      h('div', { style: { display: 'grid', gap: '16px' } }, nowCard, stats,
        h('div', { class: 'notes' }, h('div', { class: 'notes-head' }, h('span', { class: 'eyebrow' }, 'Director’s notes')), notes))),
    h('details', { class: 'hood' }, h('summary', {}, icon('terminal', 14), 'Under the hood: raw activity'), raw)));
  Object.assign(S, { pill, clock, cancelBtn, rail, railBar, monitor, nowCard, stats, notes, dailies, docsEl: docs, raw, titleEl });
  paintStatus();
  paintNow({ label: meta.status === 'running' ? 'Starting up' : 'Waiting for activity', icon: 'sparkles' });
  paintStats();

  es = new EventSource(`/api/films/${meta.id}/events`);
  es.onmessage = m => {
    if (current !== S) return;
    const d = JSON.parse(m.data);
    for (const l of d.backlog || []) ingest(S, l, true);
    if (d.line) ingest(S, d.line, false);
    if (d.elapsed != null) { S.elapsed = d.elapsed; S.base = Date.now(); }
    if (d.status && d.status !== S.status) { S.status = d.status; S.output = d.output; S.error = d.error; paintStatus(); }
    if (d.status === 'done') { S.output = d.output || meta.output; finish(S); }
    if (d.status && d.status !== 'running') { es.close(); syncFiles(S); }
  };
  es.onerror = () => es?.close();
  clockTimer = setInterval(() => paintClock(S), 1000);
  syncFiles(S);
  filesTimer = setInterval(() => { if (S.status === 'running') syncFiles(S); }, 10000);
}

function ingest(S, line, quiet) {
  S.raw.textContent += line + '\n';
  if (!quiet) S.raw.scrollTop = 1e9;
  const c = classify(line, S);
  if (c.kind === 'note') return addNote(S, c.text, quiet);
  if (c.kind === 'finish') { S.cost = c.cost; paintStats(); return; }
  if (c.kind === 'error') return addNote(S, '**' + c.label + '**', quiet);
  if (c.kind !== 'tool') return;
  S.tools++;
  if (/Write|Edit/.test(c.tool)) S.writes++;
  if (c.stage && SI[c.stage] > S.max) { S.max = SI[c.stage]; paintRail(S); }
  S.now = c;
  paintNow(c, S);
  if (c.image) addImage(S, c.image, c.detail || c.image.split('/').pop(), quiet, c.tool === 'Read');
  if (c.doc) addDoc(S, c.doc);
  paintStats();
}

function paintStatus() {
  const S = current;
  const st = S.status === 'running' ? ['live', 'On air'] : S.status === 'done' ? ['done', 'Premiered'] : [S.status, S.status === 'interrupted' ? 'Interrupted' : S.status];
  S.pill.className = 'badge ' + st[0];
  S.pill.textContent = st[1];
  S.cancelBtn.hidden = S.status !== 'running';
  if (S.status === 'done') { S.max = STAGES.length - 1; paintRail(S); paintNow({ label: 'The film is finished', icon: 'check', detail: S.output }, S, true); }
  if (S.status === 'failed' || S.status === 'interrupted' || S.status === 'cancelled') paintNow({ label: S.status === 'cancelled' ? 'Stopped' : 'Stopped early', icon: 'info', detail: S.error || '' }, S, true);
  $('#nav-live').hidden = S.status !== 'running';
}
function paintClock(S) {
  const sec = S.status === 'running' ? S.elapsed + (Date.now() - S.base) / 1000 : S.elapsed;
  S.clock.textContent = fmtLong(sec);
}
function paintRail(S) {
  $$('.stage', S.rail).forEach((el, i) => {
    el.classList.toggle('done', i < S.max || (S.status === 'done' && i <= S.max));
    el.classList.toggle('now', i === S.max && S.status === 'running');
  });
  S.railBar.style.width = (Math.max(0, S.max) / (STAGES.length - 1)) * 90 + '%';
}
function paintNow(c, S = current, idle = false) {
  const stage = c.stage ? STAGES[SI[c.stage]][1] : S && S.max >= 0 ? STAGES[S.max][1] : '';
  S.nowCard.replaceChildren(
    h('div', { class: 'eyebrow' }, idle ? 'Status' : 'Working on…'),
    h('div', { class: 'act' + (idle || S.status !== 'running' ? ' idle' : '') }, h('span', { class: 'ico' }, icon(c.icon || 'sparkles', 20)),
      h('div', { style: { minWidth: 0 } }, h('b', {}, c.label), h('small', {}, [stage, c.detail].filter(Boolean).join(' · ')))));
}
function paintStats() {
  const S = current;
  if (!S) return;
  const items = [[S.tools, 'actions'], [S.writes, 'files written'], [S.images.length, 'frames seen'], [S.cost != null ? '$' + S.cost.toFixed(2) : '—', 'cost']];
  S.stats.replaceChildren(...items.map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l))));
}

function addNote(S, text, quiet) {
  if (!text.trim()) return;
  S.notes.append(h('div', { class: 'note' }, h('div', { class: 'when' }, h('i'), S.max >= 0 ? STAGES[S.max][1] : 'Brief'), markdown(text)));
  if (!quiet) S.notes.scrollTop = 1e9;
  else requestAnimationFrame(() => { S.notes.scrollTop = 1e9; });
  const t = /\*\*([^*]{3,60})\*\*/.exec(text);
  if (t && /made|film|titled|called/i.test(text) && !S.named) { S.named = true; S.titleEl.textContent = t[1]; }
}

function addImage(S, p, label, quiet, show = true) {
  const url = fileURL(p, S.id);
  if (!url || S.seen.has(url)) { if (url && show) showOnMonitor(S, url, label); return; }
  S.seen.add(url);
  S.images.push(url);
  const img = h('img', { src: url + '?v=1', alt: label, loading: 'lazy' });
  let tries = 0;
  img.onerror = () => { if (tries++ < 6) setTimeout(() => { img.src = url + '?v=' + Date.now(); }, 4000); else btn.remove(); };
  const btn = h('button', { class: 'daily', title: label, onclick: () => lightbox(url, label) }, img, h('span', {}, label.replace(/\.(jpe?g|png)$/i, '')));
  S.dailies.append(btn);
  S.dailies.scrollLeft = 1e9;
  const count = S.dailies.closest('div').parentElement.querySelector('[data-count]');
  if (count) count.textContent = `${S.images.length} frames`;
  if (show && S.status !== 'done') showOnMonitor(S, url, label);
}
function showOnMonitor(S, url, label) {
  if (S.final) return;
  const img = h('img', { src: url + '?v=' + Date.now(), alt: '', style: { opacity: 0 } });
  img.onload = () => {
    img.style.opacity = 1;
    $$('img, .idle', S.monitor).forEach(x => { if (x !== img) { x.style.opacity = 0; setTimeout(() => x.remove(), 700); } });
  };
  img.onerror = () => img.remove();
  $('.cap', S.monitor)?.remove();
  S.monitor.append(img, h('div', { class: 'cap' }, icon('eye', 14), h('span', {}, 'Reviewing ', h('b', {}, label))));
}
function finish(S) {
  if (S.final || !S.output) return;
  S.final = true;
  const src = `/films/${S.id}/${S.output}`;
  S.monitor.replaceChildren(h('video', { src, controls: true, playsinline: true, poster: S.images[S.images.length - 1] || undefined }),
    h('span', { class: 'badge done tally' }, icon('check', 11), 'Final cut'));
  const actions = h('div', { class: 'actions' },
    h('a', { class: 'btn white', href: src, download: S.output.split('/').pop() }, icon('download', 15), 'Download MP4'),
    h('a', { class: 'btn', href: src.replace(/\.mp4$/, '.srt'), download: true }, 'Subtitles'));
  S.monitor.insertAdjacentElement('afterend', actions);
}

function addDoc(S, p) {
  const m = /(\S*?(?:TREATMENT\.md|FACTS\.md|CREDITS))/.exec(p);
  const path = m ? m[1] : p;
  const url = fileURL(path, S.id);
  if (!url || S.docMap.has(url)) return;
  const name = path.split('/').pop();
  S.docMap.set(url, name);
  const sub = { 'TREATMENT.md': 'Story and structure', 'FACTS.md': 'Every figure, sourced', CREDITS: 'Assets and licences' }[name] || '';
  S.docsEl.append(h('button', { class: 'doc-chip', onclick: () => reader(url, name) }, icon('doc', 16), h('span', {}, name, h('br'), h('small', {}, sub))));
}

async function syncFiles(S) {
  try {
    const files = await api(`films/${S.id}/files`);
    for (const f of files) {
      const url = `/films/${S.id}/${f.path}`;
      if (f.kind === 'image' && !/\/fonts\//.test(f.path) && !/poster\.jpg$/.test(f.path) && !S.seen.has(url)) addImage(S, `${app.cfg.films}/${S.id}/${f.path}`, f.path.split('/').pop(), true, false);
      if (f.kind === 'doc' && /TREATMENT|FACTS/.test(f.path)) addDoc(S, f.path);
    }
    if (files.some(f => /CREDITS$/.test(f.path))) addDoc(S, files.find(f => /CREDITS$/.test(f.path)).path);
    if (S.status === 'done' && !S.final) finish(S);
  } catch { /* older server without the files route */ }
  paintStats();
}

function lightbox(url, label) {
  sheet(h('div', { class: 'lightbox' }, h('img', { src: url, alt: label }), h('div', { class: 'cap' }, label)), { wide: true });
}
async function reader(url, name) {
  let text = '';
  try { text = await (await fetch(url)).text(); } catch { text = 'Could not open ' + name; }
  sheet(h('div', { class: 'reader' }, h('div', { class: 'eyebrow' }, 'Document'), h('h1', { class: 'title-l', style: { marginBottom: '10px' } }, name), name.endsWith('.md') ? markdown(text) : h('pre', { style: { whiteSpace: 'pre-wrap', font: '13px/1.6 var(--mono)', color: 'var(--text2)' } }, text)), { wide: true });
}
