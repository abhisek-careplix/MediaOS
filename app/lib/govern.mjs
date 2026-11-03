// The studio's checks and balances over HTTP: the team and its roles, reviews and sign-offs, spend and caps, the audit
// trail, and the backup and disk use (/api/team, /api/reviews, /api/spend, /api/audit, /api/storage). writeGate() is
// asked before every API write: who may change what, and whether the month's caps leave room for paid work.
import { ROLES, rolesOf, can, listTeam, setPerson, removePerson, adminConfigured } from './team.mjs';
import { listReviews, viewReview, candidates, submit, decide, override, comment, resolveComment, withdraw, recheck, mediaPath, STEPS } from './reviews.mjs';
import { spendOf, readCaps, writeCaps, overCap, monthOf, KINDS } from './ledger.mjs';
import { readAudit, verifyAudit } from './audit.mjs';
import { storageOn, storageStatus, syncNow } from './storage.mjs';
import { diskUse } from './removal.mjs';

export const GOVERNED = new Set(['team', 'reviews', 'spend', 'audit', 'storage']);
const NO_ROLE = 'Your role doesn’t include this. Ask an admin to add the Creator role on the Team page.';

// writes that start paid work, refused once a monthly cap is reached
const SPENDS = [/^\/api\/films$/, /^\/api\/productions(\/|$)/, /^\/api\/decks$/, /^\/api\/decks\/(outline|[^/]+\/slides\/)/, /^\/api\/brands\/generate$/, /^\/api\/director$/];

export function writeGate(method, pathname, user) {
  if (['GET', 'HEAD'].includes(method) || !pathname.startsWith('/api/')) return null;
  const area = pathname.split('/')[2];
  if (GOVERNED.has(area)) return null;   // each governed route checks its own roles
  if (method === 'DELETE' && /^\/api\/films\/[^/]+$/.test(pathname)) return null;   // a delete checks for the owner or an admin itself
  const roles = rolesOf(user);
  if (area === 'proof' ? !roles.some(r => r === 'creator' || r === 'reviewer') : !roles.includes('creator')) return { code: 403, error: NO_ROLE };
  if (SPENDS.some(re => re.test(pathname))) { const over = overCap(user); if (over) return { code: 402, error: over }; }
  return null;
}

export async function governApi(req, res, parts, url, user, helpers) {
  try { return await routes(req, res, parts, url, user, helpers); }
  catch (e) { if (e.code >= 400 && e.code < 500) return helpers.send(res, e.code, { error: e.message }); throw e; }
}

async function routes(req, res, parts, url, user, { send, body, serveFile }) {
  const M = req.method, need = role => { if (!can(user, role)) throw Object.assign(new Error(`This needs the ${ROLES[role].name} role.`), { code: 403 }); };

  if (parts[0] === 'team') {
    if (M === 'GET') return send(res, 200, { me: { email: user.email, name: user.name, roles: rolesOf(user) }, people: listTeam(), roles: ROLES, adminConfigured: adminConfigured(), local: !!user.local });
    need('admin');
    const email = decodeURIComponent(parts[1] || '');
    if (M === 'PUT' && email) return send(res, 200, setPerson(email, await body(req), user));
    if (M === 'DELETE' && email) { removePerson(email); return send(res, 200, { ok: true }); }
  }

  if (parts[0] === 'reviews') {
    const id = parts[1];
    if (M === 'GET' && !id) return send(res, 200, { reviews: listReviews(user), steps: STEPS, roles: ROLES });
    if (M === 'GET' && id === 'candidates') return send(res, 200, candidates());
    if (M === 'POST' && !id) {
      if (!can(user, 'creator')) return send(res, 403, { error: NO_ROLE });
      const b = await body(req);
      return send(res, 200, submit(b.asset, b.note, user));
    }
    if (M === 'GET' && (parts[2] === 'media' || parts[2] === 'poster')) { const m = mediaPath(id, parts[2]); return serveFile(req, res, m.root, m.file); }
    if (M === 'GET' && !parts[2]) return send(res, 200, viewReview(id, user));
    const b = M === 'GET' ? {} : await body(req);
    if (M === 'POST' && parts[2] === 'decide' && parts[3]) decide(id, parts[3], b, user);
    else if (M === 'POST' && parts[2] === 'accept') override(id, b.key, b.reason, user);
    else if (M === 'POST' && parts[2] === 'comments') comment(id, b, user);
    else if (M === 'PUT' && parts[2] === 'comments' && parts[3]) resolveComment(id, parts[3], b.resolved, user);
    else if (M === 'POST' && parts[2] === 'withdraw') withdraw(id, user);
    else if (M === 'POST' && parts[2] === 'recheck') recheck(id, user);
    else return send(res, 404, { error: 'no such route' });
    return send(res, 200, viewReview(id, user));
  }

  if (parts[0] === 'spend') {
    if (M === 'GET') {
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : monthOf();
      return send(res, 200, { ...spendOf(month), caps: readCaps(), kinds: KINDS, canEdit: can(user, 'budget') || can(user, 'admin'), me: user.email, current: monthOf() });
    }
    if (M === 'PUT' && parts[1] === 'caps') {
      if (!can(user, 'budget') && !can(user, 'admin')) return send(res, 403, { error: 'Only a budget owner or an admin can set caps.' });
      return send(res, 200, writeCaps(await body(req)));
    }
  }

  // the Cloud Storage backup: how far it got, and a pass now
  if (parts[0] === 'storage') {
    need('admin');
    if (M === 'GET' && parts[1] === 'usage') return send(res, 200, diskUse());
    if (M === 'GET') return send(res, 200, storageStatus());
    if (M === 'POST' && parts[1] === 'sync') {
      if (!storageOn()) return send(res, 400, { error: 'Cloud Storage isn’t set up on this server.' });
      await syncNow();
      return send(res, 200, storageStatus());
    }
  }

  if (parts[0] === 'audit' && M === 'GET') {
    if (!['admin', 'reviewer', 'budget', 'lead'].some(r => can(user, r))) return send(res, 403, { error: 'The audit trail is open to admins and sign-off roles.' });
    return send(res, 200, { entries: readAudit({ target: url.searchParams.get('target') || undefined, limit: 500 }), integrity: verifyAudit() });
  }
  return send(res, 404, { error: 'no such route' });
}
