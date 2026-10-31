// Shared plumbing for the studio: DOM helpers, API, icons, toasts, sheets, routing and app-wide state.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

export async function api(path, opts = {}) {
  const r = await fetch('/api/' + path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
    throw Object.assign(new Error('Signing in…'), { status: 401 });
  }
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  return j;
}

export const fmt = t => {
  t = Math.max(0, t || 0);
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
};
export const fmtLong = s => {
  s = Math.max(0, Math.round(s || 0));
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`;
};
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// SF Symbols–like line icons, 24-unit grid
const P = {
  sparkles: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z',
  clapper: 'M4 9h16v10a1 1 0 01-1 1H5a1 1 0 01-1-1zM4 9l1-4 15 1-1 3M8.5 5.4L7.5 9M13.5 5.8L12.5 9',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  export: 'M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7',
  chevronL: 'M15 5l-7 7 7 7',
  chevronR: 'M9 5l7 7-7 7',
  chevronD: 'M6 9l6 6 6-6',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  search: 'M10.5 4a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.5 15.5L20 20',
  wave: 'M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21 12h0',
  music: 'M9 18V6l11-2v12M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM20 16a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
  doc: 'M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v5h5M9 13h7M9 17h5',
  photo: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9a1 1 0 100-.01',
  brush: 'M14 4l6 6-8.5 8.5a3 3 0 01-4.2 0l-1.8-1.8a3 3 0 010-4.2zM5.5 18.5L3 21',
  cpu: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  book: 'M5 4h6a2 2 0 012 2v14a2 2 0 00-2-2H5zM19 4h-4a2 2 0 00-2 2v14a2 2 0 012-2h4z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 110 6 3 3 0 010-6z',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  globe: 'M12 3a9 9 0 110 18 9 9 0 010-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  pencil: 'M15 5l4 4L8 20H4v-4zM13 7l4 4',
  stop: 'M7 7h10v10H7z',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14',
  plus: 'M12 5v14M5 12h14',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  landscape: 'M3 7h18v10H3z',
  portrait: 'M8 3h8v18H8z',
  info: 'M12 3a9 9 0 110 18 9 9 0 010-18zM12 11v5M12 7.5v.01',
  palette: 'M12 3a9 9 0 100 18c1.2 0 1.8-.8 1.8-1.7 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.6 1.8-1.6H17a4 4 0 004-4c0-4.4-4-8-9-8zM7.5 12.5v.01M9 8.5v.01M13.5 7.5v.01M17 10v.01',
};
export function icon(name, size = 18, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ic ' + cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || P.info);
  s.append(p);
  return s;
}

// —— toasts ——
export function toast(msg, kind = 'info', ms = 5200) {
  const root = $('#toasts');
  const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, icon(kind === 'error' ? 'info' : kind === 'ok' ? 'check' : 'sparkles', 16), h('span', {}, ...codeSpans(msg)));
  root.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, ms);
}
export function codeSpans(s) {
  return String(s).split(/(`[^`]+`)/).map(p => p.startsWith('`') ? h('code', {}, p.slice(1, -1)) : p);
}

// —— modal sheets ——
export function sheet(content, { wide = false, onClose } = {}) {
  const root = $('#sheets');
  const prev = document.activeElement;
  const box = h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
  const close = () => {
    wrap.classList.remove('in');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => { wrap.remove(); onClose?.(); prev?.focus?.(); }, 280);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const wrap = h('div', { class: 'scrim', onclick: e => { if (e.target === wrap) close(); } }, box);
  box.append(h('button', { class: 'sheet-x', 'aria-label': 'Close', onclick: close }, icon('x', 16)), typeof content === 'function' ? content(close) : content);
  root.append(wrap);
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => wrap.classList.add('in'));
  setTimeout(() => (box.querySelector('[autofocus]') || box.querySelector('.sheet-x'))?.focus?.({ preventScroll: true }), 60);
  return close;
}

