// Audit trail: an append-only record of who did what, one per workspace in <workspace>/governance/audit.jsonl, and one
// for the operators' own actions (workspaces created or changed) in <platform>/audit.jsonl. Each entry carries the hash
// of the entry before it in the same file, so a line removed or edited later breaks that chain, and verify says where.
// A workspace's chain holds only its own entries, so a customer can check theirs without seeing anyone else's.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PLATFORM, here } from './paths.mjs';
import { current } from './context.mjs';

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
const last = new Map();   // file → hash of its newest entry, read once
const fileHere = () => path.join(here().governance, 'audit.jsonl');
const PLATFORM_FILE = path.join(PLATFORM, 'audit.jsonl');

function lines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
}
function append(file, action, { target = null, detail = null, who, name } = {}) {
  if (!last.has(file)) last.set(file, lines(file).at(-1)?.hash || '');
  const u = current().user;
  const e = { at: new Date().toISOString(), who: who ?? u?.email ?? 'system', name: name ?? u?.name ?? null, action, target, detail, prev: last.get(file) };
  e.hash = sha(JSON.stringify(e));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(e) + '\n');
  last.set(file, e.hash);
  return e;
}
function verify(file) {
  let prev = '';
  const all = lines(file);
  for (const [i, e] of all.entries()) {
    const { hash, ...rest } = e;
    if (e.prev !== prev || sha(JSON.stringify(rest)) !== hash) return { ok: false, entries: all.length, brokenAt: i + 1 };
    prev = hash;
  }
  return { ok: true, entries: all.length };
}
// newest first; target matches exactly or as a prefix ("r-…" for one review)
const read = (file, { target, limit = 300 } = {}) => lines(file).filter(e => !target || e.target === target || String(e.target || '').startsWith(target)).reverse().slice(0, limit);

// record one action in this request's workspace; who defaults to the person behind the request
export const audit = (action, opts) => append(fileHere(), action, opts);
export const readAudit = opts => read(fileHere(), opts);
export const verifyAudit = () => verify(fileHere());
// the operators' trail
export const auditPlatform = (action, opts) => append(PLATFORM_FILE, action, opts);
export const readPlatformAudit = opts => read(PLATFORM_FILE, opts);
export const verifyPlatformAudit = () => verify(PLATFORM_FILE);
// a chain at a given path (the migration checks the old one before moving it)
export const verifyFile = verify;
