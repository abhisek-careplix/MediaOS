// Boot: load config and the style gallery, wire the sidebar, route between views.
import { $, $$, h, api, icon, toast, app, on, parseRoute, emit } from './core.js';
import { mountCreate, showCreate } from './create.js';
import { mountStudio, showStudio } from './studio.js';
import { mountGallery, showGallery } from './gallery.js';
import { mountLibrary, showLibrary } from './library.js';
import { mountBrands, showBrands, loadBrands } from './brands.js';
import { mountProof, showProof } from './proof.js';
import { mountDecks, showDecks } from './decks.js';

const VIEWS = { create: showCreate, studio: showStudio, gallery: showGallery, library: showLibrary, brands: showBrands, proof: showProof, decks: showDecks };

async function boot() {
  $$('[data-icon]').forEach(s => s.replaceWith(icon(s.dataset.icon, 18)));
  [app.cfg, app.gallery, , app.me] = await Promise.all([api('config'), fetch('/gallery/styles.json').then(r => r.json()), loadBrands().catch(() => { app.brands = []; }), api('me')]);
  if (app.me.auth) $('.sidebar').append(userChip(app.me));
  const c = app.cfg;
  $('#setup').replaceChildren(
    row(c.claude.installed, c.claude.installed ? 'Claude Code ' + c.claude.version.split(' ')[0] : 'Claude Code missing'),
    row(c.libReady, c.libReady ? 'Style library ready' : 'Library missing'),
    row(c.voiceReady, c.voiceReady ? 'Offline voice ready' : 'No voice model'));
  mountCreate($('#view-create'));
  mountStudio($('#view-studio'));
  mountGallery($('#view-gallery'));
  mountLibrary($('#view-library'));
  mountBrands($('#view-brands'));
  mountProof($('#view-proof'));
  mountDecks($('#view-decks'));
  window.addEventListener('hashchange', () => emit('route', parseRoute()));
  on('route', route);
  route(parseRoute());
  pollLive();
  setInterval(pollLive, 20000);
}
const row = (ok, text) => h('div', { class: 'row' }, h('i', { class: ok ? '' : 'bad' }), text);
function userChip(me) {
  const initials = (me.name || me.email).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return h('div', { class: 'me' },
    me.picture ? h('img', { src: me.picture, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }, initials),
    h('div', { class: 'me-text' }, h('b', {}, me.name), h('small', {}, me.email)),
    h('a', { class: 'btn ghost round', href: '/auth/logout', title: 'Sign out', 'aria-label': 'Sign out' }, icon('export', 15)));
}

async function route({ view, args }) {
  if (!VIEWS[view]) view = 'create';
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
  $$('video').forEach(v => { if (v.closest('.view')?.hidden) v.pause(); });
  try { await VIEWS[view](args); } catch (e) { toast(e.message, 'error'); }
  $('.content').scrollTop = 0;
}

async function pollLive() {
  try { $('#nav-live').hidden = !(await api('films')).some(f => f.mode === 'director' && f.status === 'running'); } catch {}
}

boot().catch(e => toast('Could not start the studio: ' + e.message, 'error', 15000));