// tiny, safe markdown for notes and documents
export function markdown(src) {
  const out = h('div', { class: 'md' });
  const inline = text => {
    const frag = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.push(text.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('**')) frag.push(h('strong', {}, t.slice(2, -2)));
      else if (t.startsWith('`')) frag.push(h('code', {}, t.slice(1, -1)));
      else { const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t); frag.push(/^https?:/.test(mm[2]) ? h('a', { href: mm[2], target: '_blank', rel: 'noopener' }, mm[1]) : mm[1]); }
      last = m.index + t.length;
    }
    if (last < text.length) frag.push(text.slice(last));
    return frag;
  };
  let list = null, table = null;
  for (const raw of String(src).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|[\s:-|]+\|\s*$/.test(line)) continue;
      if (!table) { table = h('table'); out.append(table); }
      table.append(h('tr', {}, line.split('|').slice(1, -1).map(c => h('td', {}, inline(c.trim())))));
      continue;
    }
    table = null;
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      if (!list) { list = h('ul'); out.append(list); }
      list.append(h('li', {}, inline(li[1])));
      continue;
    }
    list = null;
    const hd = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hd) out.append(h('h' + Math.min(4, hd[1].length + 1), {}, inline(hd[2])));
    else if (/^>\s?/.test(line)) out.append(h('blockquote', {}, inline(line.replace(/^>\s?/, ''))));
    else if (/^```/.test(line) || /^---+$/.test(line)) continue;
    else if (line.trim()) out.append(h('p', {}, inline(line)));
  }
  return out;
}

// average colour of an image, for glows
const colorCache = new Map();
export function avgColor(img) {
  if (colorCache.has(img.src)) return colorCache.get(img.src);
  try {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 9;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 16, 9);
    const d = g.getImageData(0, 0, 16, 9).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      const w = 1 + sat / 40;
      r += d[i] * w; gg += d[i + 1] * w; b += d[i + 2] * w; n += w;
    }
    const col = `${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)}`;
    colorCache.set(img.src, col);
    return col;
  } catch { return '120,120,140'; }
}

// app-wide state and a tiny event bus
export const app = { cfg: null, gallery: null, films: [], bus: new EventTarget() };
export const on = (name, fn) => app.bus.addEventListener(name, e => fn(e.detail));
export const emit = (name, detail) => app.bus.dispatchEvent(new CustomEvent(name, { detail }));

// hash routing: #create, #create/<film>, #studio, #studio/<film>, #studio/new/<style>, #gallery, #library
export function go(hash) {
  if (location.hash !== '#' + hash) location.hash = hash;
  else emit('route', parseRoute());
}
export function parseRoute() {
  const [view = 'create', ...rest] = location.hash.replace(/^#/, '').split('/');
  return { view, args: rest };
}

// map a path seen in Claude's activity to a URL the studio can show
export function fileURL(p, filmId) {
  if (!p) return null;
  p = p.replace(/^["']|["']$/g, '');
  const root = app.cfg?.films;
  if (root && p.startsWith(root + '/')) return '/films/' + p.slice(root.length + 1).split('/').map(encodeURIComponent).join('/');
  if (!p.startsWith('/') && !p.startsWith('~')) return `/films/${filmId}/` + p.replace(/^\.\//, '').split('/').map(encodeURIComponent).join('/');
  return null;
}

// native select styled as a pill menu
export function pillSelect(options, value, onChange, label) {
  const s = h('select', { 'aria-label': label, onchange: e => onChange(e.target.value) },
    options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text)));
  return h('label', { class: 'pill-select' }, s, icon('chevronD', 12));
}

// segmented control: options = [{ v, label, icon? }]
export function segmented(options, value, onChange, { label, cls = '' } = {}) {
  const box = h('div', { class: 'seg ' + cls, role: 'radiogroup', 'aria-label': label });
  const set = v => box.querySelectorAll('button').forEach(b => { const on = b.dataset.v === String(v); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  for (const o of options) box.append(h('button', { type: 'button', role: 'radio', 'data-v': o.v, title: o.title, onclick: () => { set(o.v); onChange(o.v); } }, o.icon ? icon(o.icon, 14) : null, o.label));
  set(value);
  box.set = set;
  return box;
}

export const timeAgo = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
