// Review: versions of films and decks on their way to approval (lib/reviews.mjs). A queue of what is waiting, and for
// each version: the frozen copy to watch, comments pinned to a moment or a slide, the claims check against the Proof
// Library, the three sign-offs in order, and its audit trail.
import { h, api, icon, toast, sheet, app, go, segmented, timeAgo, fmt, hasRole } from './core.js';

const STEP = { lead: 'Creative lead', reviewer: 'Medical, legal and regulatory', budget: 'Budget owner' };
const SHORT = { lead: 'Creative', reviewer: 'MLR', budget: 'Budget' };
const STATUS = { 'in-review': ['In review', 'review'], changes: ['Changes requested', 'failed'], approved: ['Approved', 'done'], lapsed: ['Approval lapsed', 'failed'], withdrawn: ['Withdrawn', ''], superseded: ['Replaced by a newer version', ''] };
const VERDICT = { backed: ['Backed', 'done'], unbacked: ['No proof', 'failed'], 'needs-consent': ['Needs consent', 'failed'], wording: ['Health wording', 'warn'] };
const ACTION = {
  'review.submitted': 'submitted this version', 'review.checked': 'claims check finished', 'review.recheck': 'ran the claims check again', 'review.comment': 'commented',
  'review.comment-resolved': 'resolved a comment', 'review.comment-reopened': 'reopened a comment', 'review.signed': 'signed', 'review.changes-requested': 'asked for changes',
  'review.item-accepted': 'accepted a flagged item', 'review.approved': 'approved for publishing', 'review.lapsed': 'approval lapsed', 'review.withdrawn': 'withdrew this version',
};
let root, filter = 'waiting', timer = null;

export function mountReview(el) { root = el; }
export async function reviewCount() { return (await api('reviews')).reviews.filter(r => r.can.act).length; }

export async function showReview(args = []) {
  clearInterval(timer);
  return args[0] ? detail(args[0]) : queue();
}

