// Workspaces: for the studio's operators (lib/workspaces.mjs). Each customer works in a workspace of its own; here an
// operator creates one, names its first admin, sets the Google Workspace domains whose people join it, its monthly
// spending limit and whether Director is on, and sees each one's members, spending and disk. The whole backup and the
// server's disk are here too.
import { h, api, icon, toast, timeAgo } from './core.js';
import { size } from './remove.js';

let root;
export function mountWorkspaces(el) { root = el; }
const usd = n => '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const list = s => String(s || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean);

export async function showWorkspaces() {
  const r = await api('workspaces');
  if (!r.operator) {
    root.replaceChildren(h('div', { class: 'team' }, h('h1', { class: 'title-xl' }, 'Workspaces'), h('p', { class: 'sub' }, 'Only the studio’s operators manage workspaces.')));
    return;
  }
  let open = null;
  const paint = all => root.replaceChildren(h('div', { class: 'team' },
    h('div', { class: 'g-top' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Operators'), h('h1', { class: 'title-xl' }, 'Workspaces'),
      h('p', { class: 'sub' }, 'Each customer works in its own workspace: its people, brand kits, proof, productions, reviews, spending and audit trail are seen and changed only there.'))),
    h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, 'All workspaces'), h('small', { class: 'faint' }, `${all.length}`)),
      all.map(w => [
        h('div', { class: 'ws-row' },
          h('div', {}, h('b', {}, w.name), h('small', { class: 'faint' }, [w.id, w.director ? 'Director on' : null].filter(Boolean).join(' · '))),
          h('small', { class: 'faint' }, w.domains.length ? w.domains.map(d => '@' + d).join(', ') : 'Added people only'),
          h('small', {}, `${w.members} ${w.members === 1 ? 'person' : 'people'}`),
          h('small', { class: w.limit != null && w.spent > w.limit ? 'err' : '' }, usd(w.spent) + (w.limit != null ? ` of ${usd(w.limit)}` : ''), h('small', { class: 'faint' }, 'this month')),
          h('small', { class: 'faint' }, size(w.bytes)),
          h('button', { class: 'btn ghost round', title: 'Change', 'aria-label': 'Change ' + w.name, onclick: () => { open = open === w.id ? null : w.id; paint(all); } }, icon('pencil', 14))),
        open === w.id ? form(w, async b => paint((await api('workspaces/' + w.id, { method: 'PUT', body: b })).all)) : null]),
      h('small', { class: 'faint' }, 'Operators aren’t in a customer’s workspace unless they are added to it, and adding them shows in that workspace’s audit trail.')),
    h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, 'New workspace')), form(null, async b => { const x = await api('workspaces', { method: 'POST', body: b }); toast(`${x.workspace.name} is ready.`, 'ok'); paint(x.all); })),
    serverCard()));
  paint(r.all);
}

// a workspace's settings; for a new one also its id. Admins named here are added to it with the Admin role.
function form(w, save) {
  const name = h('input', { value: w?.name || '', placeholder: 'Customer name' });
  const id = h('input', { placeholder: 'acme (optional: from the name)' });
  const domains = h('input', { value: (w?.domains || []).join(', '), placeholder: 'acme.com' });
  const limit = h('input', { type: 'number', min: 0, step: 50, value: w?.limit ?? '', placeholder: 'No limit' });
  const admins = h('input', { type: 'email', placeholder: 'admin@acme.com' });
  const director = h('input', { type: 'checkbox', checked: !!w?.director });
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'faint' }, hint) : null);
  return h('div', { class: 'ws-edit' },
    h('div', { class: 'row2' }, field('Name', name), w ? field('Monthly limit ($)', limit, 'The workspace’s own budget owner can’t raise it.') : field('Id', id, 'Lower-case letters, digits and dashes. It can’t change later.')),
    h('div', { class: 'row2' }, field('Google Workspace domains', domains, 'Anyone signing in with an account on these joins as a Creator. Leave empty to add people one by one.'),
      w ? field('Add an admin', admins, 'Their email; they give everyone else their roles.') : field('Monthly limit ($)', limit, 'The workspace’s own budget owner can’t raise it.')),
    w ? null : field('First admin', admins, 'Their email; they give everyone else their roles.'),
    h('label', { class: 'chip on-toggle' }, director, 'Director mode', h('small', { class: 'faint' }, ' runs an agent with access to the server’s disk: only for workspaces you trust with every other one’s files')),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: async ev => {
      ev.target.disabled = true;
      try { await save({ name: name.value, ...(w ? {} : { id: id.value }), domains: list(domains.value), limit: limit.value, director: director.checked, admins: list(admins.value) }); if (w) toast('Saved.', 'ok'); }
      catch (e) { toast(e.message, 'error'); ev.target.disabled = false; }
    } }, w ? 'Save' : [icon('plus', 14), 'Create'])));
}

// the whole Cloud Storage backup and the server's disk
function serverCard() {
  const card = h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, 'Server and backup')), h('small', { class: 'faint' }, 'Loading…'));
  const gb = n => n < 1e9 ? Math.round(n / 1e6) + ' MB' : (n / 1e9).toFixed(1) + ' GB';
  const paint = s => {
    const d = s.disk, used = d ? 1 - d.free / d.total : null, last = s.lastSync;
    card.replaceChildren(
      h('div', { class: 'section-head' }, h('b', {}, 'Server and backup'), h('span', { class: 'badge ' + (!s.on ? 'failed' : last?.errorCount ? 'warn' : last ? 'done' : '') }, !s.on ? 'Not backed up' : s.syncing ? 'Backing up…' : last?.errorCount ? `${last.errorCount} problem${last.errorCount > 1 ? 's' : ''}` : last ? 'Backed up' : 'First backup soon')),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, s.on ? s.files.toLocaleString() : '—'), h('span', {}, 'files in Cloud Storage')),
        h('div', { class: 'stat' }, h('b', {}, s.on ? gb(s.bytes) : '—'), h('span', {}, 'stored')),
        h('div', { class: 'stat' }, h('b', {}, last ? timeAgo(last.at) : '—'), h('span', {}, s.on ? `last backup · every ${s.everyMinutes} min` : 'last backup')),
        h('div', { class: 'stat' + (used > 0.85 ? ' over' : '') }, h('b', {}, d ? Math.round(used * 100) + '%' : '—'), h('span', {}, d ? `of ${gb(d.total)} disk used` : 'disk'))),
      s.on ? h('small', { class: 'faint' }, `Every workspace is copied to the private bucket gs://${s.bucket}/${s.prefix}workspaces/<id>/, and the studio’s own list of workspaces and audit trail to ${s.prefix}platform/; deleted and changed files are kept for 30 days.`)
        : h('small', { class: 'faint' }, 'Set MEDIA_BUCKET on the server to back everything up to Cloud Storage.'),
      ...(last?.errors || []).slice(0, 3).map(e => h('small', { class: 'err' }, e)),
      s.on ? h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: async ev => {
        ev.target.disabled = true;
        try { paint(await api('storage/sync', { method: 'POST' })); toast('Backed up.', 'ok'); } catch (e) { toast(e.message, 'error'); ev.target.disabled = false; }
      } }, 'Back up now')) : '');
  };
  api('storage/server').then(paint).catch(() => card.remove());
  return card;
}
