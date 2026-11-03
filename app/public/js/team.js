// Team: who may do what in this workspace (lib/team.mjs). People on the workspace's Google Workspace domains who sign in
// can make things, and an admin adds anyone else by email; sign-offs and caps need the roles below, which an admin gives
// here.
import { h, api, icon, toast, app, timeAgo } from './core.js';
import { size, confirmDelete } from './remove.js';

let root;
export function mountTeam(el) { root = el; }

export async function showTeam() {
  const t = await api('team'), admin = t.me.roles.includes('admin'), ws = t.workspace;
  const domainOf = email => email.split('@')[1] || '';
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
      if (!confirm(`Remove ${p.email} from ${ws.name}? They lose access to this workspace${ws.domains.includes(domainOf(p.email)) ? `, even though they are at @${domainOf(p.email)}` : ''}.`)) return;
      try { await api('team/' + encodeURIComponent(p.email), { method: 'DELETE' }); showTeam(); } catch (e) { toast(e.message, 'error'); }
    } }, icon('x', 14)) : h('span'));

  let fresh = ['creator'];
  const email = h('input', { placeholder: ws.domains[0] ? 'name@' + ws.domains[0] : 'name@company.com', type: 'email' }), name = h('input', { placeholder: 'Full name' });
  const freshChips = h('div');
  const paintFresh = () => freshChips.replaceChildren(chips(fresh, r => { fresh = fresh.includes(r) ? fresh.filter(x => x !== r) : [...fresh, r]; paintFresh(); }));
  paintFresh();

  root.replaceChildren(h('div', { class: 'team' },
    h('div', { class: 'g-top' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Team · ' + ws.name), h('h1', { class: 'title-xl' }, 'Who signs what.'),
      h('p', { class: 'sub' }, (ws.domains.length ? `Anyone who signs in with a Google account at ${ws.domains.map(d => '@' + d).join(' or ')} is a Creator here. ` : 'Only the people added here can sign in to this workspace. ')
        + 'Sign-offs, proof approval and spending caps need the roles below.'))),
    !t.adminConfigured && !t.local ? h('div', { class: 'callout' }, icon('info', 18), h('div', {}, 'No admin yet. Set ADMIN_EMAILS on the server to name the first admin, who can then give roles here.')) : null,
    h('div', { class: 'tm-legend' }, order.map(r => h('div', { class: 'tm-role' }, h('b', {}, t.roles[r].name), h('small', { class: 'faint' }, t.roles[r].hint)))),
    h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, 'People'), h('small', { class: 'faint' }, `${t.people.length} added`)),
      t.people.length ? t.people.map(row) : h('small', { class: 'faint' }, t.local ? 'Running locally: you hold every role.' : 'Nobody has been given a role yet.'),
      admin ? h('div', { class: 'tm-add' }, h('b', {}, 'Add someone'), h('small', { class: 'faint' }, 'Any Google account with this address can then sign in. The studio sends no email: share the link with them.'), h('div', { class: 'row2' }, email, name), freshChips,
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => save(email.value, name.value, fresh) }, icon('plus', 14), 'Add'))) : null),
    admin ? storageCard() : null,
    admin ? usageCard() : null,
    h('p', { class: 'faint' }, 'Your roles: ', t.me.roles.map(r => t.roles[r]?.name).join(', ') || 'none (view only)')));
}

// admins: this workspace's part of the Cloud Storage backup (the whole backup and the server are on the Workspaces page)
function storageCard() {
  const card = h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, 'Backup')), h('small', { class: 'faint' }, 'Loading…'));
  const gb = n => n < 1e9 ? Math.round(n / 1e6) + ' MB' : (n / 1e9).toFixed(1) + ' GB';
  const paint = s => {
    const last = s.lastSync;
    card.replaceChildren(
      h('div', { class: 'section-head' }, h('b', {}, 'Backup'), h('span', { class: 'badge ' + (!s.on ? 'failed' : last?.errorCount ? 'warn' : last ? 'done' : '') }, !s.on ? 'Not backed up' : s.syncing ? 'Backing up…' : last?.errorCount ? `${last.errorCount} problem${last.errorCount > 1 ? 's' : ''}` : last ? 'Backed up' : 'First backup soon')),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, s.on ? s.files.toLocaleString() : '—'), h('span', {}, 'files backed up')),
        h('div', { class: 'stat' }, h('b', {}, s.on ? gb(s.bytes) : '—'), h('span', {}, 'stored')),
        h('div', { class: 'stat' }, h('b', {}, last ? timeAgo(last.at) : '—'), h('span', {}, s.on ? `last backup · every ${s.everyMinutes} min` : 'last backup'))),
      h('small', { class: 'faint' }, s.on ? 'This workspace’s films, brand kits, proof, uploads, reviews and audit trail are copied to a private Cloud Storage bucket, keeping deleted and changed files for 30 days.'
        : 'This server isn’t backed up to Cloud Storage. The studio’s operators can set it up.'),
      ...(last?.errors || []).slice(0, 3).map(e => h('small', { class: 'err' }, e)));
  };
  api('storage').then(paint).catch(() => card.remove());
  return card;
}

// admins: what takes the disk, largest first, each with a delete (a production counts what was made from it)
function usageCard() {
  const card = h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, 'Disk use')), h('small', { class: 'faint' }, 'Loading…'));
  const KIND = { production: 'Production', film: 'Film', deck: 'Deck' };
  let all = false;
  const paint = u => {
    const top = u.items[0]?.bytes || 1, list = all ? u.items : u.items.slice(0, 10);
    card.replaceChildren(
      h('div', { class: 'section-head' }, h('b', {}, 'Disk use'), h('small', { class: 'faint' }, `${size(u.bytes)} in ${u.items.length} productions, films and decks`)),
      ...list.map(x => h('div', { class: 'du-row' },
        h('div', { class: 'tm-who' }, h('a', { href: '#' + ({ production: 'productions/', deck: 'decks/', director: 'studio/' }[x.mode] || 'create/') + x.id }, x.title),
          h('small', { class: 'faint' }, [KIND[x.kind], x.made ? `with ${x.made} animatic${x.made > 1 ? 's' : ''} or cut${x.made > 1 ? 's' : ''}` : null, x.ownerName || x.owner, x.created ? timeAgo(x.created) : null].filter(Boolean).join(' · '))),
        h('div', { class: 'du-bar', 'aria-hidden': 'true' }, h('i', { style: { width: Math.max(1, Math.round(100 * x.bytes / top)) + '%' } })),
        h('span', { class: 'du-size' }, size(x.bytes)),
        h('button', { class: 'btn ghost round danger', title: 'Delete', 'aria-label': 'Delete ' + x.title, onclick: () => confirmDelete(x.id, { onDone: load }) }, icon('trash', 14)))),
      u.items.length > 10 ? h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { all = !all; paint(u); } }, all ? 'Show the largest 10' : `Show all ${u.items.length}`)) : '',
      h('small', { class: 'faint' }, 'Deleting frees the space at once. Anything in review or with sign-offs stays.'));
  };
  const load = () => api('storage/usage').then(paint).catch(() => card.remove());
  load();
  return card;
}
