// Reviews: before a film or deck may be published, a frozen copy of that version goes through three sign-offs in
// order: the creative lead, then medical, legal and regulatory (MLR), then the budget owner. Each sign-off is made by a
// different person from the one who submitted it and from each other, with their typed name against a statement and
// the version's fingerprint. The claims check runs as soon as it is submitted; MLR cannot approve while a flagged item
// is open (fixed in a new version, or accepted with a written reason). An approval lapses on its own if a Proof Library
// entry it relied on later changes. Everything is in the workspace's governance/reviews/<id>/ and its audit trail.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { here } from './paths.mjs';
import { readMeta, writeMeta } from './jobs.mjs';
import { readDeck } from './decks.mjs';
import { linesOfFilm, linesOfDeck, runChecks, proofDrift } from './checks.mjs';
import { can, ROLES } from './team.mjs';
import { audit } from './audit.mjs';
import { tag } from './context.mjs';

const reviewsDir = () => path.join(here().governance, 'reviews');
export const STEPS = ['lead', 'reviewer', 'budget'];
export const STATEMENTS = {
  lead: 'I have reviewed this version for brand and creative quality.',
  reviewer: 'I have reviewed every claim, disclosure and testimonial in this version against the Proof Library, and it may be published.',
  budget: 'I approve publishing this version and the spending it needs.',
};
const err = (msg, code = 400) => Object.assign(new Error(msg), { code });
const now = () => new Date().toISOString();
const stamp = () => now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const dirOf = id => { if (!/^r-[a-z0-9-]+$/.test(id)) throw err('bad review id'); return path.join(reviewsDir(), id); };

