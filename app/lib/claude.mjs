// Claude through the Claude Code CLI (uses your `claude` login, or ANTHROPIC_API_KEY when set).
//  writeScript: quick mode, one structured-output call that returns a scene script for a template.
//  runDirector: director mode, a headless run of the lemo-opuscar skill that directs, builds and renders a full film.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { emit, readMeta, writeMeta } from './jobs.mjs';
import { LIB } from './paths.mjs';
import { TEMPLATES, VOICES } from './templates.mjs';
import { FONT_LIST, PRESETS } from './brands.mjs';
import { authOn } from './auth.mjs';

// Deployed, Claude gets only what it needs: never the session secret or the Google client secret.
const KEEP = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'LEMO_OPUSCAR_HOME', 'HF_ENDPOINT', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'];
const childEnv = () => authOn() ? Object.fromEntries(KEEP.filter(k => process.env[k] != null).map(k => [k, process.env[k]])) : process.env;

const CLAUDE = process.env.CLAUDE_BIN || 'claude';
// people see plain wording, never a provider's name; the setup hint for whoever runs the server goes to the log
const plain = msg => String(msg).replace(/\bclaude code\b/gi, 'the AI writer').replace(/\bclaude\b/gi, 'the AI writer').replace(/\banthropic\b/gi, 'the AI provider');
function notSignedIn() {
  console.error('[ai] Claude Code is not signed in: run `claude auth login` (or set ANTHROPIC_API_KEY), then try again.');
  return new Error('The AI writer isn’t signed in on this server. Ask whoever runs it to sign it in.');
}

// photos: how many product photos the brief carries (product scenes show them by index); every scene needs ~4 s to
// land, so a 15-second cut gets at most 4 scenes and a fast tempo
function scriptSchema(tpl, photos = 0, seconds = 30, kind = 'film') {
  const short = seconds <= 15, quick = kind !== 'film' && seconds <= 20;
  const str = { type: 'string' };
  const side = { type: 'object', properties: { label: str, value: str }, required: ['label', 'value'], additionalProperties: false };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'accent', 'bpm', 'scenes'],
    properties: {
      title: str,
      accent: { type: 'string', enum: tpl.accents },
      bpm: { type: 'integer', minimum: quick ? 120 : 84, maximum: 132 },
      scenes: {
        type: 'array',
        minItems: 3,
        maxItems: short ? 4 : 10,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'text', 'narration'],
          properties: {
            type: { type: 'string', enum: ['title', 'statement', 'number', 'list', 'compare', ...(photos ? ['product'] : []), 'end'] },
            ...(photos ? { image: { type: 'integer', minimum: 0, maximum: photos - 1 } } : {}),
            kicker: str, text: str, sub: str, emphasis: str, number: str, unit: str,
            items: { type: 'array', items: str, minItems: 2, maxItems: 5 },
            left: side, right: side, narration: str,
          },
        },
      },
    },
  };
}

// what each format asks of the script, on top of the scene rules
export const KIND = {
  film: { what: 'short film', rules: '' },
  ad: { what: 'paid social video ad (Meta and TikTok)', rules: `
- It is an ad: the first scene is the hook. Its text must stop the scroll in under two seconds (a sharp benefit, a surprising fact the user gave, or a tension), not the brand name or a generic welcome.
- One message only. If there are product photos, show the product by the second scene.
- The end scene is the call to action: text = the offer or next step, sub = the action (for example "Download the app" or the website) taken from the user's brief when they give one.
- Ad platform rules: never assert or imply the viewer's personal traits or health conditions ("Do you have…", "Your diabetes…", "Struggling with your weight?"); speak about the product or about people in general. No guaranteed or exaggerated health outcomes, no before/after framing, no "cure", "treat" or "prevent" claims unless the user's own brief states them as cleared.` },
  reel: { what: 'vertical short-form reel (Instagram Reels, TikTok, YouTube Shorts)', rules: `
- It is a reel: the first scene is the hook and must land in under two seconds. Fast pace: more, shorter scenes; conversational, spoken-style narration, as if a person is talking to camera.
- If there are product photos, show the product early and more than once if it helps.
- End with a light call to action in the end scene (follow, learn more, or the brief's own next step).
- Never assert or imply the viewer's personal traits or health conditions; no guaranteed health outcomes.` },
};

