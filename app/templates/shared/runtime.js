// Shared page runtime for quick-mode templates.
// A template supplies fonts, a scene drawer and a sound plan; this module loads content.json, lays out the timeline,
// chunks narration into captions and exposes the Lemo-Opuscar page contract (DUR, render, EV, CUES, READY).
import { clamp, seg } from '/core/lib.js';

export const Q = new URLSearchParams(location.search);
export const FPS = 24;
const LEAD = 0.35;            // narration starts this long after its scene cuts in
const TAIL = 0.75;            // breathing room after the last word of a scene
export const WPS = 2.6;       // words per second used to estimate narration before TTS has run
const MIN_DUR = { title: 3.2, statement: 3.2, number: 3.6, list: 4.2, compare: 4.2, end: 3.2 };

// frame-aligned seconds, so visual onsets never fall between frames
export const fr = t => Math.round(t * FPS) / FPS;

export function canvas() {
  const m = /^(\d+)x(\d+)$/.exec(Q.get('size') || '');
  const W = m ? +m[1] : innerWidth, H = m ? +m[2] : innerHeight;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  document.body.appendChild(cv);
  return { cv, ctx: cv.getContext('2d'), W, H };
}

// ?embed=1: the host page (the brand studio) posts the content instead of a file; listen from the start
const embedded = Q.has('embed') ? new Promise(res => addEventListener('message', e => {
  if (e.origin === location.origin && e.data?.type === 'content') res(e.data.content);
})) : null;

async function loadContent() {
  if (window.CONTENT) return window.CONTENT;
  if (embedded) return embedded;
  const name = Q.get('content') || 'content.json';
  const r = await fetch('./' + name, { cache: 'no-store' });
  if (!r.ok) throw new Error(`could not load ${name} (${r.status})`);
  return r.json();
}

// minDur(scene) lets a template ask for more time than the narration needs (e.g. for its entrance choreography)
export function timeline(content, minDur = () => 0) {
  const durs = content.voice?.durs || {};
  let t = 0;
  const scenes = content.scenes.map((s, i) => {
    const id = 's' + i;
    const words = (s.narration || '').trim().split(/\s+/).filter(Boolean).length;
    const vd = durs[id] ?? (words ? words / WPS : 0);
    const dur = fr(Math.max(s.dur || 3.5, MIN_DUR[s.type] || 3, minDur(s, content), vd ? LEAD + vd + TAIL : 0));
    const sc = { ...s, i, id, t0: t, t1: t + dur, dur, vt0: t + LEAD, vd };
    t += dur;
    return sc;
  });
  return { scenes, DUR: t };
}

// Split each scene's narration into caption chunks timed in proportion to their length.
export function captions(tl) {
  const cues = [];
  for (const s of tl.scenes) {
    const words = (s.narration || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length || !s.vd) continue;
    const n = Math.max(1, Math.min(words.length, Math.round(s.vd / 2.4)));
    const total = words.join(' ').length;
    const target = total / n;
    const chunks = [];
    let cur = [];
    for (const w of words) {
      cur.push(w);
      if (chunks.length < n - 1 && cur.join(' ').length >= target) { chunks.push(cur.join(' ')); cur = []; }
    }
    if (cur.length) chunks.push(cur.join(' '));
    let t = s.vt0;
    for (const c of chunks) {
      const d = s.vd * c.length / total;
      cues.push({ t0: t, t1: Math.min(s.t1 - 0.1, t + d + 0.25), text: c, scene: s.i });
      t += d;
    }
  }
  for (let i = 0; i < cues.length - 1; i++) cues[i].t1 = Math.min(cues[i].t1, cues[i + 1].t0);
  return cues;
}

export function sceneAt(tl, t) {
  let s = tl.scenes[0];
  for (const x of tl.scenes) if (t >= x.t0) s = x;
  return s;
}

// cubic-bezier easing, as in CSS
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = u => ((ax * u + bx) * u + cx) * u, Y = u => ((ay * u + by) * u + cy) * u;
  const dX = u => (3 * ax * u + 2 * bx) * u + cx;
  return x => {
    x = clamp(x);
    let u = x;
    for (let i = 0; i < 8; i++) { const e = X(u) - x, d = dX(u); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; u -= e / d; }
    return Y(clamp(u));
  };
}

