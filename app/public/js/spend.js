// Spend: what the studio's paid generation cost this month (lib/ledger.mjs), by product, person and kind, and the
// monthly caps a budget owner sets. New paid work is refused once a cap would be passed. Work the studio gave up waiting
// for shows as estimated until the service says whether it charged for it.
import { h, api, icon, toast, app, go, timeAgo } from './core.js';

let root;
const usd = n => '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthName = m => new Date(m + '-15').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const brandName = id => id ? app.brands?.find(b => b.id === id)?.name || id : 'No product';
const assetRoute = a => !a ? null : a.startsWith('p-') ? 'productions/' + a : a.startsWith('k-') ? 'decks/' + a : a.startsWith('d-') ? 'studio/' + a : a.startsWith('q-') ? 'create/' + a : null;

export function mountSpend(el) { root = el; }

export async function showSpend(args = []) {
  const s = await api('spend' + (args[0] ? '?month=' + args[0] : ''));
  const months = [...new Set([s.current, ...s.months])].sort().reverse(), i = months.indexOf(s.month);
  const caps = s.caps, mine = s.byPerson.find(p => p.key === s.me)?.amount || 0;
  const left = caps.total != null ? caps.total - s.total : null;

  const bars = (title, rows, label) => {
    const max = Math.max(...rows.map(r => r.amount), 0.01);
    return h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, title)),
      rows.length ? rows.map(r => h('div', { class: 'sp-bar' },
        h('span', { class: 'sp-label' }, label(r)), h('span', { class: 'sp-track' }, h('i', { style: { width: (100 * r.amount / max).toFixed(1) + '%' } })),
        h('b', {}, usd(r.amount)), h('small', { class: 'faint' }, `${r.count}×`))) : h('small', { class: 'faint' }, 'Nothing yet.'));
  };

  root.replaceChildren(h('div', { class: 'spend' },
    h('div', { class: 'g-top' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Spend · ' + monthName(s.month)), h('h1', { class: 'title-xl' }, usd(s.total) + (caps.total != null ? ` of ${usd(caps.total)}` : '')),
        h('p', { class: 'sub' }, 'Every paid generation, by product, person and kind. Writing costs are estimates; frames and video use the providers’ list prices.')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn round', disabled: i >= months.length - 1, 'aria-label': 'Earlier month', onclick: () => go('spend/' + months[i + 1]) }, icon('chevronL', 15)),
        h('button', { class: 'btn round', disabled: i <= 0, 'aria-label': 'Later month', onclick: () => go('spend/' + months[i - 1]) }, icon('chevronR', 15)))),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, usd(s.total)), h('span', {}, `spent · ${s.count} generations`)),
      h('div', { class: 'stat' }, h('b', {}, caps.total != null ? usd(caps.total) : 'None'), h('span', {}, 'studio cap')),
      h('div', { class: 'stat' + (left != null && left < 0 ? ' over' : '') }, h('b', {}, left != null ? usd(Math.max(0, left)) : '—'), h('span', {}, 'left this month')),
      h('div', { class: 'stat' }, h('b', {}, usd(mine)), h('span', {}, caps.person != null ? `yours, of ${usd(caps.person)}` : 'yours'))),
    s.estimated > 0 ? h('p', { class: 'faint' }, `${usd(s.estimated)} of this is estimated: the studio gave up waiting for ${s.estimates === 1 ? 'one piece of work' : `${s.estimates} pieces of work`}, and the service may still charge for ${s.estimates === 1 ? 'it' : 'them'}. Estimates count toward the caps. Each is checked every few minutes for a day: it stays once the service confirms the charge, and drops off if there was none.`) : null,
    h('div', { class: 'sp-grid' },
      bars('By product', s.byBrand, r => brandName(r.key)),
      bars('By person', s.byPerson, r => r.label || r.key || 'System'),
      bars('By kind', s.byKind, r => r.label)),
    s.canEdit ? capsForm(caps) : h('p', { class: 'faint' }, caps.total == null && caps.person == null ? 'No caps are set. A budget owner can set them here.' : 'A budget owner sets the caps.'),
    h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, 'Recent'), h('small', { class: 'faint' }, s.entries.length === 300 ? 'latest 300' : '')),
      s.entries.length ? h('table', { class: 'sp-table' },
        h('tr', {}, ['When', 'Who', 'Product', 'Kind', 'For', 'Cost'].map(t => h('th', {}, t))),
        s.entries.map(e => h('tr', {},
          h('td', {}, timeAgo(e.at)), h('td', {}, e.name || e.who), h('td', {}, brandName(e.brandId)), h('td', {}, [s.kinds[e.kind] || e.kind, e.engine].filter(Boolean).join(' · ')),
          h('td', {}, assetRoute(e.asset) ? h('a', { href: '#' + assetRoute(e.asset) }, e.asset) : e.asset || ''), h('td', { class: 'num' }, e.estimated ? [h('span', { class: 'badge warn', title: 'The studio gave up waiting for this; the service may still charge for it' }, 'estimated'), ' '] : null, usd(e.amount))))) : h('small', { class: 'faint' }, 'Nothing spent this month.'))));
}

function capsForm(caps) {
  const field = (label, value, hint) => { const i = h('input', { type: 'number', min: 0, step: 10, placeholder: 'No cap', value: value ?? '' }); return [h('label', { class: 'field' }, h('span', {}, label), i, hint ? h('small', { class: 'faint' }, hint) : null), i]; };
  const [totalF, total] = field('Studio, per month ($)', caps.total, 'All products and people together.');
  const [personF, person] = field('Each person, per month ($)', caps.person);
  const brands = (app.brands || []).map(b => [b, field(b.name, caps.brands?.[b.id])]);
  return h('div', { class: 'sp-card' }, h('div', { class: 'section-head' }, h('b', {}, 'Monthly caps'), h('small', { class: 'faint' }, 'Leave empty for no cap')),
    h('div', { class: 'sp-caps' }, totalF, personF, ...brands.map(([, [f]]) => f)),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: async () => {
      try {
        await api('spend/caps', { method: 'PUT', body: { total: total.value, person: person.value, brands: Object.fromEntries(brands.map(([b, [, i]]) => [b.id, i.value])) } });
        toast('Caps saved.', 'ok');
        showSpend();
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Save caps')));
}
