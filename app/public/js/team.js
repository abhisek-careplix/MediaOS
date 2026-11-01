// Team: who may do what (lib/team.mjs). Anyone at CarePlix who signs in can make things; sign-offs and caps need the
// roles below, which an admin gives here.
import { h, api, icon, toast, app } from './core.js';

let root;
export function mountTeam(el) { root = el; }

export async function showTeam() {
  const t = await api('team'), admin = t.me.roles.includes('admin');
  const order = Object.keys(t.roles);
  const chips = (roles, onToggle) => h('div', { class: 'tm-roles' }, order.map(r => h('button', { type: 'button', class: 'chip' + (roles.includes(r) ? ' on' : ''), disabled: !onToggle, title: t.roles[r].hint, onclick: onToggle ? () => onToggle(r) : null }, t.roles[r].name)));
  const save = async (email, name, roles) => {
    try { await api('team/' + encodeURIComponent(email), { method: 'PUT', body: { name, roles } }); toast('Saved.', 'ok'); showTeam(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const row = p => h('div', { class: 'tm-row' },
    h('span', { class: 'avatar' }, String(p.name || p.email).split(/[\s@.]+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()),
    h('div', { class: 'tm-who' }, h('b', {}, p.name || p.email.split('@')[0]), h('small', { class: 'faint' }, p.email, p.fromSettings ? ' · admin in the server settings' : '')),
    chips(p.roles, admin ? r => save(p.email, p.name, p.roles.includes(r) ? p.roles.filter(x => x !== r) : [...p.roles, r]) : null),
    admin && !p.fromSettings ? h('button', { class: 'btn ghost round', title: 'Remove', 'aria-label': 'Remove ' + p.email, onclick: async () => {
      if (!confirm(`Remove ${p.email}? They keep the Creator role, like anyone who signs in.`)) return;
      try { await api('team/' + encodeURIComponent(p.email), { method: 'DELETE' }); showTeam(); } catch (e) { toast(e.message, 'error'); }
    } }, icon('x', 14)) : h('span'));

  let fresh = ['creator'];
  const email = h('input', { placeholder: 'name@careplix.com', type: 'email' }), name = h('input', { placeholder: 'Full name' });
  const freshChips = h('div');
  const paintFresh = () => freshChips.replaceChildren(chips(fresh, r => { fresh = fresh.includes(r) ? fresh.filter(x => x !== r) : [...fresh, r]; paintFresh(); }));
  paintFresh();

  root.replaceChildren(h('div', { class: 'team' },
    h('div', { class: 'g-top' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Team'), h('h1', { class: 'title-xl' }, 'Who signs what.'),
      h('p', { class: 'sub' }, 'Anyone at CarePlix who signs in is a Creator. Sign-offs, proof approval and spending caps need the roles below.'))),
    !t.adminConfigured && !t.local ? h('div', { class: 'callout' }, icon('info', 18), h('div', {}, 'No admin yet. Set ADMIN_EMAILS on the server to name the first admin, who can then give roles here.')) : null,
    h('div', { class: 'tm-legend' }, order.map(r => h('div', { class: 'tm-role' }, h('b', {}, t.roles[r].name), h('small', { class: 'faint' }, t.roles[r].hint)))),
    h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, 'People'), h('small', { class: 'faint' }, `${t.people.length} with roles`)),
      t.people.length ? t.people.map(row) : h('small', { class: 'faint' }, t.local ? 'Running locally: you hold every role.' : 'Nobody has been given a role yet.'),
      admin ? h('div', { class: 'tm-add' }, h('b', {}, 'Add someone'), h('div', { class: 'row2' }, email, name), freshChips,
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => save(email.value, name.value, fresh) }, icon('plus', 14), 'Add'))) : null),
    h('p', { class: 'faint' }, 'Your roles: ', t.me.roles.map(r => t.roles[r]?.name).join(', ') || 'none (view only)')));
}
