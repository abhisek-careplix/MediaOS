// Decks: Claude writes an outline, then the slides, citing only approved Proof Library entries.
// Checks flag unsupported numbers, stale proof, missing content and weak contrast before export.
import fs from 'fs';
import path from 'path';
import { APP, FILMS } from './paths.mjs';
import { askJSON } from './claude.mjs';
import { readBrand, ensureFont, BRANDS } from './brands.mjs';
import { liveProof, listProof, proofForPrompt, unsupportedNumbers } from './proof.mjs';
import { LAYOUTS, themeFrom, contrast, DEFAULT_THEME } from '../public/js/deck-render.js';
import { writePptx } from './pptx.mjs';
import { renderDeck } from './pdf.mjs';

const LAYOUT_IDS = LAYOUTS.map(l => l[0]);
export const AUDIENCES = {
  hospital: 'hospital and health-system buyers (clinical leaders, CMIO, operations)',
  insurer: 'insurers and payers (medical directors, care management, actuarial)',
  partner: 'partners and channel teams (device makers, platforms, distributors)',
  investor: 'investors (growth, market, traction, team)',
  general: 'a general business audience',
};
const bad = msg => Object.assign(new Error(msg), { code: 400 });

const LAYOUT_GUIDE = `Layouts and the fields each one uses:
- title: opening slide. title (the deck's promise, 3-9 words), body (one line of context), kicker (short label), footer (presenter or date, optional).
- agenda: title, bullets (3-6 short items).
- statement: one idea. title (an assertion, max ~14 words), bullets (2-4 short supporting points, each under 14 words) or body.
- bignumber: one figure. number.value (e.g. "92%"), number.label (what it measures), title (the takeaway), body (context).
- chart: title (the takeaway), chart {type column|bar|line|donut, unit, categories, series [{name, values}]}, optional number {value,label} and body for the side note.
- compare: title, left and right {label, value, points (2-4)}; right is the option you recommend.
- process: title, steps (3-5) {title, text}.
- quote: quote {text, name, role, org}.
- cards: title, cards (3-6) {title, text}: features, benefits, team or partners.
- closing: title (the ask or call to action), body (next step), footer (contact or URL).`;

const RULES = `Rules:
- One idea per slide. Titles are assertions people could repeat, not topics ("Missed apnea goes untreated" not "The problem").
- Every number, percentage, money amount, result, customer name or quote must come from the Proof Library below, worded faithfully, and that slide's "proof" must list the ids it relies on. Chart values must come from proof entries or from data in the brief.
- If nothing in the library supports a point, make it without numbers. Never invent statistics, customers, quotes, logos or certifications.
- Quotes only from proof entries of kind "quote".
- Speaker notes: 40-90 words per slide, in the presenter's voice, adding detail the slide leaves out (still only approved facts).
- Plain text only: no markdown, no emoji.`;

function proofBlock() {
  const p = proofForPrompt();
  return p.length ? `Proof Library (approved, citable):\n${JSON.stringify(p, null, 1)}` : 'Proof Library: empty. Use no numbers, statistics, customer names or quotes; make every point qualitatively.';
}
function brandLine(brand) {
  return brand ? `The deck is for ${brand.name}.${brand.tone ? ` Voice: ${brand.tone}.` : ''}` : '';
}

const str = { type: 'string' };
function slideSchema() {
  const ids = liveProof().map(e => e.id);
  return {
    type: 'object', additionalProperties: false, required: ['layout', 'title', 'notes', 'proof'],
    properties: {
      layout: { type: 'string', enum: LAYOUT_IDS }, kicker: str, title: str, body: str, footer: str, notes: str,
      bullets: { type: 'array', items: str, maxItems: 8 },
      number: { type: 'object', additionalProperties: false, required: ['value', 'label'], properties: { value: str, label: str } },
      chart: {
        type: 'object', additionalProperties: false, required: ['type', 'categories', 'series'],
        properties: { type: { type: 'string', enum: ['column', 'bar', 'line', 'donut'] }, unit: str, categories: { type: 'array', items: str, maxItems: 12 },
          series: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['name', 'values'], properties: { name: str, values: { type: 'array', items: { type: 'number' }, maxItems: 12 } } } } },
      },
      left: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: str, value: str, points: { type: 'array', items: str, maxItems: 4 } } },
      right: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: str, value: str, points: { type: 'array', items: str, maxItems: 4 } } },
      steps: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: { title: str, text: str } } },
      quote: { type: 'object', additionalProperties: false, required: ['text', 'name'], properties: { text: str, name: str, role: str, org: str } },
      cards: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: { title: str, text: str } } },
      proof: ids.length ? { type: 'array', items: { type: 'string', enum: ids }, maxItems: 6 } : { type: 'array', items: str, maxItems: 0 },
    },
  };
}

