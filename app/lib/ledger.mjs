// Spend: every paid generation (writing, frames, video) recorded once in the workspace's governance/ledger.jsonl, with
// who asked, for which product (brand kit) and which asset; and the monthly caps its budget owner sets, in caps.json.
// Each workspace has its own ledger and caps, and its operator's monthly limit (workspaces.mjs) over both. Work that
// would pass a cap or the limit is refused before it starts; a job already running finishes.
// Work the studio gave up on (too slow, or its result never came back) that the provider may still finish and bill goes
// in as an estimate straight away, so the caps count it; a later line settles it, confirmed (it was made, so it was
// billed) or cleared (it wasn’t).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { here } from './paths.mjs';
import { current, inWorkspace } from './context.mjs';
import { audit } from './audit.mjs';
import { getWorkspace, listWorkspaces } from './workspaces.mjs';

const ledgerFile = () => path.join(here().governance, 'ledger.jsonl'), capsFile = () => path.join(here().governance, 'caps.json');
export const KINDS = { writer: 'Writing', image: 'Frames', video: 'Video', voice: 'Voice and sound', director: 'Directed films' };
const usd = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
export const monthOf = (d = new Date()) => new Date(d).toISOString().slice(0, 7);

// the workspace's charges, each estimate as its settling line left it (a cleared one is gone; a confirmed one is a charge
// like any other)
const caches = new Map();
function all() {
  const file = ledgerFile();
  try {
    const st = fs.statSync(file), c = caches.get(file);
    if (c?.mtime === st.mtimeMs && c.size === st.size) return c.list;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const settled = new Map(lines.filter(e => e.settles).map(e => [e.settles, e.outcome]));
    const list = lines.filter(e => !e.settles && settled.get(e.id) !== 'cleared').map(e => (e.estimated && settled.has(e.id) ? { ...e, estimated: false, confirmed: true } : e));
    caches.set(file, { mtime: st.mtimeMs, size: st.size, list });
    return list;
  } catch { return []; }
}
const append = e => { const file = ledgerFile(); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(e) + '\n'); };

// record money spent; the person, product and asset come from the current request unless given
export function charge(kind, amount, extra = {}) {
  if (!(amount > 0)) return null;
  const c = current();
  const e = { at: new Date().toISOString(), who: extra.who ?? c.user?.email ?? 'system', name: c.user?.name ?? null, brandId: extra.brandId ?? c.brandId ?? null,
    asset: extra.asset ?? c.asset ?? null, kind: KINDS[kind] ? kind : 'writer', engine: extra.engine || null, amount: Math.round(amount * 1e4) / 1e4, note: extra.note || null,
    ...(extra.estimated ? { id: extra.id, estimated: true, seconds: extra.seconds ?? null, ref: extra.ref ?? null, check: extra.check ?? null } : {}) };
  append(e);
  return e;
}

// a provider call's result ({ …, cost }), passed through once its cost is recorded
export const billed = (kind, r, extra) => { charge(kind, r?.cost, extra); return r; };

// work given up on that may still be billed: { kind, engine, seconds, cost } and the provider's request id (ref), with
// check, what the follow-up needs to ask the provider how it ended ({ via, … }); → the estimate's id
export function estimate({ kind, engine, seconds, cost }, ref, check) {
  const id = 'est-' + crypto.randomUUID().slice(0, 13);
  return charge(kind, cost, { engine, estimated: true, id, seconds, ref, check }) ? id : null;
}
// how an estimate ended: 'confirmed' (billed) or 'cleared' (not)
export function settle(id, outcome) {
  if (id) append({ at: new Date().toISOString(), settles: id, outcome });
}

