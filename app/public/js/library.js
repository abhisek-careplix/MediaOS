// Library: every film made here, quick and directed, with posters that play on hover.
import { $$, h, api, icon, app, go, segmented, timeAgo } from './core.js';

let root, filter = 'all';

export function mountLibrary(el) { root = el; }

export async function showLibrary() {
  const films = await api('films');
  const grid = h('div', { class: 'lib-grid' });
  const paint = () => {
    const list = films.filter(f => filter === 'all' || (filter === 'mine' ? f.owner === app.me?.email : f.mode === filter));
    grid.replaceChildren(...list.map(tile));
    if (!list.length) grid.replaceChildren(h('div', { class: 'empty-state', style: { gridColumn: '1 / -1' } }, icon('film', 30), 'Nothing here yet.', h('button', { class: 'btn primary', onclick: () => go('create') }, 'Make a film')));
  };
  root.replaceChildren(h('div', { class: 'library' },
    h('div', { class: 'g-top' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Library'), h('h1', { class: 'title-xl' }, 'Your films.'), h('p', { class: 'sub' }, `${films.filter(f => f.output).length} finished · ${films.length} in total, saved in ${app.cfg.films}`)),
      segmented([{ v: 'all', label: 'All' }, ...(app.me?.auth ? [{ v: 'mine', label: 'Mine' }] : []), { v: 'quick', label: 'Instant' }, { v: 'director', label: 'Directed' }, { v: 'deck', label: 'Decks' }, { v: 'production', label: 'Productions' }], filter, v => { filter = v; paint(); }, { label: 'Filter' })),
    grid));
  paint();
}

function tile(f) {
  const style = app.gallery.styles.find(s => s.slug === (f.style || app.gallery.templates.find(t => t.id === f.template)?.librarySlug));
  const src = f.output && f.mode !== 'deck' && f.mode !== 'production' ? `/films/${f.id}/${f.output}` : null;
  const frame = h('div', { class: 'frame' });
  if (f.poster) frame.append(h('img', { src: `/films/${f.id}/${f.poster}`, alt: '' }));
  else if (src) frame.append(h('video', { src: src + '#t=2', muted: true, preload: 'metadata', playsinline: true }));
  else if (f.mode === 'deck') frame.append(h('div', { class: 'ph' }, icon('slides', 20), 'Deck · not exported yet'));
  else if (f.mode === 'production') frame.append(f.cover ? h('img', { src: `/films/${f.id}/${f.cover}`, alt: '' }) : h('div', { class: 'ph' }, icon('clapper', 20), 'Production · concepts'));
  else frame.append(style?.frame ? h('img', { src: style.frame, alt: '', style: { opacity: .28, filter: 'grayscale(.5)' } }) : null,
    h('div', { class: 'ph' }, icon(f.status === 'running' ? 'sparkles' : 'pencil', 20), f.status === 'running' ? (f.step || 'In production') : 'Draft · not exported'));
  const stopped = ['failed', 'interrupted', 'cancelled'].includes(f.status);
  frame.append(h('span', { class: 'badge ' + (f.status === 'running' ? 'live' : f.status || '') }, f.status === 'running' ? 'Live' : stopped ? f.status[0].toUpperCase() + f.status.slice(1) : f.mode === 'deck' ? 'Deck' : f.mode === 'production' ? 'Storyboard' : f.mode === 'director' ? 'Directed' : f.output ? 'Instant' : 'Draft'));
  let vid = null;
  const el = h('button', { class: 'lcard', onclick: () => go((f.mode === 'director' ? 'studio/' : f.mode === 'deck' ? 'decks/' : f.mode === 'production' ? 'productions/' : 'create/') + f.id) }, frame,
    h('b', {}, f.filmTitle || f.title || 'Untitled'),
    h('small', {}, [f.mode === 'director' ? style?.name : app.gallery.templates.find(t => t.id === f.template)?.name, f.aspect, f.ownerName && app.me?.auth ? (f.owner === app.me.email ? 'you' : f.ownerName.split(' ')[0]) : null, timeAgo(f.created), f.seconds ? `made in ${Math.round(f.seconds / 60) || '<1'} min` : null].filter(Boolean).join(' · ')));
  if (src) {
    el.addEventListener('mouseenter', () => {
      if (vid) return;
      vid = h('video', { src, muted: true, loop: true, playsinline: true, autoplay: true });
      vid.muted = true;
      vid.style.opacity = 0;
      vid.style.transition = 'opacity .4s';
      vid.addEventListener('playing', () => { vid.style.opacity = 1; });
      frame.append(vid);
    });
    el.addEventListener('mouseleave', () => { vid?.remove(); vid = null; });
  }
  return el;
}
