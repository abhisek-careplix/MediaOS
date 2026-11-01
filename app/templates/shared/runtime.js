// Shared page runtime for quick-mode templates.
// A template supplies fonts, a scene drawer and a sound plan; this module loads content.json, lays out the timeline,
// chunks narration into captions and exposes the Lemo-Opuscar page contract (DUR, render, EV, CUES, READY).
import { clamp, seg } from '/core/lib.js';

export const Q = new URLSearchParams(location.search);
export const FPS = 24;
const LEAD = 0.35;            // narration starts this long after its scene cuts in
const TAIL = 0.75;            // breathing room after the last word of a scene
export const WPS = 2.6;       // words per second used to estimate narration before TTS has run
const MIN_DUR = { title: 3.2, statement: 3.2, number: 3.6, list: 4.2, compare: 4.2, product: 4.2, end: 3.2 };

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
    try { await img.decode(); out.logo = prepLogo(img, /\.svg(\?|$)/i.test(b.logo)); } catch { out.logo = null; }
  }
  return out;
}

// —— the logo ——
// Uploaded logos often carry a wide empty margin, arrive many times larger than they are drawn, and can vanish on a
// background close to their own colours. prepLogo trims the margin (keying out a solid backdrop when the file has no
// transparency) and measures the logo's colours once; drawLogo draws a copy shrunk in steps to the exact pixel size,
// and swaps in a one-colour version where too much of the original would disappear. The uploaded file is never changed.
const lum8 = (r, g, b) => luminance('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
const LUM = new Float32Array(4096);   // 4-bit-per-channel luminance table, so measuring a logo stays cheap
for (let i = 0; i < 4096; i++) LUM[i] = lum8((i >> 8) * 17, (i >> 4 & 15) * 17, (i & 15) * 17);
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const sheet = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

function prepLogo(img, svg) {
  const nw = img.naturalWidth || 400, nh = img.naturalHeight || 100, r = nw / nh;
  // vectors are rasterised large; bitmaps are used at their own size (at most 2400 px wide)
  const k = svg ? 2000 / Math.max(nw, nh) : Math.min(1, 2400 / nw);
  const c = sheet(nw * k, nh * k), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  const id = x.getImageData(0, 0, c.width, c.height), d = id.data, n = c.width * c.height;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) clear++;
  if (clear < n * 0.02) {
    // no transparency: if the corners share one colour, treat it as a backdrop and key it out with soft edges
    const at = (px, py) => (py * c.width + px) * 4, cs = [at(0, 0), at(c.width - 1, 0), at(0, c.height - 1), at(c.width - 1, c.height - 1)];
    const bg = [0, 1, 2].map(j => cs.reduce((s, i) => s + d[i + j], 0) / 4);
    if (cs.every(i => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) < 24)) {
      for (let i = 0; i < d.length; i += 4) {
        const a = Math.min(1, Math.max(0, (Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) - 12) / 48));
        // un-mix the backdrop from edge pixels so no pale fringe shows on a dark stage
        for (let j = 0; j < 3; j++) d[i + j] = a > 0 ? Math.min(255, Math.max(0, Math.round((d[i + j] - (1 - a) * bg[j]) / a))) : 0;
        d[i + 3] = Math.round(a * d[i + 3]);
      }
      x.putImageData(id, 0, 0);
    }
  }
  // the box around everything visible, and the share of the logo at each luminance
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1, ink = 0, dark = null;
  const hist = new Float32Array(64);
  for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) {
    const i = (py * c.width + px) * 4, a = d[i + 3];
    if (a < 16) continue;
    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    if (a < 160) continue;
    const l = LUM[(d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4];
    hist[Math.min(63, l * 64 | 0)] += 1;
    ink++;
    if (!dark || l < dark.l) dark = { l, rgb: [d[i], d[i + 1], d[i + 2]] };
  }
  if (x1 < 0) return null;
  const pad = Math.round((y1 - y0 + 1) * 0.02);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  const src = sheet(x1 - x0 + 1, y1 - y0 + 1);
  src.getContext('2d').drawImage(c, x0, y0, src.width, src.height, 0, 0, src.width, src.height);
  for (let i = 0; i < 64; i++) hist[i] /= ink || 1;
  return { src, r: src.width / src.height, hist, darkest: dark, sized: new Map(), mono: {}, probe: null };
}

// the share of the logo that would be hard to see on a background of luminance l
function lostOn(logo, l) {
  let s = 0;
  for (let i = 0; i < 64; i++) if (logo.hist[i] && contrast((i + 0.5) / 64, l) < 1.6) s += logo.hist[i];
  return s;
}

