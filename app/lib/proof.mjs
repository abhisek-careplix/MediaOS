// Proof Library: the approved facts every asset may cite. Each entry is one claim with its source, owner, status,
// expiry and disclaimer, stored in <root>/proof/proof.json. Only approved, unexpired entries reach Claude.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ROOT } from './paths.mjs';

export const PROOF = process.env.VIDEOGEN_PROOF || path.join(ROOT, 'proof');
const FILE = path.join(PROOF, 'proof.json');
fs.mkdirSync(PROOF, { recursive: true });

const KINDS = ['stat', 'fact', 'quote'];
const SOURCES = ['study', 'internal', 'customer', 'regulatory', 'web'];
const STATUSES = ['draft', 'approved', 'retired'];
const bad = msg => Object.assign(new Error(msg), { code: 400 });

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function store(list) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
  fs.renameSync(tmp, FILE);
}

const today = () => new Date().toISOString().slice(0, 10);
export const isLive = e => e.status === 'approved' && (!e.expires || e.expires >= today());
// what the UI shows: approved but past its date counts as expired
export const stateOf = e => e.status === 'approved' && e.expires && e.expires < today() ? 'expired' : e.status;

export function listProof() {
  return load().map(e => ({ ...e, state: stateOf(e) })).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
}
export const liveProof = () => load().filter(isLive);