const badge = status => { const [label, cls] = STATUS[status] || [status, '']; return h('span', { class: 'badge ' + cls }, label); };
const kindLabel = a => a.mode === 'deck' ? 'Deck' : { ad: 'Ad', reel: 'Reel' }[a.kind] || 'Film';
const initials = n => String(n || '?').split(/[\s@.]+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

// the three sign-offs as a strip: done, sent back, whose turn, still to come
function stepper(steps, turn) {
  return h('div', { class: 'rv-steps' }, steps.map(s => h('span', { class: 'rv-step ' + (s.status === 'approved' ? 'ok' : s.status === 'changes' ? 'bad' : s.role === turn ? 'now' : ''), title: `${STEP[s.role]}: ${s.status === 'approved' ? 'signed by ' + s.name : s.status === 'changes' ? 'changes asked by ' + s.name : s.role === turn ? 'waiting' : 'to come'}` },
    s.status === 'approved' ? icon('check', 11) : s.status === 'changes' ? icon('x', 11) : null, SHORT[s.role])));
}

async function queue() {
  const { reviews } = await api('reviews');
  const sets = {
    waiting: reviews.filter(r => r.can.act),
    open: reviews.filter(r => ['in-review', 'changes'].includes(r.status)),
    approved: reviews.filter(r => r.status === 'approved'),
    lapsed: reviews.filter(r => r.status === 'lapsed'),
    all: reviews.filter(r => r.status !== 'superseded'),
  };
  const list = h('div', { class: 'rq-list' });
  const paint = () => {
    const rows = sets[filter] || sets.all;
    list.replaceChildren(...rows.map(card));
    if (!rows.length) list.append(h('div', { class: 'empty-state' }, icon('seal', 30),
      filter === 'waiting' ? 'Nothing is waiting for your sign-off.' : reviews.length ? 'Nothing here.' : 'Nothing has been submitted yet. Export a film or deck, then submit it for review.',
      hasRole('creator') && !reviews.length ? h('div', { class: 'actions', style: { justifyContent: 'center' } }, h('button', { class: 'btn primary', onclick: () => submitSheet() }, icon('plus', 14), 'Submit for review')) : null));
  };
  root.replaceChildren(h('div', { class: 'reviews' },
    h('div', { class: 'g-top' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Review'), h('h1', { class: 'title-xl' }, 'Nothing ships unsigned.'),
        h('p', { class: 'sub' }, 'Every version is checked against the Proof Library, then signed by the creative lead, medical, legal and regulatory, and the budget owner, in that order.')),
      hasRole('creator') ? h('div', { class: 'actions' }, h('button', { class: 'btn primary big', onclick: () => submitSheet() }, icon('plus', 16), 'Submit for review')) : null),
    h('div', { class: 'stats' }, [['waiting', 'waiting for you'], ['open', 'in review'], ['approved', 'approved'], ['lapsed', 'lapsed']].map(([k, l]) => h('div', { class: 'stat' }, h('b', {}, sets[k].length), h('span', {}, l)))),
    segmented([{ v: 'waiting', label: 'Waiting for me' }, { v: 'open', label: 'In review' }, { v: 'approved', label: 'Approved' }, { v: 'lapsed', label: 'Lapsed' }, { v: 'all', label: 'All' }], filter, v => { filter = v; paint(); }, { label: 'Filter' }),
    list));
  paint();
}

function card(r) {
  const checks = r.checks.status === 'running' ? h('span', { class: 'badge' }, 'Checking claims…') : r.checks.status === 'failed' ? h('span', { class: 'badge failed' }, 'Check failed')
    : r.checks.open ? h('span', { class: 'badge failed' }, `${r.checks.open} to resolve`) : h('span', { class: 'badge done' }, icon('check', 11), 'Claims backed');
  return h('button', { class: 'rq-card' + (r.can.act ? ' mine' : ''), onclick: () => go('review/' + r.id) },
    h('div', { class: 'rq-thumb' }, r.version.poster ? h('img', { src: `/api/reviews/${r.id}/poster`, alt: '' }) : icon(r.version.kind === 'deck' ? 'slides' : 'film', 22)),
    h('div', { class: 'rq-main' },
      h('b', {}, r.asset.title),
      h('small', {}, `${kindLabel(r.asset)} · version ${r.version.n} · from ${r.submittedBy.name.split(' ')[0]} · ${timeAgo(r.submittedAt)}`),
      stepper(r.steps, r.turn)),
    h('div', { class: 'rq-side' }, badge(r.status), r.status === 'in-review' ? checks : null,
      r.comments ? h('small', { class: 'faint' }, `${r.comments} open comment${r.comments > 1 ? 's' : ''}`) : null,
      r.can.act ? h('span', { class: 'badge review' }, 'Your turn') : null));
}

// pick an exported film or deck and send it for review
export async function submitSheet(preselect) {
  const list = await api('reviews/candidates');
  if (!list.length) return toast('Nothing is ready to review: export a film, or export a deck as a PDF, first.', 'info', 7000);
  let pick = preselect && list.some(c => c.id === preselect && !c.inReview) ? preselect : list.find(c => !c.inReview)?.id;
  sheet(close => {
    const note = h('textarea', { rows: 3, placeholder: 'What changed, what to look at, where it will run…' });
    const grid = h('div', { class: 'rq-pick' });
    const paint = () => grid.replaceChildren(...list.map(c => h('button', { class: 'rq-opt' + (c.id === pick ? ' on' : ''), disabled: !!c.inReview, onclick: () => { pick = c.id; paint(); } },
      h('div', { class: 'rq-thumb' }, c.poster ? h('img', { src: c.poster, alt: '' }) : icon(c.mode === 'deck' ? 'slides' : 'film', 20)),
      h('div', {}, h('b', {}, c.title), h('small', { class: 'faint' }, [c.mode === 'deck' ? 'Deck' : { ad: 'Ad', reel: 'Reel' }[c.kind] || 'Film', c.owner, 'exported ' + timeAgo(c.exported)].filter(Boolean).join(' · ')),
        c.inReview ? h('span', { class: 'badge review' }, 'In review') : null))));
    paint();
    return h('div', { class: 'sheet-body' },
      h('div', { class: 'eyebrow' }, 'Submit for review'), h('h2', { class: 'title-l' }, 'Which version?'),
      h('p', { class: 'muted' }, 'A frozen copy of the exported file is reviewed, so later edits never change what was signed. Its claims are checked against the Proof Library as soon as you submit.'),
      grid, h('label', { class: 'field' }, h('span', {}, 'Note for the reviewers'), note),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: async ev => {
        if (!pick) return toast('Pick a film or deck.', 'error');
        ev.target.disabled = true;
        try { const r = await api('reviews', { method: 'POST', body: { asset: pick, note: note.value } }); close(); toast('Submitted. The claims check is running.', 'ok'); go('review/' + r.id); }
        catch (e) { ev.target.disabled = false; toast(e.message, 'error'); }
      } }, icon('seal', 14), 'Submit')));
  }, { wide: true });
}