export function loadReview(id) {
  try { return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'review.json'), 'utf8')); } catch { throw err('No such review.', 404); }
}
function save(r) {
  const f = path.join(dirOf(r.id), 'review.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(r, null, 1));
  fs.renameSync(f + '.tmp', f);
  return r;
}
function all() {
  if (!fs.existsSync(reviewsDir())) return [];
  return fs.readdirSync(reviewsDir()).filter(d => d.startsWith('r-')).map(id => { try { return loadReview(id); } catch { return null; } }).filter(Boolean);
}

// an approved version whose proof has moved on is no longer approved: record that once, when first seen
function settle(r) {
  // a check cut off by a restart never finishes on its own
  if (r.checks?.status === 'running' && Date.now() - new Date(r.checks.startedAt || r.submittedAt) > 15 * 60e3) {
    r.checks = { status: 'failed', items: [], error: 'The check was interrupted. Run it again.' };
    save(r);
  }
  if (r.status !== 'approved' || !r.checks?.proofs?.length) return r;
  const drift = proofDrift(r.checks.proofs);
  if (!drift.length) return r;
  r.status = 'lapsed';
  r.lapsed = { at: now(), drift };
  save(r);
  audit('review.lapsed', { target: r.id, who: 'system', name: null, detail: { asset: r.asset.id, drift } });
  return r;
}

const open = i => i.verdict !== 'backed';
export const openItems = r => (r.checks?.items || []).filter(i => open(i) && !(r.overrides || []).some(o => o.key === i.key));
const turn = r => r.status === 'in-review' ? r.steps.find(s => s.status === 'pending') : null;

// what this person may do with this review now, and why not
function abilities(r, user) {
  const step = turn(r), local = !!user.local, mine = r.submittedBy.email === user.email;
  let act = null, why = null;
  if (step) {
    if (!can(user, step.role)) why = `Waiting for the ${ROLES[step.role].name.toLowerCase()}.`;
    else if (!local && mine) why = 'Someone other than the submitter signs off.';
    else if (!local && r.steps.some(s => s.by === user.email)) why = 'You signed an earlier step; another person signs this one.';
    else act = step.role;
  }
  return { act, why, override: can(user, 'reviewer') && ['in-review', 'changes'].includes(r.status), withdraw: (mine || can(user, 'admin')) && ['in-review', 'changes'].includes(r.status), recheck: (mine || can(user, 'reviewer')) && r.status === 'in-review' };
}

const summary = (r, user) => ({ id: r.id, asset: r.asset, version: { n: r.version.n, poster: r.version.poster, kind: r.version.kind }, submittedBy: r.submittedBy, submittedAt: r.submittedAt,
  status: r.status, steps: r.steps.map(({ role, status, name, at }) => ({ role, status, name, at })), checks: { status: r.checks?.status, open: openItems(r).length, total: r.checks?.items?.length || 0 },
  comments: r.comments.filter(c => !c.resolved).length, turn: turn(r)?.role || null, can: abilities(r, user) });

// every version of one film or deck that went up for review
export const reviewsOf = assetId => all().filter(r => r.asset.id === assetId);

export function listReviews(user) {
  return all().map(settle).map(r => summary(r, user)).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}
export function viewReview(id, user) {
  const r = settle(loadReview(id));
  return { ...r, open: openItems(r).map(i => i.key), turn: turn(r)?.role || null, can: abilities(r, user), statements: STATEMENTS,
    history: all().filter(x => x.asset.id === r.asset.id).map(x => ({ id: x.id, n: x.version.n, status: x.status, submittedAt: x.submittedAt })).sort((a, b) => b.n - a.n) };
}

// exported films and decks that can go up for review
export function candidates() {
  const busy = new Map(all().filter(r => ['in-review', 'changes'].includes(r.status)).map(r => [r.asset.id, r]));
  const films = here().films;
  if (!fs.existsSync(films)) return [];
  return fs.readdirSync(films).map(id => {
    const dir = path.join(films, id), m = id.startsWith('.') ? null : readMeta(dir);
    if (!m) return null;
    const file = m.mode === 'deck' ? m.files?.pdf : m.status === 'done' ? m.output : null;
    if (!file || !fs.existsSync(path.join(dir, file))) return null;
    return { id, mode: m.mode, kind: m.kind || (m.mode === 'deck' ? 'deck' : 'film'), title: m.filmTitle || m.title || 'Untitled', created: m.created, exported: m.finished || m.exported || m.created,
      poster: fs.existsSync(path.join(dir, 'poster.jpg')) ? `/films/${id}/poster.jpg` : null, owner: m.ownerName || m.owner, inReview: busy.get(id)?.id || null };
  }).filter(Boolean).sort((a, b) => String(b.exported).localeCompare(String(a.exported)));
}

export function submit(assetId, note, user) {
  if (!/^[a-z0-9-]+$/.test(String(assetId))) throw err('Pick something to review.');
  const dir = path.join(here().films, assetId), m = readMeta(dir);
  if (!m) throw err('That film or deck no longer exists.', 404);
  const deck = m.mode === 'deck';
  const file = deck ? m.files?.pdf : m.output;
  if (!file || !fs.existsSync(path.join(dir, file)) || (!deck && m.status !== 'done')) throw err(deck ? 'Export the deck as a PDF first.' : 'Export the film first: a review is of a finished version.');
  const prior = all().filter(r => r.asset.id === assetId);
  const busy = prior.find(r => ['in-review', 'changes'].includes(r.status));
  if (busy && busy.status === 'in-review') throw err('This is already in review. Withdraw that version first, or wait for it.', 409);
  tag({ asset: assetId, brandId: m.brandId || null });   // the claims check is charged to what it checks
  let lines, cited = [], given = '';
  if (deck) { const d = readDeck(dir); lines = linesOfDeck(d); cited = d.slides.flatMap(s => s.proof || []); given = String(d.brief || '').slice(0, 4000); }
  else lines = linesOfFilm(JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf8')));

  const id = `r-${stamp()}-${crypto.randomBytes(2).toString('hex')}`, rdir = dirOf(id);
  fs.mkdirSync(rdir, { recursive: true });
  const media = deck ? 'deck.pdf' : 'film' + path.extname(file);
  fs.copyFileSync(path.join(dir, file), path.join(rdir, media));
  const poster = fs.existsSync(path.join(dir, 'poster.jpg')) ? (fs.copyFileSync(path.join(dir, 'poster.jpg'), path.join(rdir, 'poster.jpg')), 'poster.jpg') : null;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(rdir, media))).digest('hex');
  const r = {
    id, asset: { id: assetId, mode: m.mode, kind: m.kind || (deck ? 'deck' : 'film'), title: m.filmTitle || m.title || 'Untitled', brandId: m.brandId || null, aspect: m.aspect || null, owner: m.owner, ownerName: m.ownerName || null },
    version: { n: prior.length + 1, kind: deck ? 'deck' : 'video', media, poster, hash, source: file, lines, cited: [...new Set(cited)], given },
    submittedBy: { email: user.email, name: user.name || user.email }, submittedAt: now(), note: String(note || '').slice(0, 2000),
    status: 'in-review', steps: STEPS.map(role => ({ role, status: 'pending' })), checks: { status: 'running', items: [], startedAt: now() }, overrides: [], comments: [],
  };
  // a newer version replaces one that came back with changes
  if (busy) { busy.status = 'superseded'; busy.supersededBy = id; save(busy); }
  save(r);
  audit('review.submitted', { target: id, detail: { asset: assetId, title: r.asset.title, version: r.version.n, sha256: hash } });
  check(id);
  return r;
}

// the claims check, in the background (the version is open for comments meanwhile)
function check(id) {
  const r = loadReview(id);
  runChecks(r.version.lines, { cited: r.version.cited || [], given: r.version.given || '' })
    .then(res => {
      const x = loadReview(id);
      x.checks = { status: 'done', ...res };
      save(x);
      audit('review.checked', { target: id, detail: { items: res.items.length, open: openItems(x).length } });
    })
    .catch(e => {
      const x = loadReview(id);
      x.checks = { status: 'failed', items: [], error: String(e.message || e) };
      save(x);
    });
}
export function recheck(id, user) {
  const r = loadReview(id);
  if (!abilities(r, user).recheck) throw err('Only the submitter or a reviewer can run the check again, while it is in review.', 403);
  r.checks = { status: 'running', items: [], startedAt: now() };
  save(r);
  check(id);
  audit('review.recheck', { target: id });
  return r;
}