export async function writeOutline({ brief, audience = 'general', count = 8, brandId, model = 'sonnet' }) {
  if (!String(brief || '').trim()) throw bad('Write a brief first.');
  const brand = brandId ? readBrand(brandId) : null;
  const schema = {
    type: 'object', additionalProperties: false, required: ['title', 'slides'],
    properties: { title: str, slides: { type: 'array', minItems: 3, maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['layout', 'title', 'purpose'], properties: { layout: { type: 'string', enum: LAYOUT_IDS }, title: str, purpose: str } } } },
  };
  const prompt = `You are planning a ${count}-slide presentation for ${AUDIENCES[audience] || AUDIENCES.general}. ${brandLine(brand)}
Brief:
<brief>
${brief}
</brief>
Propose the storyline: exactly ${count} slides, a title slide first and a closing slide last. For each slide give the layout, a working title (an assertion), and its purpose in one sentence. Choose number, chart, compare or quote layouts only where the Proof Library or the brief supplies the facts.
${LAYOUT_GUIDE}
${proofBlock()}`;
  const { data, cost } = await askJSON(prompt, schema, { model });
  return { ...data, cost };
}

export async function writeDeck({ brief, audience = 'general', outline, brandId, model = 'sonnet' }) {
  if (!outline?.slides?.length) throw bad('The deck needs an outline.');
  const brand = brandId ? readBrand(brandId) : null;
  const schema = { type: 'object', additionalProperties: false, required: ['title', 'slides'], properties: { title: str, slides: { type: 'array', minItems: 1, maxItems: 16, items: slideSchema() } } };
  const prompt = `You are writing a presentation for ${AUDIENCES[audience] || AUDIENCES.general}. ${brandLine(brand)}
Brief:
<brief>
${brief}
</brief>
Follow this outline exactly: the same number of slides, in this order, with these layouts (if a slide's layout cannot be filled with approved facts, use "statement" instead):
${JSON.stringify(outline.slides.map((s, i) => ({ n: i + 1, layout: s.layout, title: s.title, purpose: s.purpose })), null, 1)}
${LAYOUT_GUIDE}
${RULES}
${proofBlock()}`;
  const { data, cost } = await askJSON(prompt, schema, { model, timeout: 300000 });
  return { deck: { title: data.title || outline.title, audience, brief, brandId: brandId || null, slides: data.slides.map(normalize) }, cost };
}

export async function rewriteSlide({ deck, index, instruction, model = 'sonnet' }) {
  const brand = deck.brandId ? readBrand(deck.brandId) : null;
  const cur = deck.slides[index];
  if (!cur) throw bad('No such slide.');
  const prompt = `You are revising slide ${index + 1} of a presentation for ${AUDIENCES[deck.audience] || AUDIENCES.general}. ${brandLine(brand)}
Deck title: ${deck.title}
All slide titles, for context: ${deck.slides.map((s, i) => `${i + 1}. ${s.title}`).join(' | ')}
Current slide:
${JSON.stringify(cur)}
Requested change: ${instruction || 'Make it sharper and more persuasive.'}
Return the revised slide. Keep layout "${cur.layout}" unless the request asks for another.
${LAYOUT_GUIDE}
${RULES}
${proofBlock()}`;
  const { data, cost } = await askJSON(prompt, slideSchema(), { model });
  return { slide: normalize(data), cost };
}

export function normalize(s) {
  const out = { layout: LAYOUT_IDS.includes(s.layout) ? s.layout : 'statement', title: String(s.title || ''), notes: String(s.notes || ''), proof: Array.isArray(s.proof) ? s.proof : [] };
  for (const k of ['kicker', 'body', 'footer']) if (s[k]) out[k] = String(s[k]);
  for (const k of ['bullets', 'steps', 'cards']) if (Array.isArray(s[k]) && s[k].length) out[k] = s[k];
  for (const k of ['number', 'chart', 'left', 'right', 'quote']) if (s[k] && typeof s[k] === 'object') out[k] = s[k];
  return out;
}

