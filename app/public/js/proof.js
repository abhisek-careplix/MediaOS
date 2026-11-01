// Proof Library: approved facts with sources. The only numbers and claims Claude may put in an asset.
import { $$, h, api, icon, toast, sheet, app, segmented, hasRole } from './core.js';

const SOURCE_TYPES = [['study', 'Published study'], ['internal', 'Internal data'], ['customer', 'Customer'], ['regulatory', 'Regulatory'], ['web', 'Web page']];
const STATE_LABEL = { approved: 'Approved', draft: 'Draft', expired: 'Expired', retired: 'Retired' };
let root, list = [], filter = 'all', query = '';

export function mountProof(el) { root = el; }
export async function loadProof() {
  list = await api('proof');
  app.proof = list;
  return list;
}

export async function showProof() {
  await loadProof();
  render();
}

function render() {
  const n = s => list.filter(e => e.state === s).length;
  const grid = h('div', { class: 'proof-list' });
  const paint = () => {
    const q = query.toLowerCase();
    const rows = list.filter(e => (filter === 'all' || e.state === filter) && (!q || [e.claim, e.value, e.metric, e.source?.title, ...(e.tags || [])].join(' ').toLowerCase().includes(q)));
    grid.replaceChildren(...rows.map(row));
    if (!rows.length) grid.append(h('div', { class: 'empty-state' }, icon('shield', 30), list.length ? 'Nothing matches.' : 'No proof yet. Add the facts your team is allowed to say, with where each one comes from.',
      list.length ? null : h('div', { class: 'actions', style: { justifyContent: 'center' } }, h('button', { class: 'btn primary', onclick: () => editor() }, icon('plus', 14), 'Add the first entry'), h('button', { class: 'btn', onclick: importSheet }, 'Import a spreadsheet'))));
  };
  root.replaceChildren(h('div', { class: 'proofs' },
    h('div', { class: 'g-top' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Proof library'), h('h1', { class: 'title-xl' }, 'Every claim, sourced.'),
        h('p', { class: 'sub' }, 'Approved entries are the only numbers and claims the studio may use in decks, films and documents.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: importSheet }, icon('download', 14), 'Import CSV'), h('button', { class: 'btn primary big', onclick: () => editor() }, icon('plus', 16), 'New entry'))),
    h('div', { class: 'stats proof-stats' }, [['approved', 'approved'], ['draft', 'drafts'], ['expired', 'expired'], ['retired', 'retired']].map(([s, l]) => h('div', { class: 'stat' }, h('b', {}, n(s)), h('span', {}, l)))),
    h('div', { class: 'g-top', style: { alignItems: 'center' } },
      segmented([{ v: 'all', label: 'All' }, { v: 'approved', label: 'Approved' }, { v: 'draft', label: 'Drafts' }, { v: 'expired', label: 'Expired' }, { v: 'retired', label: 'Retired' }], filter, v => { filter = v; paint(); }, { label: 'Filter' }),
      h('label', { class: 'search' }, icon('search', 15), h('input', { placeholder: 'Search claims, sources, tags', value: query, oninput: e => { query = e.target.value; paint(); } }))),
    grid));
  paint();
}

function row(e) {
  const src = e.source || {};
  return h('div', { class: 'proof-row ' + e.state },
    h('div', { class: 'pv' }, e.value ? h('b', {}, e.value) : icon(e.kind === 'quote' ? 'doc' : 'shield', 20), e.metric ? h('small', {}, e.metric) : null),
    h('div', { class: 'pc' },
      h('p', {}, e.kind === 'quote' ? `“${e.claim}”` : e.claim),
      h('div', { class: 'psrc' }, h('span', { class: 'badge' }, (SOURCE_TYPES.find(t => t[0] === src.type) || [, 'Source'])[1]),
        src.url ? h('a', { href: src.url, target: '_blank', rel: 'noopener' }, src.title || src.url) : h('span', {}, src.title || 'No source yet'),
        ...(e.tags || []).map(t => h('span', { class: 'tag' }, '#' + t))),
      e.disclaimer ? h('small', { class: 'faint' }, 'Disclaimer: ' + e.disclaimer) : null),
    h('div', { class: 'pm' },
      h('span', { class: 'badge ' + ({ approved: 'done', draft: '', expired: 'failed', retired: '' }[e.state]) }, STATE_LABEL[e.state]),
      h('small', { class: 'faint' }, [e.owner, e.expires ? (e.state === 'expired' ? 'expired ' : 'until ') + e.expires : null].filter(Boolean).join(' · ')),
      h('div', { class: 'actions' },
        e.state === 'draft' && hasRole('reviewer') ? h('button', { class: 'btn', onclick: () => setStatus(e, 'approved') }, icon('check', 13), 'Approve') : null,
        e.kind === 'quote' && e.source?.type === 'customer' ? h('span', { class: 'badge ' + (e.consent ? 'done' : 'failed') }, e.consent ? 'Consent on file' : 'No consent') : null,
        h('button', { class: 'btn ghost', onclick: () => editor(e) }, 'Edit'))));
}

async function setStatus(e, status) {
  try { await api('proof/' + e.id, { method: 'PUT', body: { status } }); await loadProof(); render(); toast(status === 'approved' ? 'Approved: it can now be cited.' : 'Updated.', 'ok'); }
  catch (err) { toast(err.message, 'error'); }
}

function editor(e = null) {
  const d = e ? JSON.parse(JSON.stringify(e)) : { claim: '', value: '', metric: '', kind: 'stat', source: { type: 'study', title: '', url: '', citation: '' }, disclaimer: '', tags: [], owner: app.me?.name && !app.me.guest && !app.me.local ? app.me.name : '', expires: '' };
  sheet(close => {
    const f = (label, el, hint) => h('label', { class: 'field' }, h('span', {}, label), el, hint ? h('small', { class: 'faint' }, hint) : null);
    const inp = (obj, key, attrs = {}) => { const i = h('input', { value: obj[key] || '', ...attrs }); i.addEventListener('input', () => { obj[key] = i.value; }); return i; };
    const claim = h('textarea', { rows: 3, placeholder: 'e.g. The ring detected 92% of apnea events confirmed by polysomnography in a 140-patient study.' }, d.claim);
    claim.addEventListener('input', () => { d.claim = claim.value; });
    const srcType = h('select', {}, SOURCE_TYPES.map(([v, l]) => h('option', { value: v, selected: v === d.source.type }, l)));
    srcType.addEventListener('change', () => { d.source.type = srcType.value; });
    const srcTitle = inp(d.source, 'title', { placeholder: 'Study title, document name, or customer' });
    const srcURL = inp(d.source, 'url', { placeholder: 'https://…' });
    const citation = inp(d.source, 'citation', { placeholder: 'Full citation (optional)' });
    const tags = h('input', { value: (d.tags || []).join(', '), placeholder: 'sleep, accuracy, hospital' });
    tags.addEventListener('input', () => { d.tags = tags.value.split(',').map(t => t.trim()).filter(Boolean); });
    const expires = h('input', { type: 'date', value: d.expires || '' });
    expires.addEventListener('input', () => { d.expires = expires.value; });
    // a customer quote is a testimonial: it needs the person's recorded consent before it can be approved
    d.consent ||= { on: '', by: '', where: '' };
    const consent = h('div', { class: 'field', hidden: d.kind !== 'quote' }, h('span', {}, 'Consent to use this quote'),
      h('div', { class: 'row2' }, (() => { const i = h('input', { type: 'date', value: d.consent.on || '' }); i.addEventListener('input', () => { d.consent.on = i.value; }); return i; })(), inp(d.consent, 'by', { placeholder: 'Who agreed (name)' })),
      inp(d.consent, 'where', { placeholder: 'Where the signed release is kept' }),
      h('small', { class: 'faint' }, 'The date they agreed and where the signed release is kept. Without it, a customer quote can’t be approved or used.'));

    // evidence search
    const pq = h('input', { placeholder: 'Search PubMed, e.g. photoplethysmography sleep apnea wearable' });
    const results = h('div', { class: 'pubmed' });
    const search = async () => {
      if (!pq.value.trim()) return;
      results.replaceChildren(h('span', { class: 'faint' }, 'Searching PubMed…'));
      try {
        const r = await api('proof/pubmed?q=' + encodeURIComponent(pq.value));
        results.replaceChildren(...(r.length ? r.map(p => h('div', { class: 'pm-hit' },
          h('div', {}, h('b', {}, p.title), h('small', { class: 'faint' }, `${p.authors} · ${p.journal} · ${p.year} · PMID ${p.pmid}`)),
          h('div', { class: 'actions' }, h('a', { class: 'btn ghost', href: p.url, target: '_blank', rel: 'noopener' }, 'Open'),
            h('button', { class: 'btn', onclick: () => {
              Object.assign(d.source, { type: 'study', title: p.title, url: p.url, citation: p.citation, pmid: p.pmid });
              srcType.value = 'study'; srcTitle.value = p.title; srcURL.value = p.url; citation.value = p.citation;
              toast('Source attached. Check the claim matches what the paper says.', 'ok');
            } }, 'Use as source')))) : [h('span', { class: 'faint' }, 'No results.')]));
      } catch (err) { results.replaceChildren(h('span', { class: 'err' }, err.message)); }
    };
    pq.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); search(); } });

    const save = async approve => {
      try {
        let saved = e ? await api('proof/' + e.id, { method: 'PUT', body: d }) : await api('proof', { method: 'POST', body: d });
        if (approve && saved.status !== 'approved') saved = await api('proof/' + saved.id, { method: 'PUT', body: { status: 'approved' } });
        await loadProof(); render(); close();
        toast(approve ? 'Saved and approved.' : 'Saved as a draft.', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    };
    return h('div', { class: 'sheet-body' },
      h('div', { class: 'eyebrow' }, e ? 'Edit proof' : 'New proof'),
      h('h2', { class: 'title-l' }, e ? 'Edit the claim' : 'Add a claim your team may make'),
      f('Kind', segmented([{ v: 'stat', label: 'Statistic' }, { v: 'fact', label: 'Fact' }, { v: 'quote', label: 'Customer quote' }], d.kind, v => { d.kind = v; consent.hidden = v !== 'quote'; }, { label: 'Kind' })),
      f('Claim', claim, 'Write it the way it may be said. Approved wording is used exactly as written.'),
      h('div', { class: 'row2' }, f('Value', inp(d, 'value', { placeholder: '92%' })), f('Metric', inp(d, 'metric', { placeholder: 'apnea events detected' }))),
      h('div', { class: 'field' }, h('span', {}, 'Source'), h('div', { class: 'row2' }, h('label', { class: 'pill-select', style: { width: '100%' } }, srcType, icon('chevronD', 12)), srcTitle), srcURL, citation),
      h('div', { class: 'field ev' }, h('span', {}, 'Find evidence'), h('div', { class: 'gen' }, pq, h('button', { class: 'btn', onclick: search }, icon('search', 14), 'PubMed')), results),
      f('Disclaimer', inp(d, 'disclaimer', { placeholder: 'e.g. Not a diagnostic device. Results from a single-site study.' }), 'Shown wherever the claim is used.'),
      h('div', { class: 'row2' }, f('Tags', tags), f('Owner', inp(d, 'owner', { placeholder: 'Who answers for it' }))),
      f('Expires', expires, 'After this date the claim is no longer used.'),
      consent,
      h('div', { class: 'actions' },
        hasRole('reviewer') ? h('button', { class: 'btn primary', onclick: () => save(true) }, icon('check', 14), 'Save and approve') : null,
        h('button', { class: hasRole('reviewer') ? 'btn' : 'btn primary', onclick: () => save(false) }, 'Save as draft'),
        hasRole('reviewer') ? null : h('small', { class: 'faint' }, 'A medical, legal and regulatory reviewer approves it.'),
        h('span', { style: { flex: 1 } }),
        e && e.status !== 'retired' ? h('button', { class: 'btn ghost', onclick: async () => { await setStatus(e, 'retired'); close(); } }, 'Retire') : null,
        e ? h('button', { class: 'btn ghost danger', onclick: async () => { if (!confirm('Delete this entry? Assets that already cite it keep their text.')) return; await api('proof/' + e.id, { method: 'DELETE' }); await loadProof(); render(); close(); } }, 'Delete') : null));
  }, { wide: true });
}

function importSheet() {
  const header = 'claim,value,metric,kind,source_type,source_title,source_url,disclaimer,tags,owner,expires';
  const example = '"The ring detected 92% of apnea events confirmed by polysomnography.",92%,apnea events detected,stat,study,"Validation study title",https://pubmed.ncbi.nlm.nih.gov/00000000/,"Single-site study.",sleep;accuracy,Clinical team,2027-06-30';
  sheet(close => {
    const ta = h('textarea', { rows: 8, placeholder: header });
    const file = h('input', { type: 'file', accept: '.csv,text/csv', onchange: async ev => { ta.value = await ev.target.files[0].text(); } });
    return h('div', { class: 'sheet-body' },
      h('div', { class: 'eyebrow' }, 'Import'), h('h2', { class: 'title-l' }, 'Import proof from a spreadsheet'),
      h('p', { class: 'muted' }, 'A CSV with a header row. Entries arrive as drafts for someone to approve.'),
      h('a', { class: 'faint', href: 'data:text/csv;charset=utf-8,' + encodeURIComponent(header + '\n' + example + '\n'), download: 'proof-template.csv' }, '⬇ Download the template'),
      file, h('div', { class: 'field' }, ta),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: async () => {
        try { const r = await api('proof/import', { method: 'POST', body: { csv: ta.value } }); await loadProof(); render(); close(); toast(`Imported ${r.length} entries as drafts.`, 'ok'); }
        catch (err) { toast(err.message, 'error'); }
      } }, 'Import')));
  });
}