export function decide(id, role, { decision, note, signature } = {}, user) {
  const r = settle(loadReview(id)), step = turn(r);
  if (!step) throw err('This version is not waiting for a sign-off.', 409);
  if (step.role !== role) throw err(`It is the ${ROLES[step.role].name.toLowerCase()}’s turn.`, 409);
  const a = abilities(r, user);
  if (a.act !== role) throw err(a.why || 'You can’t sign this step.', 403);
  note = String(note || '').trim().slice(0, 2000);
  if (decision === 'changes') {
    if (!note) throw err('Say what needs to change.');
    Object.assign(step, { status: 'changes', by: user.email, name: user.name || user.email, at: now(), note });
    r.status = 'changes';
    save(r);
    audit('review.changes-requested', { target: id, detail: { role, note } });
    return r;
  }
  if (decision !== 'approve') throw err('Approve, or ask for changes.');
  if (role === 'reviewer') {
    if (r.checks?.status !== 'done') throw err(r.checks?.status === 'failed' ? 'The claims check failed. Run it again before signing.' : 'Wait for the claims check to finish.', 409);
    const left = openItems(r).length;
    if (left) throw err(`${left} flagged item${left > 1 ? 's are' : ' is'} still open. Fix ${left > 1 ? 'them' : 'it'} in a new version, or accept each with a reason.`, 409);
  }
  const typed = String(signature?.name || '').trim();
  if (typed.length < 3 || !signature?.agree) throw err('Type your full name and confirm the statement to sign.');
  Object.assign(step, { status: 'approved', by: user.email, name: user.name || user.email, at: now(), note, signature: { typed, statement: STATEMENTS[role], sha256: r.version.hash } });
  audit('review.signed', { target: id, detail: { role, typed, sha256: r.version.hash } });
  if (r.steps.every(s => s.status === 'approved')) {
    r.status = 'approved';
    r.approvedAt = now();
    audit('review.approved', { target: id, detail: { asset: r.asset.id, version: r.version.n, sha256: r.version.hash } });
    const dir = path.join(here().films, r.asset.id), m = readMeta(dir);
    if (m) writeMeta(dir, { ...m, approval: { review: id, version: r.version.n, at: r.approvedAt } });
  }
  return save(r);
}

export function override(id, key, reason, user) {
  const r = loadReview(id);
  if (!abilities(r, user).override) throw err('Only a medical, legal and regulatory reviewer can accept a flagged item.', 403);
  const item = (r.checks?.items || []).find(i => i.key === key);
  if (!item || !open(item)) throw err('That item isn’t flagged.');
  reason = String(reason || '').trim().slice(0, 1000);
  if (reason.length < 8) throw err('Give the reason it may stand.');
  r.overrides = (r.overrides || []).filter(o => o.key !== key).concat({ key, quote: item.quote, by: user.email, name: user.name || user.email, at: now(), reason });
  audit('review.item-accepted', { target: id, detail: { quote: item.quote, verdict: item.verdict, reason } });
  return save(r);
}

export function comment(id, { text, t, page }, user) {
  const r = loadReview(id);
  text = String(text || '').trim().slice(0, 4000);
  if (!text) throw err('Write a comment first.');
  const c = { id: crypto.randomBytes(4).toString('hex'), by: user.email, name: user.name || user.email, at: now(), text,
    t: Number.isFinite(+t) && t !== null && t !== '' ? Math.max(0, Math.round(+t * 10) / 10) : null, page: Number.isInteger(+page) && +page > 0 ? +page : null, resolved: false };
  r.comments.push(c);
  audit('review.comment', { target: id, detail: { comment: c.id, t: c.t, page: c.page } });
  return save(r);
}
export function resolveComment(id, cid, resolved, user) {
  const r = loadReview(id), c = r.comments.find(x => x.id === cid);
  if (!c) throw err('No such comment.', 404);
  c.resolved = !!resolved;
  c.resolvedBy = resolved ? user.email : null;
  audit(resolved ? 'review.comment-resolved' : 'review.comment-reopened', { target: id, detail: { comment: cid } });
  return save(r);
}
export function withdraw(id, user) {
  const r = loadReview(id);
  if (!abilities(r, user).withdraw) throw err('Only the submitter or an admin can withdraw it.', 403);
  r.status = 'withdrawn';
  r.withdrawnAt = now();
  audit('review.withdrawn', { target: id });
  return save(r);
}

export const mediaPath = (id, which) => {
  const r = loadReview(id), file = which === 'poster' ? r.version.poster : r.version.media;
  if (!file) throw err('Not found.', 404);
  return { root: dirOf(id), file };
};