// the logo as a single colour (white on dark grounds; its own darkest colour, or near-black, on light ones)
function monoOf(logo, light) {
  const key = light ? 'light' : 'dark';
  if (logo.mono[key]) return logo.mono[key];
  const c = sheet(logo.src.width, logo.src.height), x = c.getContext('2d');
  x.drawImage(logo.src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  const own = logo.darkest && contrast(logo.darkest.l, 1) > 4.5 ? `rgb(${logo.darkest.rgb.join(',')})` : '#111418';
  x.fillStyle = light ? '#ffffff' : own;
  x.fillRect(0, 0, c.width, c.height);
  return (logo.mono[key] = { src: c, sized: new Map() });
}

// a copy shrunk to exactly w×h device pixels, halving in steps so fine detail stays crisp
function sizedOf(v, w, h) {
  const key = w + 'x' + h;
  let c = v.sized.get(key);
  if (c) return c;
  if (v.sized.size > 48) v.sized.clear();
  let cur = v.src;
  while (cur.width > w * 2) {
    const half = sheet(cur.width / 2, cur.height / 2), hx = half.getContext('2d');
    hx.imageSmoothingQuality = 'high';
    hx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  c = sheet(w, h);
  const cx = c.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(cur, 0, 0, w, h);
  v.sized.set(key, c);
  return c;
}

// the background's luminance under a rectangle, read from what has been drawn so far
function groundUnder(ctx, logo, x, y, w, h) {
  const m = ctx.getTransform();
  const px = m.a * x + m.c * y + m.e, py = m.b * x + m.d * y + m.f, pw = Math.abs(m.a * w), ph = Math.abs(m.d * h);
  const P = logo.probe || (logo.probe = sheet(24, 6).getContext('2d', { willReadFrequently: true }));
  P.clearRect(0, 0, 24, 6);
  P.drawImage(ctx.canvas, Math.max(0, px), Math.max(0, py), Math.max(1, pw), Math.max(1, ph), 0, 0, 24, 6);
  const d = P.getImageData(0, 0, 24, 6).data, ls = [];
  for (let i = 0; i < d.length; i += 4) ls.push(LUM[(d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4]);
  ls.sort((a, b) => a - b);
  return ls[ls.length >> 1];
}

// Draw the logo inside a box h tall and at most maxW wide. Wide wordmarks and square marks are sized by area so they
// carry the same weight (a wide logo fills the width, a square one the height). Returns the drawn width.
// align 'left' | 'right' | 'center'; valign 'top' | 'middle'
export function drawLogo(ctx, logo, x, y, h, maxW, align = 'left', alpha = 1, valign = 'top') {
  if (!logo || alpha <= 0) return 0;
  let lh = Math.min(h, Math.sqrt(h * maxW * 0.5 / logo.r)), w = lh * logo.r;
  if (w > maxW) { w = maxW; lh = w / logo.r; }
  let lx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, ly = valign === 'middle' ? y + (h - lh) / 2 : y;
  const m = ctx.getTransform(), sx = Math.hypot(m.a, m.b) || 1;
  const pw = Math.max(1, Math.round(w * sx)), ph = Math.max(1, Math.round(lh * sx));
  // keep a still logo on whole pixels so it is not resampled again
  if (!m.b && !m.c) { lx = (Math.round(m.a * lx + m.e) - m.e) / m.a; ly = (Math.round(m.d * ly + m.f) - m.f) / m.d; }
  const g = groundUnder(ctx, logo, lx, ly, w, lh), lost = lostOn(logo, g);
  // 0 below 12% of the logo lost, 1 above 25%, eased between so a passing transition never flickers
  const k = clamp((lost - 0.12) / 0.13);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  const base = ctx.globalAlpha * alpha;
  if (k < 1) { ctx.globalAlpha = base * (1 - k); ctx.drawImage(sizedOf(logo, pw, ph), lx, ly, w, lh); }
  if (k > 0) { ctx.globalAlpha = base * k; ctx.drawImage(sizedOf(monoOf(logo, g < 0.4), pw, ph), lx, ly, w, lh); }
  ctx.restore();
  return w;
}

// —— product images ——
// content.media = [{ src }]: the photos product scenes show. Each is shrunk once (in steps, so it stays crisp) to at most
// the frame's long side, and a photo shot on a plain backdrop reports that colour, so a scene can extend the backdrop
// into a seamless plate around it; a cut-out (transparent) photo reports that instead.
async function loadMedia(content, W, H) {
  return Promise.all((content.media || []).map(async m => {
    const img = new Image();
    img.src = m.src;
    try { await img.decode(); } catch { return null; }
    let cur = img, cw = img.naturalWidth, ch = img.naturalHeight;
    const k = Math.min(1, Math.max(W, H) / Math.max(cw, ch)), w = Math.round(cw * k), h = Math.round(ch * k);
    while (cw > w * 2) {
      const half = sheet(cw / 2, ch / 2), hx = half.getContext('2d');
      hx.imageSmoothingQuality = 'high';
      hx.drawImage(cur, 0, 0, half.width, half.height);
      cur = half; cw = half.width; ch = half.height;
    }
    const src = sheet(w, h), sx = src.getContext('2d');
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(cur, 0, 0, w, h);
    // the border: mostly transparent → a cut-out; one even colour → a studio backdrop
    const P = sheet(48, 48).getContext('2d', { willReadFrequently: true });
    P.drawImage(src, 0, 0, 48, 48);
    const d = P.getImageData(0, 0, 48, 48).data, edge = [];
    for (let i = 0; i < 48; i++) for (const [x, y] of [[i, 0], [i, 47], [0, i], [47, i]]) edge.push((y * 48 + x) * 4);
    const clear = edge.filter(i => d[i + 3] < 200).length > edge.length * 0.5;
    const mean = [0, 1, 2].map(j => edge.reduce((s, i) => s + d[i + j], 0) / edge.length);
    const spread = Math.max(...edge.map(i => Math.hypot(d[i] - mean[0], d[i + 1] - mean[1], d[i + 2] - mean[2])));
    const plate = !clear && spread < 36 ? '#' + mean.map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : null;
    if (!clear && !plate) return { src, w, h, clear, plate };
    // a studio shot or cut-out: frame the product itself (with a margin), not the empty backdrop around it
    const n = 128, pw = w >= h ? n : Math.round(n * w / h), ph = w >= h ? Math.round(n * h / w) : n;
    const Q = sheet(pw, ph).getContext('2d', { willReadFrequently: true });
    Q.drawImage(src, 0, 0, pw, ph);
    const q = Q.getImageData(0, 0, pw, ph).data;
    let x0 = pw, y0 = ph, x1 = -1, y1 = -1;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4;
      if (clear ? q[i + 3] > 40 : Math.hypot(q[i] - mean[0], q[i + 1] - mean[1], q[i + 2] - mean[2]) > 28) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0 || (x1 - x0 + 1) * (y1 - y0 + 1) > pw * ph * 0.7) return { src, w, h, clear, plate };
    const gap = Math.max(x1 - x0 + 1, y1 - y0 + 1) * 0.1, f = w / pw;
    const cx0 = Math.max(0, (x0 - gap) * f), cy0 = Math.max(0, (y0 - gap) * f), cx1 = Math.min(w, (x1 + 1 + gap) * f), cy1 = Math.min(h, (y1 + 1 + gap) * f);
    const crop = sheet(cx1 - cx0, cy1 - cy0);
    crop.getContext('2d').drawImage(src, cx0, cy0, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return { src: crop, w: crop.width, h: crop.height, clear, plate };
  }));
}

// Draw a photo into a box. 'contain' shows the whole picture, on its own backdrop colour (or `plate` for a cut-out);
// 'cover' fills the box. 'auto' contains studio shots and cut-outs, and covers everything else. zoom > 1 pushes in.
export function drawPhoto(ctx, m, x, y, w, h, { fit = 'auto', zoom = 1, radius = 0, plate = null } = {}) {
  if (!m) return;
  const mode = fit === 'auto' ? (m.plate || m.clear ? 'contain' : 'cover') : fit;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  const back = m.plate || (m.clear ? plate : null);
  if (mode === 'contain' && back) { ctx.fillStyle = back; ctx.fillRect(x, y, w, h); }
  const r = m.w / m.h;
  let dw = w, dh = w / r;
  if (mode === 'cover' ? dh < h : dh > h) { dh = h; dw = h * r; }
  // a contained product gets breathing room inside its plate
  const k = (mode === 'contain' ? 0.84 : 1) * zoom;
  dw *= k; dh *= k;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(m.src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

// Wire a template into the page contract.
// tpl = { fonts: [css font strings], minDur(scene, content)?, setup({ ctx, W, H, content, tl, cues, brand, media }), draw(t), events() }
export async function boot(tpl) {
  try {
    const { ctx, W, H } = canvas();
    await Promise.all(tpl.fonts.map(f => document.fonts.load(f)));
    const content = await loadContent();
    const tl = timeline(content, tpl.minDur);
    const cues = captions(tl);
    const [brand, media] = await Promise.all([loadBrand(content), loadMedia(content, W, H)]);
    tpl.setup({ ctx, W, H, content, tl, cues, brand, media });
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