function scriptPrompt({ prompt, tpl, seconds, aspect, narration, brand, kind = 'film', photos = [], refs = [], notes = '' }) {
  // each scene adds about a second of lead-in and pause around its line; short cuts can't afford to ignore that
  const words = Math.round((seconds <= 20 ? seconds - 4.5 : seconds) * 2.4), K = KIND[kind] || KIND.film;
  return `You are the writer-director of a ${seconds}-second ${aspect === '9:16' ? 'vertical (9:16)' : 'widescreen (16:9)'} ${K.what} rendered in code in the "${tpl.name}" style.
Style: ${tpl.brief}
${brand ? `The film is for the brand "${brand.name}"; it is drawn in the brand's own colours, type and logo.${brand.tone ? ` Brand voice: ${brand.tone}.` : ''} Write in that voice; the closing card can carry the brand's name or line.\n` : ''}
The user's request:
"""
${prompt}
"""
${photos.length ? `
The user attached ${photos.length} product photo${photos.length > 1 ? 's' : ''}: ${photos.map((p, i) => `${p} (image ${i})`).join(', ')}. Open each one with the Read tool and look at it before you write. Product scenes show them on screen. Describe only what you can see in a photo or what the user told you; never invent features, specifications or results.
` : ''}${refs.length ? `
The user also attached ${refs.length} reference image${refs.length > 1 ? 's' : ''}: ${refs.join(', ')}. Open them with the Read tool too. They are NOT shown in the film: use them to understand the product, the audience, the tone or the kind of ${K.what} the user wants (for example an example ad, a landing page or a brand guide). Never copy another brand's wording or claims from them.
` : ''}${notes ? `
Reference notes from the user (facts and details you may use):
"""
${notes}
"""
` : ''}
Write the film as a scene script. Scene types and the fields each one uses:
- title: the opening card. text = film title (2-6 words), kicker = a short label, sub = one line of context.
- statement: one idea per screen. text = headline (max ~9 words), kicker = short label, sub = one supporting sentence (optional)${tpl.id === 'keynote' ? ', emphasis = one or two words from the headline to light in the accent colour' : ''}.
- number: one big figure. number = the figure as it should appear ("240%", "$4.2M", "1,200"), unit = 1-3 words under it, text = what it measures (short), kicker = short label.
- list: text = heading, items = 2-5 short items (max ~5 words each), kicker = short label.
- compare: text = heading, left/right = { label, value } (values short, ideally numbers in the same unit so bars can be compared; right is the hero), kicker = short label.
- end: the closing card. text = a short closing line (2-6 words), sub = optional call to action or sign-off, kicker = short label.
${photos.length ? `- product: shows one product photo with a headline beside it. image = which photo (0-based, as numbered above), text = headline (max ~7 words), kicker = short label, sub = one supporting line (optional), items = 2-3 short callouts about what the photo shows (max ~5 words each, optional).
` : ''}
Rules:
${K.rules ? K.rules.trim() + '\n' : ''}- Start with a title scene and finish with an end scene. ${seconds <= 15 ? '3-4' : seconds <= 20 ? '4-5' : seconds <= 35 ? '5-7' : '7-9'} scenes in total${seconds <= 15 ? ' (every scene needs about 4 seconds to land, so keep it tight and give product scenes at most 2 callouts)' : ''}. Vary the types; a story arc, not a slide deck.
- ${narration ? `narration: the spoken line for each scene, ${words} words in total across the film (about 2.4 words per second), natural spoken English, one or two short sentences per scene; write numbers as they should be read aloud only when digits would be ambiguous.` : 'narration: one short line per scene (used as on-screen captions).'}
- On-screen text is short and punchy; narration carries the detail and must not just repeat the on-screen text word for word.
- Facts: only use figures the user gave or that are well established and widely reported. If unsure of a figure, use a statement scene instead of a number or compare scene. Never invent precise statistics.
- accent: pick the accent colour that suits the topic. bpm: tempo of the score (84-132), faster for energetic topics.
- Keep every string plain text: no markdown, no emoji, no quotes around values.`;
}

