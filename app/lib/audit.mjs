// Audit trail: an append-only record of who did what, in <governance>/audit.jsonl. Each entry carries the hash of the
// entry before it, so a line removed or edited later breaks the chain, and verifyAudit() says where.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GOV } from './paths.mjs';
import { current } from './context.mjs';

const FILE = path.join(GOV, 'audit.jsonl');
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
let last = null;   // hash of the newest entry, read once

function lines() {
  try { return fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
}

// record one action; who defaults to the person behind the current request
export function audit(action, { target = null, detail = null, who, name } = {}) {
  if (last === null) last = lines().at(-1)?.hash || '';
  const u = current().user;
  const e = { at: new Date().toISOString(), who: who ?? u?.email ?? 'system', name: name ?? u?.name ?? null, action, target, detail, prev: last };
  e.hash = sha(JSON.stringify(e));
  fs.mkdirSync(GOV, { recursive: true });
  fs.appendFileSync(FILE, JSON.stringify(e) + '\n');
  last = e.hash;
  return e;
}

// newest first; target matches exactly or as a prefix ("r-…" for one review)
export function readAudit({ target, limit = 300 } = {}) {
  return lines().filter(e => !target || e.target === target || String(e.target || '').startsWith(target)).reverse().slice(0, limit);
}

export function verifyAudit() {
  let prev = '';
  const all = lines();
  for (const [i, e] of all.entries()) {
    const { hash, ...rest } = e;
    if (e.prev !== prev || sha(JSON.stringify(rest)) !== hash) return { ok: false, entries: all.length, brokenAt: i + 1 };
    prev = hash;
  }
  return { ok: true, entries: all.length };
}