// —— checks ——
const textOf = s => [s.kicker, s.title, s.body, s.footer, ...(s.bullets || []), s.number?.value, s.number?.label,
  ...(s.steps || []).flatMap(x => [x.title, x.text]), ...(s.cards || []).flatMap(x => [x.title, x.text]),
  ...['left', 'right'].flatMap(k => [s[k]?.value, ...(s[k]?.points || [])]), s.quote?.text, s.notes].filter(Boolean).join(' \n ');

export function checkDeck(deck) {
  const issues = [], all = Object.fromEntries(listProof().map(e => [e.id, e]));
  deck.slides.forEach((s, i) => {
    const add = (level, message) => issues.push({ slide: i, level, message });
    for (const id of s.proof || []) {
      const e = all[id];
      if (!e) add('error', `Cites a proof entry that no longer exists (${id}).`);
      else if (e.state !== 'approved') add('error', `Cites “${e.claim.slice(0, 60)}…”, which is ${e.state}.`);
    }
    const nums = unsupportedNumbers(textOf(s) + ' ' + (s.chart?.series || []).flatMap(x => x.values).join(' '), s.proof || [], deck.brief || '');
    if (nums.length) add('error', `Numbers without approved proof: ${nums.slice(0, 6).join(', ')}. Cite a Proof entry or remove them.`);
    const need = { bignumber: !s.number?.value && 'a number', chart: !(s.chart?.categories?.length && s.chart?.series?.some(x => x.values?.length)) && 'chart data',
      compare: !(s.left?.value && s.right?.value) && 'both sides', quote: !s.quote?.text && 'a quote', process: (s.steps || []).length < 2 && 'at least two steps',
      cards: (s.cards || []).length < 2 && 'at least two cards', agenda: (s.bullets || []).length < 2 && 'at least two items' }[s.layout];
    if (need) add('error', `This ${s.layout} slide needs ${need}.`);
    if (s.layout === 'chart' && s.chart?.series?.some(x => x.values?.length !== s.chart.categories?.length)) add('warn', 'Chart series and categories have different lengths.');
    if (s.layout === 'quote' && s.quote?.text && !(s.proof || []).some(id => all[id]?.kind === 'quote')) add('error', 'The quote is not from an approved customer-quote entry.');
    if (!s.notes?.trim()) add('warn', 'No speaker notes.');
  });
  const th = themeOf(deck), c = th.colors;
  const cr = [['Text on background', contrast(c.ink, c.bg), 4.5], ['Secondary text on background', contrast(c.muted, c.bg), 4.5], ['Accent on background', contrast(c.accent, c.bg), 3], ['Closing slide text', contrast(c.bg, c.ink), 4.5]];
  for (const [name, r, need] of cr) if (r < need) issues.push({ slide: null, level: r < 3 ? 'error' : 'warn', message: `${name}: contrast ${r.toFixed(1)}:1 (needs ${need}:1). Adjust the brand kit.` });
  return issues;
}

export function themeOf(deck) {
  const b = deck.brandId ? readBrand(deck.brandId) : null;
  return b ? themeFrom({ name: b.name, colors: b.colors, fonts: b.fonts, logo: b.logo ? `/brands/${b.id}/${b.logo}` : null }) : DEFAULT_THEME;
}

// —— storage (deck folders live beside films, so the Library lists them) ——
export const deckFile = dir => path.join(dir, 'deck.json');
export function readDeck(dir) { return JSON.parse(fs.readFileSync(deckFile(dir), 'utf8')); }
export function saveDeck(dir, deck) {
  if (!Array.isArray(deck.slides) || !deck.slides.length) throw bad('A deck needs at least one slide.');
  const clean = { title: String(deck.title || 'Untitled deck').slice(0, 120), audience: deck.audience || 'general', brief: deck.brief || '', brandId: deck.brandId || null, slides: deck.slides.map(normalize) };
  fs.writeFileSync(deckFile(dir), JSON.stringify(clean, null, 1));
  return clean;
}
export function sampleDeck() {
  return JSON.parse(fs.readFileSync(path.join(APP, 'templates', 'sample-deck.json'), 'utf8'));
}

