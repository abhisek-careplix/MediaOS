// Boot: load config and the style gallery, wire the sidebar, route between views.
import { $, $$, h, api, icon, toast, app, on, parseRoute, emit, pillSelect } from './core.js';
import { mountCreate, showCreate } from './create.js';
import { mountStudio, showStudio } from './studio.js';
import { mountGallery, showGallery } from './gallery.js';
import { mountLibrary, showLibrary } from './library.js';
import { mountBrands, showBrands, loadBrands } from './brands.js';
import { mountProof, showProof } from './proof.js';
import { mountDecks, showDecks } from './decks.js';
import { mountProductions, showProductions } from './productions.js';
import { mountReview, showReview, reviewCount } from './review.js';
import { mountSpend, showSpend } from './spend.js';
import { mountTeam, showTeam } from './team.js';
import { mountWorkspaces, showWorkspaces } from './workspaces.js';

const VIEWS = { create: showCreate, productions: showProductions, studio: showStudio, gallery: showGallery, library: showLibrary, brands: showBrands, proof: showProof, decks: showDecks, review: showReview, spend: showSpend, team: showTeam, workspaces: showWorkspaces };

async function boot() {
  $$('[data-icon]').forEach(s => s.replaceWith(icon(s.dataset.icon, 18)));
  // who and which workspace first: every later request says which workspace this page shows
  app.me = await api('me');
  [app.cfg, app.gallery] = await Promise.all([api('config'), fetch('/gallery/styles.json').then(r => r.json()), loadBrands().catch(() => { app.brands = []; })]);
  $('.sidebar').append(workspacePick(app.me));
  if (app.me.auth) $('.sidebar').append(userChip(app.me));
  $('#nav-workspaces').hidden = !app.me.operator;
  const c = app.cfg;
  $('#setup').replaceChildren(
    row(c.claude.installed, c.claude.installed ? 'AI writer ready' : 'AI writer missing'),
    row(c.libReady, c.libReady ? 'Style library ready' : 'Library missing'),
    row(c.voiceReady, c.voiceReady ? 'Offline voice ready' : 'No voice model'));
  mountCreate($('#view-create'));
  mountStudio($('#view-studio'));
  mountGallery($('#view-gallery'));
  mountLibrary($('#view-library'));
  mountBrands($('#view-brands'));
  mountProof($('#view-proof'));
  mountDecks($('#view-decks'));
  mountProductions($('#view-productions'));
  mountReview($('#view-review'));
  mountSpend($('#view-spend'));
  mountTeam($('#view-team'));
  mountWorkspaces($('#view-workspaces'));
  window.addEventListener('hashchange', () => emit('route', parseRoute()));
  on('route', route);
  route(parseRoute());
  pollLive();
  setInterval(pollLive, 20000);
}
const row = (ok, text) => h('div', { class: 'row' }, h('i', { class: ok ? '' : 'bad' }), text);
// the workspace this page works in; someone in several picks another here, and the page starts again in it
function workspacePick(me) {
  const label = h('small', { class: 'faint' }, 'Workspace');
  if (me.workspaces.length < 2) return h('div', { class: 'ws-pick' }, label, h('b', {}, me.workspace.name));
  return h('div', { class: 'ws-pick' }, label, pillSelect(me.workspaces.map(w => [w.id, w.name]), me.workspace.id, async id => {
    try { await api('workspaces/switch', { method: 'POST', body: { id } }); location.hash = ''; location.reload(); } catch (e) { toast(e.message, 'error'); }
  }, 'Workspace'));
}
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
  // how many versions are waiting for this person's sign-off
  try { const n = await reviewCount(); $('#nav-review').hidden = !n; $('#nav-review').textContent = n; } catch {}
}

boot().catch(e => toast('Could not start the studio: ' + e.message, 'error', 15000));