function runClaude(args, { cwd, timeout = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(CLAUDE, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('The AI writer took too long to answer. Try again.')); }, timeout);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); if (e.code === 'ENOENT') console.error('[ai] The `claude` command was not found: brew install --cask claude-code');
      reject(e.code === 'ENOENT' ? new Error('The AI writer isn’t installed on this server.') : e); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

// one structured-output call: returns the object matching schema, or throws with a readable reason
// files: [{ src, name }] copied into Claude's empty working folder; with any, Claude gets the Read tool to look at them
export async function askJSON(prompt, schema, { model = 'sonnet', timeout = 240000, files = [] } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'videogen-'));
  try {
    for (const f of files) fs.copyFileSync(f.src, path.join(cwd, path.basename(f.name)));
    const { out, err } = await runClaude(['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--model', model,
      '--tools', files.length ? 'Read' : '', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'], { cwd, timeout });
    let res;
    try { res = JSON.parse(out); } catch { throw new Error(plain((err || out || 'The AI writer returned nothing. Try again.').trim().slice(0, 400))); }
    if (res.is_error) {
      const msg = String(res.result || res.subtype || 'error');
      throw /log ?in/i.test(msg) ? notSignedIn() : new Error(plain(msg));
    }
    let obj = res.structured_output;
    if (!obj && typeof res.result === 'string') { const m = res.result.match(/\{[\s\S]*\}/); if (m) obj = JSON.parse(m[0]); }
    if (!obj) throw new Error('The AI writer’s answer was incomplete. Try again.');
    return { data: obj, cost: res.total_cost_usd, ms: res.duration_ms };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

// media / refs: image files (product photos to show, reference images to read); Claude gets only the Read tool, and
// only these copies in a fresh folder to read
export async function writeScript({ prompt, template, seconds = 30, aspect = '16:9', narration = true, model = 'sonnet', brand = null, kind = 'film', media = [], refs = [], notes = '' }) {
  const tpl = TEMPLATES[template];
  if (!tpl) throw new Error('unknown template ' + template);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'videogen-'));
  try {
    const copy = (files, stem) => files.map((f, i) => { const name = `./${stem}-${i + 1}${path.extname(f)}`; fs.copyFileSync(f, path.join(cwd, name)); return name; });
    const photos = copy(media, 'product'), looks = copy(refs, 'reference');
    const args = ['-p', scriptPrompt({ prompt, tpl, seconds, aspect, narration, brand, kind, photos, refs: looks, notes }),
      '--output-format', 'json', '--json-schema', JSON.stringify(scriptSchema(tpl, photos.length, seconds, kind)), '--model', model,
      '--tools', photos.length || looks.length ? 'Read' : '', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'];
    const { out, err } = await runClaude(args, { cwd, timeout: photos.length || looks.length ? 420000 : 300000 });
    let res;
    try { res = JSON.parse(out); } catch { throw new Error(plain((err || out || 'The AI writer returned nothing. Try again.').trim().slice(0, 400))); }
    if (res.is_error) {
      const msg = String(res.result || res.subtype || 'error');
      throw /log ?in/i.test(msg) ? notSignedIn() : new Error(plain(msg));
    }
    let script = res.structured_output;
    if (!script && typeof res.result === 'string') {
      const m = res.result.match(/\{[\s\S]*\}/);
      if (m) script = JSON.parse(m[0]);
    }
    if (!script?.scenes?.length) throw new Error('The AI writer didn’t return a script. Try again.');
    for (const s of script.scenes) if (s.type === 'product' && !(s.image >= 0 && s.image < photos.length)) s.image = 0;
    return { script, cost: res.total_cost_usd, ms: res.duration_ms };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

// —— brand kits: a palette, a type pairing, a narrator and a tone from a description ——
export async function writeBrand({ prompt, model = 'sonnet' }) {
  const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
  const families = FONT_LIST.map(f => f.family);
  const schema = {
    type: 'object', additionalProperties: false, required: ['name', 'tone', 'colors', 'fonts', 'voice'],
    properties: {
      name: { type: 'string' }, tone: { type: 'string' },
      colors: { type: 'object', additionalProperties: false, required: ['bg', 'surface', 'ink', 'muted', 'accent'], properties: { bg: hex, surface: hex, ink: hex, muted: hex, accent: hex } },
      fonts: { type: 'object', additionalProperties: false, required: ['display', 'body'], properties: { display: { type: 'string', enum: families }, body: { type: 'string', enum: families } } },
      voice: { type: 'string', enum: VOICES.map(v => v[0]) },
    },
  };
  const examples = PRESETS.slice(0, 4).map(p => `- ${p.name} (${p.tone}): ${JSON.stringify(p.colors)}, display ${p.fonts.display}, body ${p.fonts.body}`).join('\n');
  const text = `You are a brand designer. Design a brand kit for short films from this description:
<description>
${prompt}
</description>
Return a name (the brand's name if the description gives one, else a short evocative theme name), a one-sentence tone of voice for narration, five colours and a type pairing.
Colour roles: bg = the stage or page behind everything; surface = cards and panels, a small step from bg; ink = primary text, at least 7:1 contrast on bg; muted = secondary text, at least 4.5:1 on bg; accent = the one signature colour for highlights, big numbers and the logo moment, at least 3:1 on bg and clearly saturated.
Fonts come only from this list: ${families.join(', ')}. Pair a characterful display face with a highly readable body face (they may be the same family).
Voice is a narrator id: ${VOICES.map(([id, n]) => `${id} = ${n}`).join('; ')}.
Reference themes for the format:
${examples}`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'videogen-'));
  try {
    const { out, err } = await runClaude(['-p', text, '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--model', model,
      '--tools', '', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'], { cwd, timeout: 120000 });
    let res;
    try { res = JSON.parse(out); } catch { throw new Error(plain((err || out || 'The AI writer returned nothing. Try again.').trim().slice(0, 300))); }
    if (res.is_error) throw /log ?in/i.test(String(res.result)) ? notSignedIn() : new Error(plain(res.result));
    const kit = res.structured_output || JSON.parse((String(res.result).match(/\{[\s\S]*\}/) || ['{}'])[0]);
    return { ...kit, source: 'generated', cost: res.total_cost_usd };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

// —— director mode ——
function directorBrief({ prompt, style, seconds, aspect, notes, brand }) {
  return `Use the lemo-opuscar skill to direct and produce a short film.

Style: ${style}
Length: about ${seconds} seconds. Frame: ${aspect === '9:16' ? '1080x1920 (vertical)' : '1920x1080'}.
What the film is about:
"""
${prompt}
"""
${notes ? `Notes from the user: ${notes}\n` : ''}${brand ? `Brand kit: the film is for "${brand.name}". Apply the brand where the style allows (in a style's STYLE.md, palette, type and logo are usually safe to change; keep what it says can't change).
- Colours: background ${brand.colors.bg}, surface ${brand.colors.surface}, text ${brand.colors.ink}, secondary text ${brand.colors.muted}, accent ${brand.colors.accent}.
- Type: display "${brand.fonts.display}", body "${brand.fonts.body}"; the OFL font files are in ./brand/ (load them with @font-face).
${brand.logo ? `- Logo: ./brand/${brand.logo}. Give it a clear moment (the end card) and keep it unaltered.\n` : ''}${brand.tone ? `- Tone of voice: ${brand.tone}\n` : ''}- Narrator: Kokoro voice ${brand.voice || 'af_heart'} unless the brief says otherwise.
` : ''}
This is a non-interactive run started from a web app: nobody can answer questions, so do not ask any. Treat the brief above as complete, fill every gap with sensible defaults (English narration in a voice that suits the topic, no storyboard stop), and go straight through treatment, production, self-check and delivery.
Make the film's project folder inside the current directory. When the finished film exists, copy it to ./final.mp4 in the current directory (and its subtitles, if any, to ./final.srt). Finish with a two-line summary of what you made.`;
}

function describeTool(c) {
  const i = c.input || {};
  const arg = i.command || i.file_path || i.path || i.pattern || i.skill || i.description || '';
  return `▸ ${c.name}${arg ? ': ' + String(arg).replace(/\s+/g, ' ').slice(0, 160) : ''}`;
}

export async function runDirector(job, opts) {
  const args = ['-p', directorBrief(opts), '--output-format', 'stream-json', '--verbose',
    '--permission-mode', process.env.DIRECTOR_PERMISSION_MODE || 'auto', '--disallowedTools', 'AskUserQuestion',
    '--add-dir', LIB, '--model', opts.model || 'opus'];
  emit(job, { step: 'Directing', pct: 2 }, `Starting the director with the Lemo-Opuscar style library…`);
  let turns = 0, final = null;
  const onLine = line => {
    if (!line.trim()) return;
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'assistant') {
      turns++;
      for (const c of m.message?.content || []) {
        if (c.type === 'text' && c.text.trim()) emit(job, {}, c.text.trim().slice(0, 600));
        if (c.type === 'tool_use') {
          emit(job, {}, describeTool(c));
          const cmd = String(c.input?.command || '');
          const step = /TREATMENT/i.test(c.input?.file_path || '') ? 'Writing the treatment'
            : /tts|asr_check/.test(cmd) ? 'Recording narration'
            : /still\.mjs|sheet\.py/.test(cmd) ? 'Checking frames'
            : /video\.mjs/.test(cmd) ? 'Rendering frames'
            : /mux\.sh|mix\.py|sampler/.test(cmd) ? 'Scoring and mixing' : null;
          if (step) emit(job, { step });
        }
      }
      emit(job, { pct: Math.min(95, 2 + turns * 0.6) });
    } else if (m.type === 'result') {
      final = m;
    }
  };
  const p = spawn(CLAUDE, args, { cwd: job.dir, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  job.proc = p;
  let buf = '', err = '';
  p.stdout.on('data', d => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    lines.forEach(onLine);
  });
  p.stderr.on('data', d => { err += d; });
  await new Promise(r => p.on('close', r));
  if (buf.trim()) onLine(buf);
  job.proc = null;
  if (job.cancelled) return;
  if (!final || final.is_error) {
    const msg = plain(String(final?.result || err || 'The director stopped without a result').trim());
    const nice = /log ?in/i.test(msg) ? notSignedIn().message : msg.slice(0, 500);
    return emit(job, { status: 'failed', step: 'Failed', error: nice }, 'Error: ' + nice);
  }
  if (final.result) emit(job, {}, final.result.slice(0, 800));
  const out = fs.existsSync(path.join(job.dir, 'final.mp4')) ? 'final.mp4' : findNewestMp4(job.dir);
  if (!out) return emit(job, { status: 'failed', step: 'Failed', error: 'The director finished, but no film was found in the project folder.' });
  emit(job, { status: 'done', step: 'Done', pct: 100, output: out }, `Finished: ${path.join(job.dir, out)}  (cost $${(final.total_cost_usd || 0).toFixed(2)})`);
  // the film's own title, from Claude's closing summary ("I've made **The Price of Sunlight**…")
  const title = filmTitle(job.dir, final.result || '');
  const meta = readMeta(job.dir) || {};
  writeMeta(job.dir, { ...meta, filmTitle: title || meta.filmTitle, cost: final.total_cost_usd ?? null });
}

// the film's title: the quoted name in its treatment's first heading, else a bold name right after "made"
export function filmTitle(dir, summary) {
  let treatment = null;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = e.isDirectory() ? path.join(dir, e.name, 'TREATMENT.md') : null;
      if (p && fs.existsSync(p)) { treatment = p; break; }
    }
    if (!treatment && fs.existsSync(path.join(dir, 'TREATMENT.md'))) treatment = path.join(dir, 'TREATMENT.md');
    const head = treatment && fs.readFileSync(treatment, 'utf8').split('\n').find(l => /^#/.test(l));
    const q = head && /["“]([^"”]{2,70})["”]/.exec(head);
    if (q) return q[1];
  } catch {}
  return /(?:made|produced|created)[^*\n]{0,40}\*\*([^*:]{3,70})\*\*/i.exec(summary)?.[1] || null;
}

function findNewestMp4(dir) {
  let best = null;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && !['node_modules', 'stills', '.git'].includes(e.name)) walk(p);
      else if (e.name.endsWith('.mp4') && !/out\/video\.mp4$/.test(p) && !e.name.startsWith('.')) {
        const t = fs.statSync(p).mtimeMs;
        if (!best || t > best.t) best = { p, t };
      }
    }
  };
  walk(dir);
  return best ? path.relative(dir, best.p) : null;
}
