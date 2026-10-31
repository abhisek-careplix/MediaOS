// Dark Tech Keynote, quick-mode template: near-black stage, hairline grid, one accent, light-sweep reveals,
// glyph-scramble numbers, cards that land on the beat, UI expand/collapse transitions.
// Grammar from styles/dark-keynote/STYLE.md.
import { boot, fit, parseNumber, formatNumber, seg, sceneAt, fr, mix, isDark, drawLogo } from './runtime.js';
import { back, eo, hash, lerp, clamp } from '/core/lib.js';

let C = { bg: '#07080B', s1: '#101217', s2: '#161920', s3: '#1D2129', t1: '#F2F4F8', t2: '#A2A8B5', t3: '#5F6674', red: '#FF4D5E' };
const ACCENTS = ['#B7F34A', '#8B7CFF', '#FF7A1A', '#3DD6F5'];
// headings (600+) in the display face, the rest in the body face; a brand kit can replace both
let FD = 'Inter', FB = 'Inter', FIXED = false, LOGO = null, DARK = true;
const IN = (w, s) => w >= 600 ? `${FIXED ? 400 : w} ${s}px ${FD}` : `${w} ${s}px ${FB}`;
const ink = a => rgba(C.t1, a);
const shade = a => DARK ? `rgba(0,0,0,${a})` : `rgba(20,24,40,${a * 0.3})`;
const MONO = s => `500 ${s}px "JetBrains Mono"`;

let ctx, W, H, S, tl, cues, B, TR, OFF, A, M, CY, portrait, stage, layer, layer2;

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}
function panel(x, y, w, h, level = 2, border = ink(0.08), glow = null) {
  ctx.save();
  ctx.shadowColor = glow || shade(0.55);
  ctx.shadowBlur = (glow ? 50 : 40) * S;
  ctx.shadowOffsetY = glow ? 0 : 16 * S;
  ctx.fillStyle = [C.s1, C.s2, C.s3][level - 1];
  rr(ctx, x, y, w, h, 18 * S);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(1, S);
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 18 * S);
  ctx.stroke();
  ctx.fillStyle = ink(0.06);
  ctx.fillRect(x + 18 * S, y + 1, w - 36 * S, Math.max(1, S));
}
function text(c, str, x, y, font, color, align = 'left', track = 0, size = 0) {
  c.font = font;
  c.letterSpacing = track * size + 'px';
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(str, x, y);
  c.textAlign = 'left';
}
// typed label: characters appear one per 1/32 note
function typed(str, x, y, size, color, t0, lt, align = 'left') {
  const n = Math.floor(Math.max(0, lt - t0) / (B / 8));
  if (n <= 0) return;
  const s = String(str || '').toUpperCase();
  text(ctx, s.slice(0, n), x, y, MONO(size), color, align, 0.14, size);
}

