// Claims check: before anyone signs off, every claim, testimonial and piece of health wording in a version is matched
// against the Proof Library. The AI reads the version's words the way a medical, legal and regulatory reviewer would;
// then the rules are applied here, not left to it: a claim is backed only by a live entry, a testimonial only by a
// customer quote with recorded consent, and any number no cited entry backs is flagged even if the AI missed it.
import crypto from 'crypto';
import { askJSON } from './claude.mjs';
import { listProof, isLive, unsupportedNumbers } from './proof.mjs';

// keys that hold layout, files or settings rather than words an audience sees or hears
const SKIP = new Set(['type', 'layout', 'board', 'clip', 'clipDur', 'src', 'image', 'images', 'size', 'move', 'engine', 'icon', 'color', 'accent', 'font', 'align', 'id', 'kind',
  'shape', 'transition', 'camera', 'voice', 'speaker', 'box', 'fit', 'mood', 'style', 'proof', 'bg', 'background', 'theme', 'logo', 'media', 'brand', 'n', 'dur', 'bpm', 'template']);
const looksLikeWords = s => /[a-z]{2}/i.test(s) && !/^[\w./-]+\.(png|jpe?g|svg|webp|mp4|webm|wav|json)$/i.test(s) && !/^#[0-9a-f]{3,8}$/i.test(s);
// where a line sits, the way a reviewer would say it
const PLACE = { text: 'on screen', narration: 'voice-over', vo: 'voice-over', super: 'on screen', sub: 'subtitle', kicker: 'kicker', title: 'title', body: 'body', bullets: 'bullet', label: 'label', value: 'number', quote: 'quote', who: 'attribution', cta: 'call to action' };
const at = (where, key) => key ? `${where} · ${PLACE[key] || key}` : where;
function words(v, where, out, key = '') {
  if (SKIP.has(key)) return;
  if (typeof v === 'string') { if (v.trim() && looksLikeWords(v)) out.push({ where: at(where, key), text: v.trim() }); }
  else if (typeof v === 'number' && key && !SKIP.has(key)) out.push({ where: at(where, key), text: String(v) });
  else if (Array.isArray(v)) v.forEach(x => words(x, where, out, key));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) words(x, where, out, k);
}
// the words of a film (content.json) or a deck (deck.json), as [{ where, text }]
export function linesOfFilm(content) {
  const out = content.title ? [{ where: 'Title', text: content.title }] : [];
  (content.scenes || []).forEach((s, i) => words(s, `Scene ${i + 1}`, out));
  return out;
}
export function linesOfDeck(deck) {
  const out = deck.title ? [{ where: 'Title', text: deck.title }] : [];
  (deck.slides || []).forEach((s, i) => { words({ ...s, notes: undefined }, `Slide ${i + 1}`, out); if (s.notes) out.push({ where: `Slide ${i + 1} · speaker notes`, text: s.notes }); });
  return out;
}

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
// what an entry says and whether it may be used, so a later change to it can be noticed
export const fingerprint = e => ({ id: e.id, claim: e.claim, value: e.value || '', hash: sha([e.claim, e.value, e.metric, e.status, e.expires, e.disclaimer, e.consent?.on].join('\u0001')) });
export const consented = e => e.kind === 'quote' && e.source?.type === 'customer' && !!e.consent?.on;

// entries a version relied on that have since changed, been retired, expired or deleted
export function proofDrift(prints = []) {
  const now = new Map(listProof().map(e => [e.id, e]));
  return prints.flatMap(fp => {
    const e = now.get(fp.id);
    if (!e) return [{ id: fp.id, claim: fp.claim, why: 'deleted from the Proof Library' }];
    if (!isLive(e)) return [{ id: fp.id, claim: fp.claim, why: e.state === 'expired' ? 'expired' : 'no longer approved' }];
    if (fingerprint(e).hash !== fp.hash) return [{ id: fp.id, claim: fp.claim, why: 'its wording or terms changed' }];
    return [];
  });
}