// Break text into lines that fit maxW with the context's current font.
export function wrap(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Largest size (down to min) at which text fits maxW in at most maxLines; font(size) returns a CSS font string.
export function fit(ctx, text, font, maxW, maxLines, size, min = 12, track = 0) {
  for (; size > min; size *= 0.94) {
    ctx.font = font(size);
    ctx.letterSpacing = track * size + 'px';
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW)) return { size, lines };
  }
  ctx.font = font(min);
  ctx.letterSpacing = track * min + 'px';
  return { size: min, lines: wrap(ctx, text, maxW) };
}

// "38%", "$4.2M", "1,200" → { pre, value, decimals, comma, post } or null
export function parseNumber(str) {
  const m = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/.exec(String(str || '').trim());
  if (!m || /^\s*(?:[-–—]|to\b)\s*\d/.test(m[3])) return null;   // ranges like "8-10" are shown as written, not counted
  const raw = m[2], dot = raw.indexOf('.');
  return { pre: m[1], value: parseFloat(raw.replace(/,/g, '')), decimals: dot < 0 ? 0 : raw.length - dot - 1, comma: raw.includes(','), post: m[3] };
}
export function formatNumber(n, v) {
  let s = v.toFixed(n.decimals);
  if (n.comma) { const [a, b] = s.split('.'); s = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? '.' + b : ''); }
  return n.pre + s + n.post;
}

export { clamp, seg };

// —— brand kits ——
// content.brand = { colors: { bg, surface, ink, muted, accent }, fonts: { display: { family, url, fixed }, body: {…} }, logo }
const hexRGB = h => { h = String(h || '#000').replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const mix = (a, b, t) => '#' + hexRGB(a).map((v, i) => Math.round(v + (hexRGB(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
export const rgba = (hex, a) => `rgba(${hexRGB(hex).join(',')},${a})`;
export const luminance = hex => { const [r, g, b] = hexRGB(hex).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
export const isDark = hex => luminance(hex) < .2;

// load the brand's fonts as BrandDisplay / BrandBody and its logo; resolves to null without a brand
async function loadBrand(content) {
  const b = content.brand;
  if (!b) return null;
  const out = { ...b, display: null, body: null, logo: null };
  const face = async (name, f) => {
    if (!f?.url) return null;
    try {
      const ff = new FontFace(name, `url(${f.url})`, { weight: f.fixed ? '400' : '100 900', display: 'block' });
      await ff.load();
      document.fonts.add(ff);
      return { family: `"${name}"`, fixed: !!f.fixed };
    } catch { return null; }
  };
  [out.display, out.body] = await Promise.all([face('BrandDisplay', b.fonts?.display), face('BrandBody', b.fonts?.body)]);
  if (b.logo) {
    const img = new Image();
    img.src = b.logo;
    try { await img.decode(); out.logo = img; } catch { out.logo = null; }
  }
  return out;
}

// draw the logo to fit a box (h tall, at most maxW wide); align 'left' | 'right' | 'center'
export function drawLogo(ctx, img, x, y, h, maxW, align = 'left', alpha = 1) {
  if (!img || alpha <= 0) return 0;
  const r = img.naturalWidth / img.naturalHeight || 1;
  let w = h * r;
  if (w > maxW) { w = maxW; h = w / r; }
  const lx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(img, lx, y, w, h);
  ctx.restore();
  return w;
}

// Wire a template into the page contract.
// tpl = { fonts: [css font strings], minDur(scene, content)?, setup({ ctx, W, H, content, tl, cues, brand }), draw(t), events() }
export async function boot(tpl) {
  try {
    const { ctx, W, H } = canvas();
    await Promise.all(tpl.fonts.map(f => document.fonts.load(f)));
    const content = await loadContent();
    const tl = timeline(content, tpl.minDur);
    const cues = captions(tl);
    const brand = await loadBrand(content);
    tpl.setup({ ctx, W, H, content, tl, cues, brand });
    const ev = tpl.events().map(e => ({ ...e, t: fr(e.t) }));
    for (const s of tl.scenes) {
      ev.push({ t: s.t0, type: 'scene', i: s.i, kind: s.type, dur: s.dur });
      if (s.narration && s.vd) ev.push({ t: s.vt0, type: 'voice', id: s.id });
    }
    for (const c of cues) ev.push({ t: c.t0, type: 'cue', t1: c.t1, text: c.text });
    window.CONTENT = content;
    window.TL = tl;
    window.DUR = tl.DUR;
    window.CUES = cues;
    window.EV = ev.sort((a, b) => a.t - b.t);
    window.render = t => tpl.draw(clamp(t, 0, tl.DUR - 1e-6));
    window.render(0);
    window.READY = true;
  } catch (e) {
    window.BOOT_ERROR = String(e.message || e);
    throw e;
  }
}