// —— exports ——
export async function exportDeck(dir, deck, kinds = ['pptx', 'pdf'], { draft = false } = {}) {
  const brand = deck.brandId ? readBrand(deck.brandId) : null;
  // logo: a marker so layouts reserve its place; renderDeck prepares the real one, and PowerPoint uses what it made
  const theme = brand ? themeFrom({ name: brand.name, colors: brand.colors, fonts: brand.fonts, logo: brand.logo ? 'logo' : null }) : DEFAULT_THEME;
  if (brand) await Promise.all([ensureFont(brand.fonts.display), ensureFont(brand.fonts.body)]);
  else await ensureFont('Inter');
  const proof = Object.fromEntries(listProof().map(e => [e.id, e]));
  const slug = (deck.title || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'deck';
  const logoFile = brand?.logo ? path.join(BRANDS, brand.id, brand.logo) : null;
  const out = {};
  const r = await renderDeck(deck, theme, { proof, logoFile, draft, pdfFile: kinds.includes('pdf') ? path.join(dir, slug + '.pdf') : null, posterFile: path.join(dir, 'poster.jpg') });
  if (kinds.includes('pdf')) out.pdf = slug + '.pdf';
  if (kinds.includes('pptx')) {
    await writePptx(deck, r.theme, { proof, logos: r.logos, draft, file: path.join(dir, slug + '.pptx') });
    out.pptx = slug + '.pptx';
  }
  return out;
}

// —— the same story as a film script for the instant templates ——
export function deckToScript(deck, template) {
  const words = (t, n) => String(t || '').split(/\s+/).filter(Boolean).slice(0, n).join(' ');
  // whole sentences only, up to about n words: a film scene can't speak a full set of speaker notes
  const sentences = (t, n) => {
    const all = String(t || '').match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [];
    let out = '';
    for (const x of all) {
      const next = (out + ' ' + x).trim();
      if (out && next.split(/\s+/).length > n) break;
      out = next;
    }
    return out.split(/\s+/).length > n * 1.5 ? words(out, n).replace(/[,;:]?$/, '.') : out;
  };
  const scenes = deck.slides.map((s, i) => {
    const narration = sentences(s.notes || s.body || s.title, 28);
    const base = { kicker: s.kicker || '', narration };
    switch (s.layout) {
      case 'title': return { ...base, type: 'title', text: s.title, sub: s.body || '' };
      case 'closing': return { ...base, type: 'end', text: s.title, sub: s.body || s.footer || '' };
      case 'bignumber': return { ...base, type: 'number', number: s.number?.value || '', unit: s.number?.label || '', text: s.title };
      case 'chart': return s.number?.value ? { ...base, type: 'number', number: s.number.value, unit: s.number.label || '', text: s.title } : { ...base, type: 'statement', text: s.title, sub: s.body || '' };
      case 'compare': return { ...base, type: 'compare', text: s.title, left: { label: s.left?.label || '', value: s.left?.value || '' }, right: { label: s.right?.label || '', value: s.right?.value || '' } };
      case 'agenda': return { ...base, type: 'list', text: s.title, items: (s.bullets || []).slice(0, 5) };
      case 'process': return { ...base, type: 'list', text: s.title, items: (s.steps || []).map(x => x.title).slice(0, 5) };
      case 'cards': return { ...base, type: 'list', text: s.title, items: (s.cards || []).map(x => x.title).slice(0, 5) };
      case 'quote': return { ...base, type: 'statement', text: words(s.quote?.text, 14), sub: [s.quote?.name, s.quote?.org].filter(Boolean).join(', ') };
      default: return { ...base, type: 'statement', text: s.title, sub: (s.bullets || [])[0] || s.body || '' };
    }
  });
  if (scenes[0]?.type !== 'title') scenes.unshift({ type: 'title', text: deck.title, kicker: '', sub: '', narration: '' });
  if (scenes[scenes.length - 1]?.type !== 'end') scenes.push({ type: 'end', text: deck.title, kicker: '', sub: '', narration: '' });
  return { title: deck.title, bpm: template === 'keynote' ? 104 : 112, scenes };
}

export const isDeckDir = dir => fs.existsSync(deckFile(dir));
export { FILMS };