// —— one version ——
async function detail(id) {
  let r = await api('reviews/' + id);
  const proofs = new Map((app.proof || await api('proof').then(l => (app.proof = l)).catch(() => [])).map(e => [e.id, e]));
  let media, side = h('aside', { class: 'rv-side' }), talk = h('div', { class: 'rv-talk' });
  const isDeck = r.version.kind === 'deck';
  if (isDeck) media = h('iframe', { class: 'rv-pdf', src: `/api/reviews/${id}/media#view=FitH`, title: r.asset.title });
  else media = h('video', { class: 'rv-video', src: `/api/reviews/${id}/media`, controls: true, playsinline: true, preload: 'metadata', poster: r.version.poster ? `/api/reviews/${id}/poster` : null });

  const act = async (path, body, msg) => {
    try { r = await api(`reviews/${id}/${path}`, { method: path.startsWith('comments/') ? 'PUT' : 'POST', body }); paintSide(); paintTalk(); if (msg) toast(msg, 'ok'); return true; }
    catch (e) { toast(e.message, 'error'); return false; }
  };

  // comments, pinned to a moment of the film or a slide of the deck
  function paintTalk() {
    const text = h('textarea', { rows: 2, placeholder: 'Comment on this version…' });
    let pin = true;
    const where = isDeck ? h('input', { class: 'rv-page', type: 'number', min: 1, placeholder: 'Slide', 'aria-label': 'Slide number' })
      : h('button', { class: 'chip on', type: 'button', onclick: e => { pin = !pin; e.currentTarget.classList.toggle('on', pin); } }, icon('play', 12), h('span', {}, 'at ' + fmt(media.currentTime || 0)));
    if (!isDeck) media.ontimeupdate = () => { const s = where.querySelector('span'); if (s) s.textContent = 'at ' + fmt(media.currentTime || 0); };
    const send = async () => {
      if (!text.value.trim()) return;
      const ok = await act('comments', { text: text.value, t: !isDeck && pin ? media.currentTime : null, page: isDeck ? +where.value || null : null });
      if (ok) text.value = '';
    };
    text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
    const list = [...r.comments].sort((a, b) => (a.t ?? a.page ?? 1e9) - (b.t ?? b.page ?? 1e9) || a.at.localeCompare(b.at));
    talk.replaceChildren(...[
      h('div', { class: 'section-head' }, h('b', {}, 'Comments'), h('small', { class: 'faint' }, `${r.comments.filter(c => !c.resolved).length} open`)),
      ['in-review', 'changes'].includes(r.status) ? h('div', { class: 'rv-compose' }, text, h('div', { class: 'actions' }, where, h('span', { style: { flex: 1 } }), h('button', { class: 'btn primary', onclick: send }, 'Comment'))) : null,
      ...list.map(c => h('div', { class: 'rv-comment' + (c.resolved ? ' done' : '') },
        h('span', { class: 'avatar' }, initials(c.name)),
        h('div', {},
          h('div', { class: 'rv-c-head' }, h('b', {}, c.name), c.t != null ? h('button', { class: 'chip', onclick: () => { media.currentTime = c.t; media.pause(); media.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }, icon('play', 11), fmt(c.t)) : null,
            c.page ? h('span', { class: 'chip' }, 'Slide ' + c.page) : null, h('small', { class: 'faint' }, timeAgo(c.at))),
          h('p', {}, c.text)),
        h('button', { class: 'btn ghost round', title: c.resolved ? 'Reopen' : 'Resolve', 'aria-label': c.resolved ? 'Reopen' : 'Resolve', onclick: () => act('comments/' + c.id, { resolved: !c.resolved }) }, icon(c.resolved ? 'pencil' : 'check', 14)))),
      !r.comments.length ? h('p', { class: 'faint' }, 'No comments yet.') : null].filter(Boolean));
  }

  function paintSide() {
    const open = new Set(r.open);
    const steps = h('div', { class: 'rv-card' }, h('div', { class: 'section-head' }, h('b', {}, 'Sign-offs'), badge(r.status)),
      ...r.steps.map(s => h('div', { class: 'rv-sign ' + (s.status === 'approved' ? 'ok' : s.status === 'changes' ? 'bad' : s.role === r.turn ? 'now' : '') },
        h('div', { class: 'rv-sign-dot' }, s.status === 'approved' ? icon('check', 13) : s.status === 'changes' ? icon('x', 13) : null),
        h('div', {},
          h('b', {}, STEP[s.role]),
          h('small', { class: 'faint' }, s.status === 'approved' ? `Signed by ${s.name} · ${timeAgo(s.at)}` : s.status === 'changes' ? `Changes asked by ${s.name} · ${timeAgo(s.at)}` : s.role === r.turn ? 'Waiting for sign-off' : 'After the step above'),
          s.signature ? h('small', { class: 'rv-sig' }, `“${s.signature.typed}”`) : null,
          s.note ? h('p', { class: 'rv-note' }, s.note) : null,
          r.can.act === s.role ? h('div', { class: 'actions' },
            h('button', { class: 'btn primary', onclick: () => signSheet(s.role) }, icon('seal', 14), 'Approve and sign'),
            h('button', { class: 'btn', onclick: () => changesSheet(s.role) }, 'Ask for changes'))
            : s.role === r.turn && r.can.why ? h('small', { class: 'faint' }, r.can.why) : null))));

    const items = r.checks.items || [];
    const checks = h('div', { class: 'rv-card' },
      h('div', { class: 'section-head' }, h('b', {}, 'Claims check'),
        r.checks.status === 'running' ? h('span', { class: 'badge' }, h('i', { class: 'spin' }), 'Checking') : r.checks.status === 'failed' ? h('span', { class: 'badge failed' }, 'Failed')
          : h('span', { class: 'badge ' + (open.size ? 'failed' : 'done') }, open.size ? `${open.size} open` : 'All clear')),
      r.checks.status === 'running' ? h('p', { class: 'faint' }, 'Reading every line against the Proof Library. This takes about a minute.') : null,
      r.checks.status === 'failed' ? h('p', { class: 'err' }, r.checks.error) : null,
      r.checks.status === 'done' && !items.length ? h('p', { class: 'faint' }, 'No claims, testimonials or health wording found.') : null,
      ...items.map(i => {
        const [label, cls] = VERDICT[i.verdict], p = i.proof && proofs.get(i.proof), ok = (r.overrides || []).find(o => o.key === i.key);
        return h('div', { class: 'rv-item' + (open.has(i.key) ? ' open' : '') },
          h('div', { class: 'rv-item-head' }, h('span', { class: 'badge ' + (ok ? 'done' : cls) }, ok ? 'Accepted' : label), h('small', { class: 'faint' }, i.where)),
          h('p', { class: 'rv-quote' }, `“${i.quote}”`),
          p ? h('small', { class: 'rv-proof' }, icon('shield', 12), p.claim) : null,
          i.note ? h('small', { class: 'faint' }, i.note) : null,
          ok ? h('small', { class: 'rv-note' }, `${ok.name}: ${ok.reason}`) : null,
          open.has(i.key) && r.can.override ? h('button', { class: 'btn ghost', onclick: () => acceptSheet(i) }, 'Accept with a reason') : null);
      }),
      r.can.recheck && r.checks.status !== 'running' ? h('button', { class: 'btn ghost', onclick: () => act('recheck', {}, 'Checking again.') }, 'Run the check again') : null);

    const lapsed = r.status === 'lapsed' ? h('div', { class: 'rv-card warn' }, h('b', {}, 'This approval lapsed'),
      h('p', { class: 'faint' }, 'Proof it relied on has changed since it was signed. Submit it again for a fresh review.'),
      ...(r.lapsed?.drift || []).map(d => h('small', {}, `“${d.claim}”: ${d.why}`))) : null;

    const trail = h('div', { class: 'rv-card' }, h('div', { class: 'section-head' }, h('b', {}, 'Audit trail')), h('small', { class: 'faint' }, 'Loading…'));
    api('audit?target=' + id).then(a => trail.replaceChildren(
      h('div', { class: 'section-head' }, h('b', {}, 'Audit trail'), h('span', { class: 'badge ' + (a.integrity.ok ? 'done' : 'failed') }, a.integrity.ok ? 'Intact' : 'Broken')),
      ...a.entries.map(e => h('div', { class: 'rv-log' }, h('small', {}, h('b', {}, e.name || e.who), ' ', ACTION[e.action] || e.action, e.detail?.role ? ` as ${STEP[e.detail.role].toLowerCase()}` : ''), h('small', { class: 'faint' }, new Date(e.at).toLocaleString())))))
      .catch(() => trail.remove());

    side.replaceChildren(...[lapsed, steps, checks, trail].filter(Boolean));
    if (r.checks.status === 'running') { clearInterval(timer); timer = setInterval(async () => { if (!root.isConnected || root.hidden) return clearInterval(timer); const x = await api('reviews/' + id).catch(() => null); if (x && x.checks.status !== 'running') { r = x; clearInterval(timer); paintSide(); } }, 4000); }
  }

  function signSheet(role) {
    sheet(close => {
      const name = h('input', { placeholder: app.me?.name || 'Your full name', autofocus: true });
      const agree = h('input', { type: 'checkbox' });
      const note = h('textarea', { rows: 2, placeholder: 'Optional note' });
      return h('div', { class: 'sheet-body' },
        h('div', { class: 'eyebrow' }, `${STEP[role]} sign-off`), h('h2', { class: 'title-l' }, 'Sign this version'),
        h('div', { class: 'callout' }, icon('seal', 18), h('div', {}, h('b', {}, r.statements[role]), h('br'), h('small', { class: 'faint mono' }, `Version ${r.version.n} · fingerprint ${r.version.hash.slice(0, 16)}`))),
        h('label', { class: 'field' }, h('span', {}, 'Type your full name'), name),
        h('label', { class: 'rv-agree' }, agree, h('span', {}, 'I confirm the statement above.')),
        h('label', { class: 'field' }, h('span', {}, 'Note'), note),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: async () => {
          if (await act('decide/' + role, { decision: 'approve', note: note.value, signature: { name: name.value, agree: agree.checked } }, r.steps.filter(s => s.status === 'approved').length === 2 ? 'Approved for publishing.' : 'Signed.')) close();
        } }, icon('seal', 14), 'Sign')));
    });
  }
  function changesSheet(role) {
    sheet(close => {
      const note = h('textarea', { rows: 4, placeholder: 'What has to change before you can sign?', autofocus: true });
      return h('div', { class: 'sheet-body' },
        h('div', { class: 'eyebrow' }, STEP[role]), h('h2', { class: 'title-l' }, 'Ask for changes'),
        h('p', { class: 'muted' }, 'The version goes back to its maker. A corrected export is submitted as a new version and starts the sign-offs again.'),
        h('label', { class: 'field' }, note),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: async () => { if (await act('decide/' + role, { decision: 'changes', note: note.value }, 'Sent back with your notes.')) close(); } }, 'Send back')));
    });
  }
  function acceptSheet(item) {
    sheet(close => {
      const reason = h('textarea', { rows: 3, placeholder: 'e.g. A product description, not a claim. / Covered by the label claims on file, ref. MLR-2026-14.', autofocus: true });
      return h('div', { class: 'sheet-body' },
        h('div', { class: 'eyebrow' }, 'Medical, legal and regulatory'), h('h2', { class: 'title-l' }, 'Accept this item'),
        h('p', { class: 'rv-quote' }, `“${item.quote}”`), h('small', { class: 'faint' }, item.note),
        h('label', { class: 'field' }, h('span', {}, 'Why it may stand (kept in the audit trail)'), reason),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: async () => { if (await act('accept', { key: item.key, reason: reason.value }, 'Accepted.')) close(); } }, 'Accept')));
    });
  }

  const assetLink = r.asset.mode === 'deck' ? 'decks/' + r.asset.id : r.asset.mode === 'director' ? 'studio/' + r.asset.id : 'create/' + r.asset.id;
  root.replaceChildren(h('div', { class: 'rv' },
    h('div', { class: 'rv-head' },
      h('button', { class: 'btn ghost', onclick: () => go('review') }, icon('chevronL', 14), 'Review'),
      h('div', { class: 'rv-title' }, h('div', { class: 'eyebrow' }, `${kindLabel(r.asset)} · version ${r.version.n}`), h('h1', { class: 'title-l' }, r.asset.title),
        h('small', { class: 'faint' }, `Submitted by ${r.submittedBy.name} · ${timeAgo(r.submittedAt)}`, r.history.length > 1 ? ' · ' : '',
          ...r.history.filter(x => x.id !== id).map(x => h('a', { href: '#review/' + x.id }, `v${x.n} `)))),
      h('div', { class: 'actions' },
        r.status === 'changes' && hasRole('creator') ? h('button', { class: 'btn primary', onclick: () => submitSheet(r.asset.id) }, 'Submit the new version') : null,
        h('button', { class: 'btn', onclick: () => go(assetLink) }, 'Open the original'),
        r.can.withdraw ? h('button', { class: 'btn ghost danger', onclick: async () => { if (confirm('Withdraw this version from review?')) await act('withdraw', {}, 'Withdrawn.'); } }, 'Withdraw') : null)),
    r.note ? h('div', { class: 'callout' }, icon('doc', 18), h('div', {}, h('b', {}, `${r.submittedBy.name.split(' ')[0]}’s note`), h('p', {}, r.note))) : null,
    h('div', { class: 'rv-grid' }, h('div', { class: 'rv-main' }, h('div', { class: 'rv-media' + (isDeck ? ' deck' : '') }, media),
      // some browsers won't show a PDF inside the page
      isDeck ? h('a', { class: 'btn ghost', style: { justifySelf: 'start' }, href: `/api/reviews/${id}/media`, target: '_blank', rel: 'noopener' }, icon('doc', 14), 'Open the PDF') : null, talk), side)));
  paintTalk();
  paintSide();
}
