// Deleting a film, deck or production to free the server's disk: what would go and what stays, then a confirmation.
// The server decides who may and when (lib/removal.mjs); this only asks.
import { h, api, icon, toast, sheet, app, hasRole } from './core.js';

export const size = n => n < 1e9 ? Math.max(1, Math.round(n / 1e6)) + ' MB' : (n / 1e9).toFixed(1) + ' GB';
// the person who made it (while they hold the Creator role), or an admin
export const mayDelete = f => !!app.me && !app.me.guest && (hasRole('admin') || (hasRole('creator') && !!f.owner && f.owner === app.me.email));

const WHAT = {
  production: 'the production: its storyboard frames, cast portraits, voices, video takes and sound',
  deck: 'the deck and its exported files',
  film: 'the film, its exported video and everything used to make it',
};

export async function confirmDelete(id, { onDone } = {}) {
  let p;
  try { p = await api(`films/${id}/delete`); } catch (e) { return toast(e.message, 'error'); }
  sheet(close => {
    const go_ = h('button', { class: 'btn danger-fill', onclick: async () => {
      go_.disabled = true;
      go_.lastChild.textContent = 'Deleting…';
      try { const r = await api('films/' + id, { method: 'DELETE' }); close(); toast(`Deleted. ${size(r.bytes)} freed on the server.`, 'ok'); onDone?.(r); }
      catch (e) { toast(e.message, 'error'); go_.disabled = false; go_.lastChild.textContent = 'Delete'; }
    } }, icon('trash', 14), h('span', {}, 'Delete'));
    const cancel = h('button', { class: 'btn ghost', autofocus: true, onclick: close }, p.blocked ? 'Close' : 'Cancel');
    return h('div', { class: 'sheet-body del-sheet' },
      h('div', { class: 'eyebrow' }, 'Delete'),
      h('h2', { class: 'title-l' }, `Delete “${p.title}”?`),
      p.blocked ? h('p', { class: 'callout' }, icon('info', 16), h('span', {}, p.blocked.error)) : [
        h('p', {}, `This deletes ${WHAT[p.kind]}${p.also.length ? ', and what was made from it' : ''}. It frees ${size(p.bytes)} on the server.`),
        p.also.length ? h('div', {}, h('b', {}, 'Also deleted'), h('ul', {}, p.also.map(f => h('li', {}, `“${f.title}” · ${size(f.bytes)}`)))) : null,
        p.kept.length ? h('div', {}, h('b', {}, 'Kept in the Library'), h('ul', {}, p.kept.map(f => h('li', {}, `“${f.title}”: ${f.why}`)))) : null,
        h('p', { class: 'faint' }, p.backup ? 'The backup keeps a copy for 30 days, so an admin can bring it back until then. ' : 'This can’t be undone. ',
          'Reviews, sign-offs, spending records and the audit trail stay as they are.'),
      ],
      h('div', { class: 'actions' }, h('span', { class: 'spacer' }), cancel, p.blocked ? null : go_));
  });
}