function clean(input, prev = {}) {
  const s = (v, n = 400) => String(v ?? '').trim().slice(0, n);
  const e = {
    claim: s(input.claim ?? prev.claim, 500),
    value: s(input.value ?? prev.value, 40),
    metric: s(input.metric ?? prev.metric, 80),
    kind: KINDS.includes(input.kind) ? input.kind : prev.kind || 'fact',
    source: {
      type: SOURCES.includes(input.source?.type) ? input.source.type : prev.source?.type || 'internal',
      title: s(input.source?.title ?? prev.source?.title, 300),
      url: s(input.source?.url ?? prev.source?.url, 500),
      citation: s(input.source?.citation ?? prev.source?.citation, 500),
      pmid: s(input.source?.pmid ?? prev.source?.pmid, 20),
    },
    disclaimer: s(input.disclaimer ?? prev.disclaimer, 300),
    tags: (Array.isArray(input.tags) ? input.tags : prev.tags || []).map(t => s(t, 30).toLowerCase()).filter(Boolean).slice(0, 12),
    owner: s(input.owner ?? prev.owner, 80),
    expires: /^\d{4}-\d{2}-\d{2}$/.test(input.expires ?? '') ? input.expires : input.expires === '' ? null : prev.expires ?? null,
    // a customer quote is a testimonial: it may only be used with the person's recorded consent
    consent: (() => {
      const c = input.consent === undefined ? prev.consent : input.consent;
      return c && /^\d{4}-\d{2}-\d{2}$/.test(c.on || '') ? { on: c.on, by: s(c.by, 120), where: s(c.where, 300) } : null;
    })(),
  };
  if (!e.claim) throw bad('A proof entry needs the claim itself.');
  if (e.source.url && !/^https?:\/\//.test(e.source.url)) throw bad('The source link must start with http:// or https://');
  return e;
}

export function addProof(input, by) {
  const list = load();
  const e = { id: 'p-' + crypto.randomBytes(4).toString('hex'), ...clean(input), status: 'draft', created: new Date().toISOString(), updated: new Date().toISOString(), createdBy: by || null, approvedBy: null };
  list.push(e);
  store(list);
  return { ...e, state: stateOf(e) };
}

export function updateProof(id, input, by) {
  const list = load(), i = list.findIndex(e => e.id === id);
  if (i < 0) throw Object.assign(new Error('no such proof entry'), { code: 404 });
  const prev = list[i];
  const next = { ...prev, ...clean(input, prev), updated: new Date().toISOString(), updatedBy: by || null };
  // changing what an approved entry says, or withdrawing consent, sends it back for approval
  if (prev.status === 'approved' && (['claim', 'value', 'metric'].some(k => next[k] !== prev[k]) || (prev.consent && !next.consent))) { next.status = 'draft'; next.approvedBy = null; }
  if (STATUSES.includes(input.status) && input.status !== next.status) {
    if (input.status === 'approved' && !next.source.title && !next.source.url) throw bad('Add a source before approving: a study, document, link or customer.');
    if (input.status === 'approved' && next.kind === 'quote' && next.source.type === 'customer' && !next.consent) throw bad('Record the customer’s consent (the date they agreed, and where it is kept) before approving their quote.');
    next.status = input.status;
    next.approvedBy = input.status === 'approved' ? by || 'local' : null;
    next.approvedAt = input.status === 'approved' ? new Date().toISOString() : null;
  }
  list[i] = next;
  store(list);
  return { ...next, state: stateOf(next) };
}

export function deleteProof(id) {
  const list = load(), next = list.filter(e => e.id !== id);
  if (next.length === list.length) throw Object.assign(new Error('no such proof entry'), { code: 404 });
  store(next);
}

// CSV import: claim,value,metric,kind,source_type,source_title,source_url,disclaimer,tags,owner,expires (header row required)
export function importCSV(text, by) {
  const rows = parseCSV(String(text || ''));
  if (rows.length < 2) throw bad('The CSV needs a header row and at least one entry.');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = name => head.indexOf(name);
  if (col('claim') < 0) throw bad('The CSV needs a "claim" column.');
  const added = [];
  for (const r of rows.slice(1)) {
    const g = n => (col(n) >= 0 ? r[col(n)] : '') || '';
    if (!g('claim').trim()) continue;
    added.push(addProof({
      claim: g('claim'), value: g('value'), metric: g('metric'), kind: g('kind') || (g('value') ? 'stat' : 'fact'),
      source: { type: g('source_type'), title: g('source_title'), url: g('source_url') },
      disclaimer: g('disclaimer'), tags: g('tags').split(/[;|]/).map(t => t.trim()), owner: g('owner'), expires: g('expires'),
    }, by));
  }
  return added;
}
function parseCSV(s) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

// PubMed via NCBI E-utilities (public, no key): search, then summaries with a ready citation
export async function searchPubMed(q, n = 8) {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
  const ids = (await (await fetch(`${base}esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${n}&term=${encodeURIComponent(q)}`)).json()).esearchresult?.idlist || [];
  if (!ids.length) return [];
  const sum = (await (await fetch(`${base}esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`)).json()).result || {};
  return ids.map(id => sum[id]).filter(Boolean).map(r => {
    const authors = (r.authors || []).map(a => a.name);
    const year = String(r.pubdate || '').slice(0, 4);
    return {
      pmid: r.uid, title: r.title, journal: r.fulljournalname || r.source, year, authors: authors.slice(0, 3).join(', ') + (authors.length > 3 ? ' et al.' : ''),
      url: `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`,
      citation: `${authors[0] || ''}${authors.length > 1 ? ' et al.' : ''} ${r.title} ${r.source} ${year}. PMID ${r.uid}.`.trim(),
    };
  });
}

// what Claude sees: only live entries, compact
export const proofForPrompt = () => liveProof().map(e => ({ id: e.id, claim: e.claim, value: e.value || undefined, metric: e.metric || undefined, kind: e.kind, source: e.source.title || e.source.url, disclaimer: e.disclaimer || undefined, tags: e.tags.length ? e.tags : undefined }));

// numbers in text that no cited live entry backs
// "given" is text the requester supplied themselves (the brief), whose numbers are theirs to use: "a 90-day pilot"
export function unsupportedNumbers(text, citedIds, given = '') {
  const live = liveProof().filter(e => citedIds.includes(e.id));
  const backing = (live.map(e => `${e.claim} ${e.value} ${e.metric}`).join(' ') + ' ' + given).toLowerCase().replace(/,/g, '');
  const nums = String(text || '').match(/(?:[$₹€£]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|x|×|k|m|bn|million|billion|crore|lakh)?/gi) || [];
  return [...new Set(nums.map(n => n.trim()))].filter(n => {
    const core = n.replace(/[$₹€£,\s]/g, '').toLowerCase();
    const digits = core.replace(/[^\d.]/g, '');
    // years, and bare single digits ("3 steps", "slide 2"), are not claims; "5%" or "$2" still are
    if (!digits || /^(19|20)\d\d$/.test(digits) || (/^\d$/.test(digits) && !/[%x×$₹€£]|k$|m$|bn|million|billion|crore|lakh/i.test(n))) return false;
    return !backing.includes(digits);
  });
}
