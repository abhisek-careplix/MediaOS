// Styles: the instant templates and every library style, with frames, hover-to-play demos and a detail sheet.
// pickStyle() reuses the grid as a chooser for new productions.
import { $$, h, icon, sheet, app, go, avgColor } from './core.js';
import { useTemplate } from './create.js';

let root, query = '', cat = 'All';

export function mountGallery(el) { root = el; }

export function showGallery() {
  if (root.childElementCount) return;
  render();
}

function render() {
  const G = app.gallery;
  const cats = ['All', 'Instant', ...new Set(G.styles.map(s => s.category))];
  const search = h('label', { class: 'search' }, icon('search', 15), h('input', { placeholder: 'Search styles', value: query, 'aria-label': 'Search styles', oninput: e => { query = e.target.value.toLowerCase(); paint(); } }));
  const chips = h('div', { class: 'cats', role: 'tablist' }, cats.map(c => h('button', { class: 'chip' + (c === cat ? ' on' : ''), role: 'tab', 'aria-selected': c === cat, onclick: e => { cat = c; $$('.chip', chips).forEach(b => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-selected', b === e.currentTarget); }); paint(); } }, c)));
  const body = h('div', { style: { display: 'grid', gap: '36px' } });
  root.replaceChildren(h('div', { class: 'gallery' },
    h('div', { class: 'g-top' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Styles'), h('h1', { class: 'title-xl' }, 'Every look, ready to direct.'),
      h('p', { class: 'sub' }, `${G.templates.length} instant templates render in about a minute. ${G.styles.length} directed styles are made frame by frame by Claude.`)), search),
    chips, body,
    h('p', { class: 'credit' }, 'Style frames and demo films: ', h('a', { href: G.source, target: '_blank', rel: 'noopener' }, 'Lemo-Opuscar by LemoLab'), ', CC BY 4.0. Demos stream from the official gallery.')));
  const paint = () => {
    body.replaceChildren();
    const match = s => !query || [s.name, s.category, s.film, s.line, ...(s.uses || [])].join(' ').toLowerCase().includes(query);
    if ((cat === 'All' || cat === 'Instant') && G.templates.some(t => match({ name: t.name, category: 'Instant', line: t.blurb }))) {
      body.append(h('section', { class: 'cat-block' }, h('div', { class: 'section-head' }, h('h2', { class: 'title-m' }, 'Instant'), h('span', { class: 'faint' }, 'Script in seconds · preview instantly · MP4 in about a minute')),
        h('div', { class: 'instant-row' }, G.templates.map(t => {
          const v = h('video', { src: t.teaser, poster: t.teaser.replace('.mp4', '.jpg'), muted: true, loop: true, autoplay: true, playsinline: true });
          v.muted = true;
          return h('button', { class: 'instant', onclick: () => { useTemplate(t.id); go('create'); } }, v,
            h('span', { class: 'badge instant' }, icon('bolt', 11), 'Instant'),
            h('div', { class: 'over' }, h('b', {}, t.name), h('span', {}, t.blurb + ' Click to create.')));
        }))));
    }
    if (cat === 'Instant') return;
    const groups = new Map();
    for (const s of G.styles) if ((cat === 'All' || s.category === cat) && match(s)) (groups.get(s.category) || groups.set(s.category, []).get(s.category)).push(s);
    for (const [name, list] of groups) body.append(h('section', { class: 'cat-block' }, h('div', { class: 'section-head' }, h('h2', { class: 'title-m' }, name), h('span', { class: 'faint' }, `${list.length} styles`)), h('div', { class: 'cards' }, list.map(s => card(s, () => detail(s))))));
    if (!body.childElementCount) body.append(h('div', { class: 'empty-state' }, icon('search', 28), `No style matches “${query}”.`));
  };
  paint();
}

// a style card: frame, colour-matched glow, demo plays on hover
export function card(s, onClick) {
  const img = h('img', { src: s.frame, alt: '', loading: 'lazy' });
  const frame = h('div', { class: 'frame' }, img, s.dur ? h('span', { class: 'dur' }, `${Math.floor(s.dur / 60)}:${String(Math.round(s.dur % 60)).padStart(2, '0')}`) : null,
    s.instant ? h('span', { class: 'badge instant' }, icon('bolt', 11), 'Instant') : null);
  const el = h('button', { class: 'card', onclick: onClick, 'aria-label': `${s.name}: ${s.line}` }, frame, h('b', {}, s.name), h('span', { class: 'film' }, s.film), h('p', {}, s.line));
  img.addEventListener('load', () => el.style.setProperty('--c', avgColor(img)));
  let timer = 0, vid = null;
  const enter = () => {
    timer = setTimeout(() => {
      vid = h('video', { src: s.video, muted: true, loop: true, playsinline: true, preload: 'auto' });
      vid.muted = true;
      vid.addEventListener('loadeddata', () => { vid.currentTime = Math.min(6, (s.dur || 20) * 0.2); });
      vid.addEventListener('playing', () => vid.classList.add('ready'));
      frame.append(vid);
      vid.play().catch(() => {});
    }, 350);
  };
  const leave = () => { clearTimeout(timer); vid?.remove(); vid = null; };
  el.addEventListener('mouseenter', enter);
  el.addEventListener('mouseleave', leave);
  el.addEventListener('focus', enter);
  el.addEventListener('blur', leave);
  return el;
}

function detail(s) {
  sheet(close => h('div', { class: 'detail' },
    h('video', { src: s.video, poster: s.frame, controls: true, autoplay: true, playsinline: true }),
    h('div', { class: 'info' },
      h('div', { class: 'eyebrow' }, s.category),
      h('h2', { class: 'title-l' }, s.name),
      h('div', { class: 'muted' }, `Demo: ${s.film}`, s.dur ? ` · ${Math.round(s.dur)} s` : ''),
      s.essence ? h('p', { class: 'essence' }, s.essence) : null,
      h('p', { class: 'muted', style: { margin: 0 } }, s.line),
      s.uses?.length ? h('div', {}, h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, 'Good for'), h('div', { class: 'uses' }, s.uses.map(u => h('span', { class: 'chip' }, u)))) : null,
      h('div', { class: 'actions', style: { marginTop: '6px' } },
        s.instant ? h('button', { class: 'btn primary', onclick: () => { close(); useTemplate(s.instant); go('create'); } }, icon('bolt', 15), 'Create instantly') : null,
        h('button', { class: s.instant ? 'btn' : 'btn primary', onclick: () => { close(); go('studio/new/' + s.slug); } }, icon('clapper', 15), 'Direct a film in this style')),
      h('a', { class: 'faint', href: s.video, target: '_blank', rel: 'noopener' }, 'Open the demo film in a new tab ↗'),
      h('p', { class: 'credit' }, `${s.film}: a demo film by LemoLab, CC BY 4.0. Your films are yours.`))), { wide: true });
}

// choose a style for a production; resolves to a slug or null
export function pickStyle() {
  return new Promise(resolve => {
    let picked = null;
    sheet(close => {
      let q = '';
      const grid = h('div', { class: 'cards', style: { padding: '0 28px 28px' } });
      const paint = () => grid.replaceChildren(...app.gallery.styles.filter(s => !q || [s.name, s.category, s.line].join(' ').toLowerCase().includes(q)).map(s => card(s, () => { picked = s.slug; close(); })));
      paint();
      return h('div', {},
        h('div', { class: 'sheet-body', style: { position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 2 } },
          h('h2', { class: 'title-l' }, 'Choose a style'),
          h('label', { class: 'search', style: { width: '100%' } }, icon('search', 15), h('input', { placeholder: 'Search 66 styles', autofocus: true, oninput: e => { q = e.target.value.toLowerCase(); paint(); } }))),
        grid);
    }, { wide: true, onClose: () => resolve(picked) });
  });
}