// Light reveal: draw(c) paints the content on an offscreen layer; only pixels the light has passed turn on.
function lit(draw, x0, x1, p) {
  if (p >= 1) { draw(ctx); return; }
  const lc = layer.getContext('2d'), l2 = layer2.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, W, H);
  draw(lc);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.06;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;
  if (p > 0) {
    const soft = 160 * S, front = lerp(x0 - soft, x1 + soft, eo(p) * 0.25 + p * 0.75);
    l2.setTransform(1, 0, 0, 1, 0, 0);
    l2.globalCompositeOperation = 'source-over';
    l2.clearRect(0, 0, W, H);
    l2.drawImage(layer, 0, 0);
    l2.globalCompositeOperation = 'destination-in';
    const g = l2.createLinearGradient(front - soft, 0, front, 0);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    l2.fillStyle = g;
    l2.fillRect(0, 0, W, H);
    ctx.drawImage(layer2, 0, 0);
    // glint at the front, at most 20 %
    l2.globalCompositeOperation = 'source-over';
    l2.clearRect(0, 0, W, H);
    l2.drawImage(layer, 0, 0);
    l2.globalCompositeOperation = 'source-in';
    const gl = l2.createLinearGradient(front - soft * 0.7, 0, front, 0);
    gl.addColorStop(0, 'rgba(255,255,255,0)');
    gl.addColorStop(0.8, 'rgba(255,255,255,0.2)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    l2.fillStyle = gl;
    l2.fillRect(0, 0, W, H);
    ctx.drawImage(layer2, 0, 0);
    l2.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

// draw a line of text with emphasised words in the accent
function emphLine(c, line, x, y, size, weight, color, emph, align = 'center') {
  c.font = IN(weight, size);
  c.letterSpacing = -0.02 * size + 'px';
  const words = line.split(' ');
  const widths = words.map(w => c.measureText(w).width), sp = c.measureText(' ').width;
  const total = widths.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
  let cx = align === 'center' ? x - total / 2 : x;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  words.forEach((w, i) => {
    const key = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    c.fillStyle = emph.has(key) ? A : color;
    c.fillText(w, cx, y);
    cx += widths[i] + sp;
  });
}
const emphSet = s => new Set(String(s.emphasis || '').toLowerCase().split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean));

const LAYOUT = {
  title(s) {
    const L = {};
    L.t = fit(ctx, s.text, z => IN(600, z), W * (portrait ? 0.86 : 0.78), portrait ? 3 : 2, (portrait ? 104 : 124) * S, 40 * S, -0.025);
    L.sub = s.sub ? fit(ctx, s.sub, z => IN(400, z), W * (portrait ? 0.84 : 0.6), 2, 36 * S, 22 * S) : null;
    const h = L.t.lines.length * L.t.size * 1.08;
    L.y = CY - h / 2 + L.t.size * 0.82 - (L.sub ? 30 * S : 0);
    ctx.font = IN(600, L.t.size);
    ctx.letterSpacing = -0.025 * L.t.size + 'px';
    L.wMax = Math.max(...L.t.lines.map(l => ctx.measureText(l).width));
    L.x0 = W / 2 - L.wMax / 2;
    L.x1 = W / 2 + L.wMax / 2;
    L.r0 = OFF + B * 2;
    L.r1 = L.r0 + Math.min(1.2, Math.max(0.8, B * 2));
    s.ev = [{ t: OFF, type: 'tick' }, { t: OFF + B, type: 'tick' }, { t: L.r0, type: 'sweep' }, ...(L.sub ? [{ t: L.r1, type: 'soft' }] : [])];
    return L;
  },
  statement(s) {
    const L = {};
    L.t = fit(ctx, s.text, z => IN(600, z), W * (portrait ? 0.86 : 0.8), portrait ? 4 : 3, (portrait ? 88 : 100) * S, 36 * S, -0.02);
    L.sub = s.sub ? fit(ctx, s.sub, z => IN(400, z), W * (portrait ? 0.84 : 0.62), 3, 34 * S, 22 * S) : null;
    const h = L.t.lines.length * L.t.size * 1.1;
    L.y = CY - h / 2 + L.t.size * 0.82 - (L.sub ? 34 * S : 0);
    ctx.font = IN(600, L.t.size);
    ctx.letterSpacing = -0.02 * L.t.size + 'px';
    L.wMax = Math.max(...L.t.lines.map(l => ctx.measureText(l).width));
    L.r0 = OFF + B * 0.5;
    L.r1 = L.r0 + Math.min(1.2, Math.max(0.8, B * 2));
    L.emph = emphSet(s);
    s.ev = [{ t: L.r0, type: 'sweep' }, ...(L.sub ? [{ t: L.r1, type: 'soft' }] : [])];
    return L;
  },
  number(s) {
    const L = {};
    L.n = parseNumber(s.number);
    L.full = L.n ? formatNumber(L.n, L.n.value) : String(s.number || '');
    L.big = fit(ctx, L.full, z => IN(700, z), W * (portrait ? 0.88 : 0.8), 1, portrait ? H * 0.17 : H * 0.42, 60 * S, -0.045);
    L.y = CY + L.big.size * 0.36;
    L.c0 = OFF + B;
    L.step = B / 4;
    L.lockT = L.full.split('').map((_, k) => L.c0 + B + k * L.step);
    L.done = L.lockT[L.lockT.length - 1];
    L.label = s.text ? fit(ctx, String(s.text).toUpperCase(), z => MONO(z), W * 0.8, 2, 26 * S, 16 * S, 0.14) : null;
    s.ev = [{ t: L.c0, type: 'snap' }, ...L.lockT.slice(0, -1).map(t => ({ t, type: 'tick' })), { t: L.done, type: 'lock' }];
    return L;
  },
  list(s) {
    const L = {};
    L.items = (s.items || []).slice(0, 5);
    const n = Math.max(1, L.items.length);
    L.head = fit(ctx, s.text, z => IN(600, z), W - 2 * M, 2, (portrait ? 60 : 64) * S, 28 * S, -0.02);
    L.hy = (portrait ? H * 0.12 : M + 30 * S) + L.head.size * 0.82;
    const gap = 24 * S, top = L.hy + (L.head.lines.length - 1) * L.head.size * 1.1 + 60 * S;
    const avail = (cues.length ? H - 170 * S : H - M) - top;
    if (portrait) {
      L.cw = W - 2 * M;
      L.ch = Math.min(220 * S, (avail - gap * (n - 1)) / n);
      L.pos = L.items.map((_, k) => [M, top + k * (L.ch + gap)]);
    } else {
      L.cw = (W - 2 * M - gap * (n - 1)) / n;
      L.ch = Math.min(380 * S, avail);
      L.pos = L.items.map((_, k) => [M + k * (L.cw + gap), top + (avail - L.ch) / 2]);
    }
    L.rows = L.items.map(it => fit(ctx, it, z => IN(500, z), L.cw - 64 * S, portrait ? 2 : 4, Math.min(44 * S, L.ch * 0.2), 18 * S, -0.01));
    L.arr = L.items.map((_, k) => OFF + B * (1.5 + k));
    s.ev = L.arr.flatMap(t => [{ t, type: 'snap' }, { t: t + B / 2, type: 'tick' }]);
    return L;
  },
  compare(s) {
    const L = {};
    L.a = s.left || {};
    L.b = s.right || {};
    L.na = parseNumber(L.a.value);
    L.nb = parseNumber(L.b.value);
    L.numeric = !!(L.na && L.nb && L.na.value >= 0 && L.nb.value >= 0 && Math.max(L.na.value, L.nb.value) > 0);
    L.head = s.text ? fit(ctx, s.text, z => IN(600, z), W - 2 * M, 2, (portrait ? 60 : 64) * S, 28 * S, -0.02) : null;
    L.hy = (portrait ? H * 0.12 : M + 30 * S) + (L.head ? L.head.size * 0.82 : 0);
    const gap = 32 * S, top = L.hy + (L.head ? (L.head.lines.length - 1) * L.head.size * 1.1 + 70 * S : 0);
    const avail = (cues.length ? H - 170 * S : H - M) - top;
    if (portrait) {
      L.pw = W - 2 * M;
      L.ph = Math.min(380 * S, (avail - gap) / 2);
      L.pos = [[M, top], [M, top + L.ph + gap]];
    } else {
      L.pw = (W - 2 * M - gap) / 2;
      L.ph = Math.min(440 * S, avail);
      L.pos = [[M, top + (avail - L.ph) / 2], [M + L.pw + gap, top + (avail - L.ph) / 2]];
    }
    const vs = z => IN(600, z);
    L.va = fit(ctx, String(L.a.value || ''), vs, L.pw - 96 * S, 1, (portrait ? 110 : 130) * S, 30 * S, -0.03);
    L.vb = fit(ctx, String(L.b.value || ''), vs, L.pw - 96 * S, 1, (portrait ? 110 : 130) * S, 30 * S, -0.03);
    L.vsz = Math.min(L.va.size, L.vb.size);
    L.aA = OFF + B;
    L.bA = L.aA + B * 2;
    s.ev = [{ t: L.aA, type: 'snap' }, { t: L.bA, type: 'snap' }, { t: L.bA + B, type: 'lock' }];
    return L;
  },
  end(s) {
    const L = {};
    L.cols = portrait ? 4 : 9;
    L.rows = portrait ? 6 : 3;
    L.tile = (portrait ? 120 : 110) * S;
    L.gap = 22 * S;
    L.gw = L.cols * L.tile + (L.cols - 1) * L.gap;
    L.gh = L.rows * L.tile + (L.rows - 1) * L.gap;
    L.gx = (W - L.gw) / 2;
    L.gy = CY - L.gh / 2 - (portrait ? 120 : 60) * S;
    L.n = L.cols * L.rows;
    L.spawn = k => OFF + (k / L.n) * B * 2;
    L.col = OFF + B * 3;
    L.lockA = L.col + B;
    L.t = fit(ctx, s.text, z => IN(600, z), W * 0.8, 2, (portrait ? 80 : 84) * S, 30 * S, -0.02);
    L.sub = s.sub ? fit(ctx, s.sub, z => IN(400, z), W * 0.7, 2, 32 * S, 20 * S) : null;
    L.ty = CY + 60 * S + L.t.size * 0.82;
    ctx.font = IN(600, L.t.size);
    ctx.letterSpacing = -0.02 * L.t.size + 'px';
    L.wMax = Math.max(...L.t.lines.map(l => ctx.measureText(l).width));
    L.r0 = L.lockA + B * 0.5;
    L.r1 = L.r0 + 1.0;
    s.ev = [0, 4, 8, 12].map(k => ({ t: L.spawn(Math.min(k, L.n - 1)), type: 'tick', soft: 1 }));
    s.ev.push({ t: L.col, type: 'collapse' }, { t: L.lockA, type: 'lock' }, { t: L.r0, type: 'sweep' });
    return L;
  },
};

const DRAW = {
  title(s, L, lt) {
    const p = seg(lt, L.r0, L.r1);
    // the caret blinks on the beat, then carries the light across the title
    const cx = p <= 0 ? W / 2 : lerp(L.x0, L.x1 + 20 * S, p);
    const blinkOn = p > 0 || ((lt - OFF) / B) % 1 < 0.55;
    if (lt >= OFF * 0.5 && blinkOn && (p < 1 || ((lt - L.r1) / B) % 1 < 0.55)) {
      const ch = L.t.size * 0.9, cyy = L.y - L.t.size * 0.7 + (L.t.lines.length - 1) * L.t.size * 0.54;
      ctx.save();
      ctx.shadowColor = rgba(A, 0.8);
      ctx.shadowBlur = 24 * S;
      ctx.fillStyle = A;
      ctx.fillRect(p >= 1 ? L.x1 + 20 * S : cx, cyy - ch / 2 + L.t.size * 0.35, 7 * S, ch);
      ctx.restore();
    }
    lit(c => L.t.lines.forEach((line, k) => text(c, line, W / 2, L.y + k * L.t.size * 1.08, IN(600, L.t.size), C.t1, 'center', -0.025, L.t.size)), L.x0, L.x1, p);
    const ky = L.y - L.t.size * 1.05;
    if (lt > L.r0) {
      const dot = 7 * S;
      ctx.font = MONO(22 * S);
      ctx.letterSpacing = 0.14 * 22 * S + 'px';
      const kw = ctx.measureText(String(s.kicker || '').toUpperCase()).width;
      if (s.kicker) {
        ctx.fillStyle = A;
        ctx.beginPath();
        ctx.arc(W / 2 - kw / 2 - 22 * S, ky - 7 * S, dot, 0, Math.PI * 2);
        ctx.fill();
        typed(s.kicker, W / 2 - kw / 2, ky, 22 * S, A, L.r0, lt);
      }
    }
    if (L.sub) {
      const q = eo(seg(lt, L.r1 - 0.1, L.r1 + 0.25));
      ctx.globalAlpha = q;
      const y0 = L.y + (L.t.lines.length - 1) * L.t.size * 1.08 + 50 * S + L.sub.size + (1 - q) * 14 * S;
      L.sub.lines.forEach((line, k) => text(ctx, line, W / 2, y0 + k * L.sub.size * 1.3, IN(400, L.sub.size), C.t2, 'center'));
      ctx.globalAlpha = 1;
    }
  },
  statement(s, L, lt) {
    const p = seg(lt, L.r0, L.r1);
    if (s.kicker) typed(s.kicker, W / 2, L.y - L.t.size * 1.05, 22 * S, C.t3, OFF, lt, 'center');
    lit(c => L.t.lines.forEach((line, k) => emphLine(c, line, W / 2, L.y + k * L.t.size * 1.1, L.t.size, 600, C.t1, L.emph)), W / 2 - L.wMax / 2, W / 2 + L.wMax / 2, p);
    if (L.sub) {
      const q = eo(seg(lt, L.r1 - 0.15, L.r1 + 0.2));
      ctx.globalAlpha = q;
      const y0 = L.y + (L.t.lines.length - 1) * L.t.size * 1.1 + 52 * S + L.sub.size + (1 - q) * 14 * S;
      L.sub.lines.forEach((line, k) => text(ctx, line, W / 2, y0 + k * L.sub.size * 1.32, IN(400, L.sub.size), C.t2, 'center'));
      ctx.globalAlpha = 1;
    }
  },
  number(s, L, lt) {
    if (L.label) L.label.lines.forEach((line, k) => typed(line, W / 2, L.y - L.big.size * 0.92 - (L.label.lines.length - 1 - k) * L.label.size * 1.5, L.label.size, C.t2, OFF + k * B, lt, 'center'));
    if (lt < L.c0) return;
    const pop = back(seg(lt, L.c0, L.c0 + 0.25), 1.3);
    const frame = Math.floor(lt * 24);
    const chars = L.full.split('').map((ch, k) => {
      if (lt >= L.lockT[k] || !/\d/.test(ch)) return ch;
      return String(Math.floor(hash(frame * 31 + k * 7) * 10));
    }).join('');
    ctx.save();
    ctx.translate(W / 2, L.y);
    ctx.scale(lerp(0.92, 1, pop), lerp(0.92, 1, pop));
    ctx.globalAlpha = clamp(pop);
    const locked = lt >= L.done;
    ctx.shadowColor = rgba(A, locked ? 0.55 : 0.25);
    ctx.shadowBlur = (locked ? 70 : 30) * S;
    text(ctx, chars, 0, 0, IN(700, L.big.size), locked ? A : C.t1, 'center', -0.045, L.big.size);
    ctx.restore();
    if (s.unit) typed(s.unit, W / 2, L.y + 90 * S, 28 * S, C.t2, L.done + B / 2, lt, 'center');
  },
  list(s, L, lt) {
    lit(c => L.head.lines.forEach((line, k) => text(c, line, M, L.hy + k * L.head.size * 1.1, IN(600, L.head.size), C.t1, 'left', -0.02, L.head.size)), M, M + W * 0.6, seg(lt, OFF * 0.5, OFF * 0.5 + 0.9));
    if (s.kicker) typed(s.kicker, M, L.hy - L.head.size * 1.0, 20 * S, C.t3, 0, lt);
    L.rows.forEach((r, k) => {
      const a = L.arr[k], q = seg(lt, a - 0.28, a);
      if (q <= 0) return;
      const e = back(q, 1.3), [x, y0] = L.pos[k];
      const y = y0 + (1 - e) * 90 * S;
      ctx.globalAlpha = clamp(q * 2);
      panel(x, y, L.cw, L.ch, 2);
      text(ctx, String(k + 1).padStart(2, '0'), x + 32 * S, y + 52 * S, MONO(20 * S), C.t3, 'left', 0.1, 20 * S);
      const ty = portrait ? y + L.ch / 2 + r.size * 0.35 - (r.lines.length - 1) * r.size * 0.6 + 14 * S : y + L.ch - 48 * S - (r.lines.length - 1) * r.size * 1.2;
      const tx = portrait ? x + 110 * S : x + 32 * S;
      r.lines.forEach((line, j) => text(ctx, line, tx, ty + j * r.size * 1.2, IN(500, r.size), C.t1, 'left', -0.01, r.size));
      const c = seg(lt, a + B / 2 - 0.08, a + B / 2);
      if (c > 0) {
        const cx = x + L.cw - 44 * S, cy = y + 44 * S;
        ctx.save();
        ctx.shadowColor = rgba(A, 0.7);
        ctx.shadowBlur = 18 * S;
        ctx.fillStyle = A;
        ctx.beginPath();
        ctx.arc(cx, cy, 13 * S * back(c, 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = C.bg;
        ctx.lineWidth = 3 * S;
        ctx.beginPath();
        ctx.moveTo(cx - 6 * S, cy);
        ctx.lineTo(cx - 1.5 * S, cy + 5 * S);
        ctx.lineTo(cx + 6.5 * S, cy - 5 * S);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
  },
  compare(s, L, lt) {
    if (L.head) lit(c => L.head.lines.forEach((line, k) => text(c, line, M, L.hy + k * L.head.size * 1.1, IN(600, L.head.size), C.t1, 'left', -0.02, L.head.size)), M, M + W * 0.6, seg(lt, OFF * 0.5, OFF * 0.5 + 0.9));
    if (s.kicker) typed(s.kicker, M, L.hy - (L.head ? L.head.size : 0) - 4 * S, 20 * S, C.t3, 0, lt);
    const maxV = L.numeric ? Math.max(L.na.value, L.nb.value) : 1;
    [[L.a, L.na, L.aA, false], [L.b, L.nb, L.bA, true]].forEach(([side, n, a, hero], k) => {
      const q = seg(lt, a - 0.26, a);
      if (q <= 0) return;
      const e = back(q, 1.3), [x, y0] = L.pos[k];
      const y = y0 + (1 - e) * 70 * S;
      ctx.globalAlpha = clamp(q * 2);
      const lockP = hero ? seg(lt, L.bA + B - 0.2, L.bA + B) : 0;
      panel(x, y, L.pw, L.ph, hero ? 3 : 1, hero ? rgba(A, 0.25 + 0.35 * lockP) : ink(0.07), hero && lockP > 0 ? rgba(A, 0.18 * lockP) : null);
      text(ctx, String(side.label || '').toUpperCase(), x + 48 * S, y + 64 * S, MONO(22 * S), hero ? A : C.t3, 'left', 0.14, 22 * S);
      if (!hero) {
        ctx.fillStyle = C.red;
        ctx.beginPath();
        ctx.arc(x + L.pw - 48 * S, y + 56 * S, 8 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      const vy = y + 64 * S + 40 * S + L.vsz * 0.85;
      text(ctx, String(side.value || ''), x + 48 * S, vy, IN(600, L.vsz), hero ? C.t1 : C.t2, 'left', -0.03, L.vsz);
      if (L.numeric) {
        const by = y + L.ph - 64 * S, bw = L.pw - 96 * S;
        ctx.fillStyle = ink(0.06);
        rr(ctx, x + 48 * S, by, bw, 12 * S, 6 * S);
        ctx.fill();
        const g = eo(seg(lt, a, a + B * 1.5)) * (n.value / maxV);
        if (g > 0) {
          ctx.save();
          if (hero) { ctx.shadowColor = rgba(A, 0.6); ctx.shadowBlur = 16 * S; }
          ctx.fillStyle = hero ? A : C.t3;
          rr(ctx, x + 48 * S, by, Math.max(12 * S, bw * g), 12 * S, 6 * S);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    });
  },
  end(s, L, lt) {
    const cp = eo(seg(lt, L.col, L.col + B * 0.75));
    const cx = W / 2 - L.tile / 2, cy = L.gy + L.gh / 2 - L.tile / 2;
    for (let k = 0; k < L.n; k++) {
      const t0 = L.spawn(k), q = seg(lt, t0, t0 + 0.2);
      if (q <= 0) continue;
      const gx = L.gx + (k % L.cols) * (L.tile + L.gap), gy = L.gy + Math.floor(k / L.cols) * (L.tile + L.gap);
      const x = lerp(gx, cx, cp), y = lerp(gy, cy, cp);
      ctx.globalAlpha = clamp(q * 2) * (1 - cp * 0.9);
      ctx.fillStyle = C.s2;
      rr(ctx, x, y, L.tile, L.tile, 16 * S);
      ctx.fill();
      ctx.strokeStyle = ink(0.08);
      ctx.lineWidth = Math.max(1, S);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const lk = seg(lt, L.lockA - 0.12, L.lockA);
    if (lk > 0 && LOGO) {
      const z = L.tile * 1.9 * lerp(1, 1.06, back(lk, 1.3) - lk), x = W / 2 - z * 0.9, y = L.gy + L.gh / 2 - z / 2;
      ctx.globalAlpha = lk;
      panel(x, y, z * 1.8, z, 2, rgba(A, 0.5), rgba(A, 0.25));
      drawLogo(ctx, LOGO, W / 2, y + z * 0.22, z * 0.56, z * 1.5, 'center');
      ctx.globalAlpha = 1;
    } else if (lk > 0) {
      const z = L.tile * lerp(1, 1.15, back(lk, 1.3) - lk);
      ctx.save();
      ctx.shadowColor = rgba(A, 0.6 * lk);
      ctx.shadowBlur = 60 * S;
      ctx.fillStyle = rgba(A, lk);
      rr(ctx, W / 2 - z / 2, L.gy + L.gh / 2 - z / 2, z, z, 18 * S);
      ctx.fill();
      ctx.restore();
    }
    const p = seg(lt, L.r0, L.r1);
    if (lt > L.r0 - 0.05) lit(c => L.t.lines.forEach((line, k) => text(c, line, W / 2, L.ty + k * L.t.size * 1.1, IN(600, L.t.size), C.t1, 'center', -0.02, L.t.size)), W / 2 - L.wMax / 2, W / 2 + L.wMax / 2, p);
    if (L.sub) {
      const q = eo(seg(lt, L.r1, L.r1 + 0.3));
      ctx.globalAlpha = q;
      const y0 = L.ty + (L.t.lines.length - 1) * L.t.size * 1.1 + 44 * S + L.sub.size;
      L.sub.lines.forEach((line, k) => text(ctx, line, W / 2, y0 + k * L.sub.size * 1.3, IN(400, L.sub.size), C.t2, 'center'));
      ctx.globalAlpha = 1;
    }
  },
};

function caption(t, s) {
  if (s.type === 'number') return;   // the big number is the message: no caption over it
  const c = cues.find(c => t >= c.t0 && t < c.t1);
  if (!c) return;
  if (!c.L) c.L = fit(ctx, c.text, z => IN(500, z), W * (portrait ? 0.78 : 0.62), 2, 36 * S, 22 * S, -0.005);
  const { size, lines } = c.L;
  ctx.font = IN(500, size);
  ctx.letterSpacing = -0.005 * size + 'px';
  const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
  const padX = 30 * S, padY = 20 * S, dot = 14 * S, lh = size * 1.3;
  const w = tw + padX * 2 + dot + 18 * S, h = lines.length * lh + padY * 2 - (lh - size) + 6 * S;
  const p = eo(seg(t, c.t0, c.t0 + 0.16)), q = seg(t, c.t1 - 0.12, c.t1);
  const x = W / 2 - w / 2, y = H - M * 0.8 - h + (1 - p) * 12 * S;
  ctx.globalAlpha = p * (1 - q);
  ctx.save();
  ctx.shadowColor = shade(0.5);
  ctx.shadowBlur = 30 * S;
  ctx.fillStyle = rgba(C.s2, 0.9);
  rr(ctx, x, y, w, h, lines.length > 1 ? 26 * S : h / 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = ink(0.12);
  ctx.lineWidth = Math.max(1, S);
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, lines.length > 1 ? 26 * S : h / 2);
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = rgba(A, 0.8);
  ctx.shadowBlur = 12 * S;
  ctx.fillStyle = A;
  ctx.beginPath();
  ctx.arc(x + padX + dot / 2, y + padY + size * 0.45, dot / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  lines.forEach((line, k) => text(ctx, line, x + padX + dot + 18 * S, y + padY + size * 0.82 + k * lh, IN(500, size), C.t1, 'left', -0.005, size));
  ctx.globalAlpha = 1;
}

function makeStage() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  let r = g.createRadialGradient(W / 2, -H * 0.15, 0, W / 2, -H * 0.15, H * 1.2);
  const lift = DARK ? mix(C.bg, '#7c8cb4', 0.5) : '#ffffff';
  r.addColorStop(0, rgba(lift, DARK ? 0.32 : 0.55));
  r.addColorStop(1, rgba(lift, 0));
  g.fillStyle = r;
  g.fillRect(0, 0, W, H);
  r = g.createRadialGradient(W * 0.78, H * 0.3, 0, W * 0.78, H * 0.3, H * 0.7);
  r.addColorStop(0, rgba(A, 0.07));
  r.addColorStop(1, rgba(A, 0));
  g.fillStyle = r;
  g.fillRect(0, 0, W, H);
  const mod = 48 * S;
  for (let i = 0, x = (W / 2) % mod; x < W; x += mod, i++) {
    g.fillStyle = ink(i % 4 === 0 ? 0.055 : 0.028);
    g.fillRect(Math.round(x), 0, 1, H);
  }
  for (let i = 0, y = (H / 2) % mod; y < H; y += mod, i++) {
    g.fillStyle = ink(i % 4 === 0 ? 0.055 : 0.028);
    g.fillRect(0, Math.round(y), W, 1);
  }
  r = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  r.addColorStop(0, 'rgba(0,0,0,0)');
  r.addColorStop(1, `rgba(0,0,0,${DARK ? 0.55 : 0.1})`);
  g.fillStyle = r;
  g.fillRect(0, 0, W, H);
  return c;
}

function draw(t) {
  const s = sceneAt(tl, t), lt = t - s.t0, last = s.i === tl.scenes.length - 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(stage, 0, 0);
  // UI expand / collapse between scenes: the frame opens out of a pill and closes back into one
  const kin = s.i > 0 ? seg(lt, 0, TR) : 1, kout = last ? 0 : seg(lt, s.dur - TR, s.dur);
  const open = kout > 0 ? 1 - eo(kout) : eo(kin);
  ctx.save();
  if (open < 1) {
    const w = lerp(W * 0.24, W, open), h = lerp(4 * S, H, Math.pow(open, 1.6));
    rr(ctx, W / 2 - w / 2, CY - h / 2 + (H / 2 - CY) * open, w, h, lerp(4 * S, 24 * S, 1 - open));
    ctx.clip();
  }
  DRAW[s.type](s, s.L, lt);
  ctx.restore();
  if (open < 1) {
    const w = lerp(W * 0.24, W, open), h = lerp(4 * S, H, Math.pow(open, 1.6));
    ctx.strokeStyle = rgba(A, 0.5 * (1 - open));
    ctx.lineWidth = 1.5 * S;
    rr(ctx, W / 2 - w / 2, CY - h / 2 + (H / 2 - CY) * open, w, h, lerp(4 * S, 24 * S, 1 - open));
    ctx.stroke();
  }
  caption(t, s);
  if (LOGO && s.type !== 'end') drawLogo(ctx, LOGO, 56 * S, 44 * S, 30 * S, 200 * S, 'left', 0.92);
  // the film ends like a screen switching off
  if (last) {
    const k = seg(lt, s.dur - 0.45, s.dur);
    if (k > 0) {
      const sy = Math.max(0.004, 1 - eo(seg(k, 0, 0.6))), sx = 1 - eo(seg(k, 0.6, 1)) * 0.995;
      const snap = layer.getContext('2d');
      snap.setTransform(1, 0, 0, 1, 0, 0);
      snap.clearRect(0, 0, W, H);
      snap.drawImage(ctx.canvas, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(sx, sy);
      ctx.drawImage(layer, -W / 2, -H / 2);
      ctx.restore();
      if (sy < 0.05) {
        ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - seg(k, 0.85, 1))})`;
        ctx.fillRect(W / 2 - (W / 2) * sx, H / 2 - S, W * sx, 2 * S);
      }
    }
  }
}

boot({
  // enough time for each scene's choreography to land and hold before it closes
  minDur(s, content) {
    const b = 60 / Math.min(132, Math.max(84, content.bpm || 104)), n = (s.items || []).length;
    return { title: 0.4 + b * 2 + 1.2 + 1.4, number: 0.4 + b * 2 + 6 * b / 4 + 1.6, list: 0.4 + b * (2 + n) + 1.4, compare: 0.4 + b * 4 + 1.4, end: 0.4 + b * 4.5 + 1.0 + 1.6 }[s.type] || 0;
  },
  fonts: ['600 100px Inter', '700 100px Inter', '500 100px Inter', '400 100px Inter', '500 20px "JetBrains Mono"'],
  setup(o) {
    ({ ctx, W, H, tl, cues } = o);
    const content = o.content;
    S = Math.min(W, H) / 1080;
    portrait = H > W * 1.1;
    M = (portrait ? 64 : 120) * S;
    CY = cues.length ? (H - 120 * S) / 2 : H / 2;
    B = 60 / Math.min(132, Math.max(84, content.bpm || 104));
    TR = fr(0.3);
    OFF = TR + 0.1;
    A = ACCENTS.includes(String(content.accent).toUpperCase()) ? String(content.accent).toUpperCase() : ACCENTS[0];
    const b = o.brand;
    if (b) {
      // a brand kit: stage, surfaces and text from its palette; light brands get a light stage with soft shadows
      const c = b.colors || {}, bg = c.bg || C.bg, fg = c.ink || C.t1, surf = c.surface || mix(bg, fg, 0.06), muted = c.muted || mix(bg, fg, 0.62);
      DARK = isDark(bg);
      C = { ...C, bg, s1: mix(bg, surf, 0.55), s2: surf, s3: mix(surf, fg, 0.07), t1: fg, t2: muted, t3: mix(muted, bg, 0.4) };
      A = c.accent || A;
      if (b.display) { FD = `${b.display.family}, Inter`; FIXED = b.display.fixed; }
      if (b.body) FB = `${b.body.family}, Inter`;
      LOGO = b.logo;
    }
    stage = makeStage();
    layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    layer2 = document.createElement('canvas');
    layer2.width = W;
    layer2.height = H;
    for (const s of tl.scenes) {
      if (!LAYOUT[s.type]) s.type = 'statement';
      s.L = LAYOUT[s.type](s);
    }
  },
  events() {
    const ev = [];
    tl.scenes.forEach((s, i) => {
      for (const e of s.ev) if (e.t < s.dur - TR) ev.push({ ...e, t: s.t0 + e.t });
      if (i < tl.scenes.length - 1) ev.push({ t: s.t1 - TR, type: 'whoosh' });
      else ev.push({ t: s.t1 - 0.45, type: 'off' });
    });
    return ev;
  },
  draw,
});