// the follow-up: every few minutes each workspace's open estimates are put to their provider (checks: via → async check
// → 'confirmed', 'cleared', or null while it isn't known yet). After a day without an answer an estimate is left as it is.
let following = false;
export function followUp(checks) {
  const pass = async () => {
    if (following) return;
    following = true;
    try {
      for (const w of listWorkspaces()) await inWorkspace(w.id, async () => {
        for (const e of all().filter(e => e.estimated && e.check && Date.now() - Date.parse(e.at) < 864e5)) {
          const outcome = await checks[e.check.via]?.(e.check).catch(err => { console.error('[spend] follow-up:', err.detail || err.message); return null; });
          if (outcome === 'confirmed' || outcome === 'cleared') settle(e.id, outcome);
        }
      });
    } finally { following = false; }
  };
  pass();
  setInterval(pass, 3 * 60e3).unref();
}

export function readCaps() {
  try { return { total: null, person: null, brands: {}, ...JSON.parse(fs.readFileSync(capsFile(), 'utf8')) }; } catch { return { total: null, person: null, brands: {} }; }
}
export function writeCaps(input) {
  const num = v => v === '' || v == null ? null : Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 100) / 100 : (() => { throw Object.assign(new Error('Caps are amounts in dollars, or empty for no cap.'), { code: 400 }); })();
  const prev = readCaps();
  const caps = { total: num(input.total), person: num(input.person), brands: Object.fromEntries(Object.entries(input.brands || {}).map(([k, v]) => [String(k).slice(0, 60), num(v)]).filter(([, v]) => v != null)) };
  const file = capsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(caps, null, 1));
  fs.renameSync(file + '.tmp', file);
  audit('spend.caps-set', { target: 'caps', detail: { before: prev, after: caps } });
  return caps;
}

const sum = list => list.reduce((a, e) => a + e.amount, 0);
const group = (list, key, label) => Object.values(list.reduce((m, e) => {
  const k = e[key] ?? '';
  m[k] ||= { key: k || null, label: label(e), amount: 0, count: 0 };
  m[k].amount += e.amount;
  m[k].count++;
  return m;
}, {})).sort((a, b) => b.amount - a.amount);

export function spendOf(month = monthOf()) {
  const list = all().filter(e => e.at.startsWith(month)), open = list.filter(e => e.estimated);
  return {
    month, total: sum(list), count: list.length, estimated: sum(open), estimates: open.length, limit: getWorkspace(current().ws)?.limit ?? null,
    byPerson: group(list, 'who', e => e.name || e.who), byBrand: group(list, 'brandId', e => e.brandId), byKind: group(list, 'kind', e => KINDS[e.kind] || e.kind),
    // what the follow-up asks the provider stays on the server
    entries: list.slice(-300).reverse().map(({ check, ...e }) => e), months: [...new Set(all().map(e => e.at.slice(0, 7)))].sort().reverse(),
  };
}

// why new spending of about `more` dollars would pass this workspace's monthly limit or one of its caps, or null when it
// fits; estimates not yet settled count as spent
export function overCap(user, brandId = null, more = 0) {
  const caps = readCaps(), limit = getWorkspace(current().ws)?.limit ?? null;
  if (limit == null && caps.total == null && caps.person == null && !Object.keys(caps.brands).length) return null;
  const list = all().filter(e => e.at.startsWith(monthOf()));
  const say = (what, cap, of, kind = 'cap', then = 'A budget owner can raise it on the Spend page.') => {
    const est = sum(of.filter(e => e.estimated));
    return `This would take ${what} past its monthly ${kind} of ${usd(cap)} (${usd(sum(of))} spent${est > 0 ? `, ${usd(est)} of it estimated` : ''}${more > 0 ? `, about ${usd(more)} more needed` : ''}). ${then}`;
  };
  if (limit != null && sum(list) + more > limit) return say('this workspace', limit, list, 'limit', 'The studio’s operators set this limit; ask them to raise it.');
  if (caps.total != null && sum(list) + more > caps.total) return say('the workspace', caps.total, list);
  const mine = list.filter(e => e.who === user?.email);
  if (caps.person != null && user && !user.guest && sum(mine) + more > caps.person) return say('your spending', caps.person, mine);
  const cap = brandId ? caps.brands[brandId] : null;
  const brand = brandId ? list.filter(e => e.brandId === brandId) : [];
  if (cap != null && sum(brand) + more > cap) return say('this product', cap, brand);
  return null;
}