// given: text the requester supplied themselves (a deck's brief), whose numbers are theirs to use ("a 90-day pilot")
export async function runChecks(lines, { cited = [], given = '', model = 'sonnet' } = {}) {
  const live = listProof().filter(isLive);
  const prompt = `You are pre-reviewing a US health-and-wellness advertisement for the company's medical, legal and regulatory (MLR) reviewers.
Below are (1) the approved Proof Library: the only claims the company may make, and (2) every line of words in the ad, numbered.

Find, in the ad's lines:
- claim: any statement of fact a regulator could ask to substantiate: numbers, accuracy, speed, results, health outcomes or benefits, "clinically proven", "trusted by", comparisons with others, "FDA" anything. Not slogans, greetings, product names, calls to action or plain descriptions of what the product is.
- testimonial: a quote, review, or first-person experience presented as coming from a customer, patient, clinician or other person.
- health: wording that asserts or implies the company knows the viewer's health condition (for example "your high blood pressure", "Do you have AFib?"), or that implies diagnosis, treatment or cure where the product is a wellness product.

For each item: line (its number), quote (the exact words from that line, short), type, proof (the id of the ONE Proof Library entry that supports it exactly as worded, or "" when none does: a looser or different claim does not count), and note (one short sentence for the reviewer: what the problem is, or which entry backs it). Set verdict to backed, unbacked, needs-consent or wording; the system re-checks it.
Be thorough but do not invent problems: lines with no claim, testimonial or health wording produce no items.

PROOF LIBRARY (live entries):
${JSON.stringify(live.map(e => ({ id: e.id, claim: e.claim, value: e.value || undefined, metric: e.metric || undefined, kind: e.kind, source: e.source?.type, consent: e.kind === 'quote' ? !!e.consent?.on : undefined })))}

AD LINES:
${lines.map((l, i) => `${i}. [${l.where}] ${l.text}`).join('\n')}`;
  const schema = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', maxItems: 60, items: {
    type: 'object', additionalProperties: false, required: ['line', 'quote', 'type', 'proof', 'verdict', 'note'],
    properties: { line: { type: 'integer' }, quote: { type: 'string' }, type: { type: 'string', enum: ['claim', 'testimonial', 'health'] }, proof: { type: 'string' },
      verdict: { type: 'string', enum: ['backed', 'unbacked', 'needs-consent', 'wording'] }, note: { type: 'string' } } } } } };
  const { data, cost } = lines.length ? await askJSON(prompt, schema, { model, timeout: 300000 }) : { data: { items: [] }, cost: 0 };
  const byId = new Map(live.map(e => [e.id, e]));
  const items = data.items.filter(i => lines[i.line]).map(i => {
    // backed only when the reading says so AND names a live entry (and, for a testimonial, one with consent)
    const p = byId.get(i.proof) || null, agrees = i.verdict === 'backed';
    const verdict = i.type === 'health' ? 'wording' : i.type === 'testimonial' ? (p && agrees && consented(p) ? 'backed' : 'needs-consent') : p && agrees ? 'backed' : 'unbacked';
    return { where: lines[i.line].where, quote: String(i.quote).slice(0, 300), type: i.type, proof: verdict === 'backed' ? p.id : null, verdict, note: String(i.note).slice(0, 300) };
  });
  // numbers no cited entry backs, which the reading above did not already flag
  const backing = [...new Set([...cited.filter(id => byId.has(id)), ...items.map(i => i.proof).filter(Boolean)])];
  for (const l of lines) for (const n of unsupportedNumbers(l.text, backing, given)) {
    if (!items.some(i => i.where === l.where && i.quote.includes(n)))
      items.push({ where: l.where, quote: n, type: 'claim', proof: null, verdict: 'unbacked', note: 'A number with no approved proof behind it.', auto: true });
  }
  items.forEach(i => { i.key = sha(`${i.where}\u0001${i.quote}`); });
  return { items, proofs: backing.map(id => fingerprint(byId.get(id))), cost, ranAt: new Date().toISOString() };
}
