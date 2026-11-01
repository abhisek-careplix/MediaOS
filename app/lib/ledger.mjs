// Spend: every paid generation (writing, frames, video) recorded once in <governance>/ledger.jsonl, with who asked, for
// which product (brand kit) and which asset; and the monthly caps a budget owner sets, in caps.json. Work that would
// pass a cap is refused before it starts; a job already running finishes.
import fs from 'fs';
import path from 'path';
import { GOV } from './paths.mjs';
import { current } from './context.mjs';
import { audit } from './audit.mjs';

const FILE = path.join(GOV, 'ledger.jsonl'), CAPS = path.join(GOV, 'caps.json');
export const KINDS = { writer: 'Writing', image: 'Frames', video: 'Video', voice: 'Voice and sound', director: 'Directed films' };
const usd = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
export const monthOf = (d = new Date()) => new Date(d).toISOString().slice(0, 7);

let cache = { mtime: 0, list: [] };
function all() {
  try {
    const st = fs.statSync(FILE);
    if (st.mtimeMs !== cache.mtime) cache = { mtime: st.mtimeMs, list: fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) };
  } catch { cache = { mtime: 0, list: [] }; }
  return cache.list;
}

// record money spent; the person, product and asset come from the current request unless given
export function charge(kind, amount, extra = {}) {
  if (!(amount > 0)) return null;
  const c = current();
  const e = { at: new Date().toISOString(), who: extra.who ?? c.user?.email ?? 'system', name: c.user?.name ?? null, brandId: extra.brandId ?? c.brandId ?? null,
    asset: extra.asset ?? c.asset ?? null, kind: KINDS[kind] ? kind : 'writer', engine: extra.engine || null, amount: Math.round(amount * 1e4) / 1e4, note: extra.note || null };
  fs.mkdirSync(GOV, { recursive: true });
  fs.appendFileSync(FILE, JSON.stringify(e) + '\n');
  return e;
}

// a provider call's result ({ …, cost }), passed through once its cost is recorded
export const billed = (kind, r, extra) => { charge(kind, r?.cost, extra); return r; };

export function readCaps() {
  try { return { total: null, person: null, brands: {}, ...JSON.parse(fs.readFileSync(CAPS, 'utf8')) }; } catch { return { total: null, person: null, brands: {} }; }
}
export function writeCaps(input) {
  const num = v => v === '' || v == null ? null : Number.isFinite(+v) && +v >= 0 ? Math.round(+v * 100) / 100 : (() => { throw Object.assign(new Error('Caps are amounts in dollars, or empty for no cap.'), { code: 400 }); })();
  const prev = readCaps();
  const caps = { total: num(input.total), person: num(input.person), brands: Object.fromEntries(Object.entries(input.brands || {}).map(([k, v]) => [String(k).slice(0, 60), num(v)]).filter(([, v]) => v != null)) };
  fs.mkdirSync(GOV, { recursive: true });
  fs.writeFileSync(CAPS + '.tmp', JSON.stringify(caps, null, 1));
  fs.renameSync(CAPS + '.tmp', CAPS);
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
  const list = all().filter(e => e.at.startsWith(month));
  return {
    month, total: sum(list), count: list.length,
    byPerson: group(list, 'who', e => e.name || e.who), byBrand: group(list, 'brandId', e => e.brandId), byKind: group(list, 'kind', e => KINDS[e.kind] || e.kind),
    entries: list.slice(-300).reverse(), months: [...new Set(all().map(e => e.at.slice(0, 7)))].sort().reverse(),
  };
}

// why new spending of about `more` dollars would pass a monthly cap, or null when it fits
export function overCap(user, brandId = null, more = 0) {
  const caps = readCaps();
  if (caps.total == null && caps.person == null && !Object.keys(caps.brands).length) return null;
  const list = all().filter(e => e.at.startsWith(monthOf()));
  const say = (what, cap, spent) => `This would take ${what} past its monthly cap of ${usd(cap)} (${usd(spent)} spent${more > 0 ? `, about ${usd(more)} more needed` : ''}). A budget owner can raise it on the Spend page.`;
  const total = sum(list);
  if (caps.total != null && total + more > caps.total) return say('the studio', caps.total, total);
  const mine = sum(list.filter(e => e.who === user?.email));
  if (caps.person != null && user && !user.guest && mine + more > caps.person) return say('your spending', caps.person, mine);
  const cap = brandId ? caps.brands[brandId] : null;
  const brand = brandId ? sum(list.filter(e => e.brandId === brandId)) : 0;
  if (cap != null && brand + more > cap) return say('this product', cap, brand);
  return null;
}
