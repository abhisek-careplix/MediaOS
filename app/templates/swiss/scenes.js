// Swiss Motion Graphics, quick-mode template: a modular grid, one typeface, one signal colour,
// clip-reveal type that lands on the beat, knife cuts and page wipes. Grammar from styles/swiss-motion/STYLE.md.
import { boot, bezier, fit, parseNumber, formatNumber, seg, sceneAt, fr, mix, rgba, luminance, drawLogo } from './runtime.js';

let PAL = { page: '#EAE9E5', ink: '#111111', g1: '#DCDAD5', g2: '#C3C1BB', g3: '#76746F', body: '#4A4945' };
const SIGNALS = ['#E30613', '#FF5A00', '#1F3FFF', '#00A651'];
const E = bezier(.7, 0, .2, 1);
// headings (700+) in the display face, everything else in the body face; a brand kit can replace both
let FD = 'Archivo', FB = 'Archivo', FIXED = false, LOGO = null, ON_SIG = '#111111';
const F = (w, s) => w >= 700 ? `${FIXED ? 400 : w} ${s}px ${FD}` : `${w} ${s}px ${FB}`;
const MONO = s => `500 ${s}px "JetBrains Mono"`;

let brandName = '', ctx, W, H, S, tl, cues, B, U, TR, OFF, SIG, cols, M, G, colW, bottom, portrait, total, title;
const X = i => M + i * (colW + G);
const SPAN = n => n * colW + (n - 1) * G;
const snapIn = (lt, ta) => E(seg(lt, ta - U * 1.5, ta));

// text rising out of a clip rect from below its baseline; q > 0 lifts it out upward
function rise(text, x, y, size, font, p, color = PAL.ink, track = -0.02, q = 0) {
  if (p <= 0 || q >= 1) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 8 * S, y - size * 1.02, W, size * 1.3);
  ctx.clip();
  ctx.font = font;
  ctx.letterSpacing = track * size + 'px';
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y + (1 - p) * size * 1.3 - q * size * 1.3);
  ctx.restore();
}
const note = (text, x, y, p) => rise(String(text || '').toUpperCase(), x, y, 19 * S, MONO(19 * S), p, PAL.g3, 0.06);
function rule(x, y, w, p, color = PAL.g2) {
  if (p <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * p, Math.max(1, S));
}
// optical flush-left: shift by the glyph's left side bearing
function opticalX(text, font, x) {
  ctx.font = font;
  return x + ctx.measureText(text).actualBoundingBoxLeft;
}

const transOut = s => (s.i === tl.scenes.length - 1 || s.i % 2 === 1 ? 'knife' : 'wipe');

// —— layout + timing per scene, computed once ——
const LAYOUT = {
  title(s) {
    const L = {};
    L.block = portrait ? [0, 0, W, H * 0.42] : [0, 0, X(5) - G, H];
    L.x = portrait ? X(0) : X(6);
    const w = SPAN(6);
    L.t = fit(ctx, s.text, z => F(800, z), w, 3, (portrait ? 120 : 140) * S, 40 * S, -0.02);
    L.sub = s.sub ? fit(ctx, s.sub, z => F(500, z), w, 2, 34 * S, 22 * S) : null;
    const blockH = L.t.lines.length * L.t.size * 1.0 + (L.sub ? 40 * S + L.sub.lines.length * L.sub.size * 1.25 : 0);
    L.y = portrait ? H * 0.42 + Math.max(110 * S, (bottom - H * 0.42 - blockH) / 2) + L.t.size * 0.8 : (H - blockH) / 2 + L.t.size * 0.8;
    L.arr = L.t.lines.map((_, k) => OFF + U * (3 + k));
    L.subA = OFF + U * (3 + L.t.lines.length + 1);
    s.ev = [{ t: OFF + U * 2, type: 'block' }, ...L.arr.map(t => ({ t, type: 'snap' })), ...(L.sub ? [{ t: L.subA, type: 'snap', soft: 1 }] : [])];
    return L;
  },
  statement(s) {
    const L = {};
    L.num = String(s.i + 1).padStart(2, '0');
    L.numSize = portrait ? H * 0.26 : H * 0.62;
    L.x = portrait ? X(0) : X(4);
    const w = portrait ? SPAN(6) : SPAN(8);
    L.t = fit(ctx, s.text, z => F(800, z), w, 4, (portrait ? 96 : 108) * S, 36 * S, -0.02);
    L.sub = s.sub ? fit(ctx, s.sub, z => F(500, z), w, 3, 34 * S, 22 * S) : null;
    L.y = portrait ? H * 0.46 : H * 0.34 + L.t.size * 0.8;
    L.arr = L.t.lines.map((_, k) => OFF + U * (2 + k));
    L.subA = OFF + U * (3 + L.t.lines.length);
    L.barA = L.subA + U;
    s.ev = [...L.arr.map(t => ({ t, type: 'snap' })), ...(L.sub ? [{ t: L.subA, type: 'snap', soft: 1 }] : []), { t: L.barA, type: 'glide' }];
    return L;
  },
  number(s) {
    const L = {};
    L.n = parseNumber(s.number);
    const full = L.n ? formatNumber(L.n, L.n.value) : String(s.number || '');
    const w = portrait ? SPAN(6) : SPAN(8);
    L.big = fit(ctx, full, z => F(800, z), w, 1, portrait ? H * 0.24 : H * 0.6, 60 * S, -0.03);
    L.x = opticalX(full, F(800, L.big.size), X(0));
    L.y = portrait ? H * 0.30 + L.big.size * 0.82 : bottom;
    L.nx = portrait ? X(0) : X(9);
    L.nw = portrait ? SPAN(6) : SPAN(3);
    L.ny = portrait ? L.y + 110 * S : H * 0.24;
    L.unit = s.unit ? fit(ctx, s.unit, z => F(700, z), L.nw, 2, 44 * S, 24 * S) : null;
    L.cap = s.text ? fit(ctx, s.text, z => F(600, z), L.nw, portrait ? 3 : 6, 36 * S, 22 * S) : null;
    L.inA = OFF + U * 2;
    const sixteenth = B / 4;
    L.c0 = L.inA;
    L.steps = Math.max(6, Math.min(18, Math.round((U * 6) / sixteenth)));
    L.c1 = L.c0 + L.steps * sixteenth;
    L.noteA = L.c1 + U;
    s.ev = [{ t: L.inA, type: 'snap' }];
    if (L.n) for (let k = 1; k < L.steps; k++) s.ev.push({ t: L.c0 + k * sixteenth, type: 'tick' });
    s.ev.push({ t: L.c1, type: 'lock' }, { t: L.noteA, type: 'snap', soft: 1 });
    return L;
  },
  list(s) {
    const L = {};
    L.items = (s.items || []).slice(0, 5);
    const w = portrait ? SPAN(6) : SPAN(7);
    L.t = fit(ctx, s.text, z => F(800, z), w, 2, (portrait ? 72 : 80) * S, 32 * S, -0.02);
    L.ty = M + 80 * S + L.t.size * 0.8;
    const yA = L.ty + (L.t.lines.length - 1) * L.t.size + 60 * S;
    L.rowH = Math.min((portrait ? 230 : 170) * S, (bottom - yA) / Math.max(1, L.items.length));
    L.yA = yA;
    L.ix = portrait ? X(1) : X(2);
    const iw = portrait ? SPAN(5) : SPAN(9);
    L.rows = L.items.map(it => fit(ctx, it, z => F(700, z), iw, portrait ? 2 : 1, Math.min(54 * S, L.rowH * 0.42), 20 * S, -0.01));
    L.arr = L.items.map((_, k) => OFF + U * (4 + 2 * k));
    L.tArr = L.t.lines.map((_, k) => OFF + U * (1 + k));
    s.ev = [...L.tArr.map(t => ({ t, type: 'snap' })), ...L.arr.map((t, k) => ({ t, type: k === L.items.length - 1 ? 'accent' : 'snap' }))];
    return L;
  },
  compare(s) {
    const L = {};
    const a = s.left || {}, b = s.right || {};
    L.a = a; L.b = b;
    L.na = parseNumber(a.value); L.nb = parseNumber(b.value);
    L.numeric = !!(L.na && L.nb && L.na.value >= 0 && L.nb.value >= 0 && Math.max(L.na.value, L.nb.value) > 0);
    L.t = s.text ? fit(ctx, s.text, z => F(800, z), portrait ? SPAN(6) : SPAN(10), 2, (portrait ? 64 : 72) * S, 30 * S, -0.02) : { lines: [], size: 0 };
    L.ty = M + 80 * S + L.t.size * 0.8;
    L.top = L.ty + (L.t.lines.length ? (L.t.lines.length - 1) * L.t.size + 70 * S : 0);
    const pw = portrait ? SPAN(6) : SPAN(6) - G;
    L.pw = pw;
    L.va = fit(ctx, String(a.value || ''), z => F(800, z), pw, 1, (portrait ? 110 : 140) * S, 30 * S, -0.03);
    L.vb = fit(ctx, String(b.value || ''), z => F(800, z), pw, 1, (portrait ? 110 : 140) * S, 30 * S, -0.03);
    L.vs = Math.min(L.va.size, L.vb.size);
    L.tArr = L.t.lines.map((_, k) => OFF + U * (1 + k));
    L.aA = OFF + U * (2 + L.t.lines.length);
    L.bA = L.aA + U * 3;
    s.ev = [...L.tArr.map(t => ({ t, type: 'snap' })), { t: L.aA, type: 'snap' }, { t: L.bA, type: 'accent' }];
    return L;
  },
  end(s) {
    const L = {};
    const w = portrait ? SPAN(5) : SPAN(9);
    L.t = fit(ctx, s.text, z => F(800, z), w, 3, (portrait ? 96 : 120) * S, 36 * S, -0.02);
    L.sub = s.sub ? fit(ctx, s.sub, z => F(500, z), w, 2, 32 * S, 20 * S) : null;
    L.y = bottom - (L.t.lines.length - 1) * L.t.size;
    L.arr = L.t.lines.map((_, k) => OFF + U * (2 + k));
    L.dotA = L.arr[L.arr.length - 1] + U * 4;
    s.ev = [...L.arr.map(t => ({ t, type: 'snap' })), { t: L.dotA, type: 'accent' }];
    return L;
  },
};

// —— drawing ——
const DRAW = {
  title(s, L, lt) {
    const [bx, by, bw, bh] = L.block, p = E(seg(lt, OFF, OFF + U * 2));
    ctx.fillStyle = SIG;
    if (portrait) ctx.fillRect(bx, by, bw, bh * p); else ctx.fillRect(bx, by, bw * p, bh);
    if (p > 0.95) {
      ctx.font = MONO(19 * S);
      ctx.letterSpacing = 1.2 * S + 'px';
      ctx.fillStyle = ON_SIG;
      ctx.fillText('Nº 01 — ' + String(brandName || title).toUpperCase(), M, (portrait ? bh : bh) - M * 0.6);
    }
    const ky = L.y - L.t.size * 1.15;
    rule(L.x, ky - 30 * S, SPAN(portrait ? 6 : 6), seg(lt, OFF + U, OFF + U * 4));
    note(s.kicker, L.x, ky, snapIn(lt, OFF + U * 2));
    L.t.lines.forEach((line, k) => rise(line, L.x, L.y + k * L.t.size, L.t.size, F(800, L.t.size), snapIn(lt, L.arr[k])));
    if (L.sub) {
      const y0 = L.y + (L.t.lines.length - 1) * L.t.size + 40 * S + L.sub.size;
      L.sub.lines.forEach((line, k) => rise(line, L.x, y0 + k * L.sub.size * 1.25, L.sub.size, F(500, L.sub.size), snapIn(lt, L.subA), PAL.body, 0));
    }
  },
  statement(s, L, lt) {
    // the giant chapter numeral climbs one module at a time, in light grey under the black type
    const size = L.numSize, font = F(800, size);
    const k = seg(lt, OFF, OFF + U * 4) * 4, i = Math.floor(k), v = Math.min(1, (i + E(k - i)) / 4);
    const nx = opticalX(L.num, font, X(0));
    const ny = portrait ? M + 30 * S + size * 0.75 : bottom;
    rise(L.num, nx, ny, size, font, v, PAL.g1, -0.04);
    const ky = L.y - L.t.size * 1.15;
    rule(L.x, ky - 30 * S, portrait ? SPAN(6) : SPAN(8), seg(lt, OFF, OFF + U * 3));
    note(s.kicker, L.x, ky, snapIn(lt, OFF + U));
    L.t.lines.forEach((line, k2) => rise(line, L.x, L.y + k2 * L.t.size, L.t.size, F(800, L.t.size), snapIn(lt, L.arr[k2])));
    let y = L.y + (L.t.lines.length - 1) * L.t.size;
    if (L.sub) {
      const y0 = y + 36 * S + L.sub.size;
      L.sub.lines.forEach((line, k2) => rise(line, L.x, y0 + k2 * L.sub.size * 1.3, L.sub.size, F(500, L.sub.size), snapIn(lt, L.subA), PAL.body, 0));
      y = y0 + (L.sub.lines.length - 1) * L.sub.size * 1.3;
    }
    // the exception: one signal bar that grows linearly, unsnapped
    const g = seg(lt, L.barA, L.barA + U * 6);
    if (g > 0) { ctx.fillStyle = SIG; ctx.fillRect(L.x, y + 44 * S, SPAN(3) * g, 16 * S); }
  },
  number(s, L, lt) {
    let text = String(s.number || '');
    if (L.n) {
      const k = Math.floor(seg(lt, L.c0, L.c1) * L.steps + 1e-6) / L.steps;
      const v = k >= 1 ? L.n.value : L.n.value * E(k);
      text = formatNumber(L.n, v);
    }
    rise(text, L.x, L.y, L.big.size, F(800, L.big.size), snapIn(lt, L.inA), SIG, -0.03);
    let y = L.ny;
    rule(L.nx, y, L.nw, seg(lt, L.c1 - U * 2, L.c1));
    note(s.kicker, L.nx, y + 40 * S, snapIn(lt, L.c1));
    y += 40 * S;
    if (L.unit) {
      y += 30 * S + L.unit.size;
      L.unit.lines.forEach((line, k) => rise(line, L.nx, y + k * L.unit.size * 1.1, L.unit.size, F(700, L.unit.size), snapIn(lt, L.noteA)));
      y += (L.unit.lines.length - 1) * L.unit.size * 1.1;
    }
    if (L.cap) {
      y += 30 * S + L.cap.size;
      L.cap.lines.forEach((line, k) => rise(line, L.nx, y + k * L.cap.size * 1.25, L.cap.size, F(600, L.cap.size), snapIn(lt, L.noteA + U), PAL.body, -0.01));
    }
  },
  list(s, L, lt) {
    note(s.kicker, X(0), L.ty - L.t.size * 1.15, snapIn(lt, OFF));
    L.t.lines.forEach((line, k) => rise(line, X(0), L.ty + k * L.t.size, L.t.size, F(800, L.t.size), snapIn(lt, L.tArr[k])));
    const last = L.items.length - 1;
    L.rows.forEach((r, k) => {
      const a = L.arr[k], y = L.yA + k * L.rowH;
      rule(X(0), y, SPAN(cols), seg(lt, a - U * 2, a), k === 0 ? PAL.ink : PAL.g2);
      const base = y + L.rowH * 0.5 + r.size * 0.35 - (r.lines.length - 1) * r.size * 0.5;
      rise(String(k + 1).padStart(2, '0'), X(0), y + 34 * S, 19 * S, MONO(19 * S), snapIn(lt, a), PAL.g3, 0.06);
      r.lines.forEach((line, j) => rise(line, L.ix, base + j * r.size * 1.05, r.size, F(700, r.size), snapIn(lt, a), PAL.ink, -0.01));
      const p = snapIn(lt, a);
      if (p > 0) {
        const z = (k === last ? 26 : 12) * S * p;
        ctx.fillStyle = k === last ? SIG : PAL.g2;
        ctx.fillRect(X(cols - 1) + colW - z, y + L.rowH * 0.5 - z / 2, z, z);
      }
    });
  },
  compare(s, L, lt) {
    L.t.lines.forEach((line, k) => rise(line, X(0), L.ty + k * L.t.size, L.t.size, F(800, L.t.size), snapIn(lt, L.tArr[k])));
    const sides = [[L.a, L.na, L.aA, PAL.ink], [L.b, L.nb, L.bA, SIG]];
    const maxV = L.numeric ? Math.max(L.na.value, L.nb.value) : 1;
    if (!portrait) {
      const gx = X(6) - G / 2;
      ctx.fillStyle = PAL.g2;
      ctx.fillRect(gx, L.top - 20 * S, Math.max(1, S), (bottom - L.top + 20 * S) * seg(lt, L.aA - U * 2, L.bA));
    }
    sides.forEach(([side, n, a, color], k) => {
      const x = portrait ? X(0) : X(k * 6);
      const half = (bottom - L.top) / 2;
      const y0 = portrait ? L.top + k * half : L.top;
      note(side.label, x, y0 + 20 * S, snapIn(lt, a));
      const vy = y0 + 40 * S + L.vs * 0.82;
      rise(String(side.value || ''), x, vy, L.vs, F(800, L.vs), snapIn(lt, a), k ? SIG : PAL.ink, -0.03);
      if (L.numeric) {
        const g = E(seg(lt, a, a + U * 3)) * (n.value / maxV);
        ctx.fillStyle = color;
        if (portrait) {
          const by = vy + 30 * S;
          ctx.fillRect(x, by, SPAN(6) * g, Math.min(56 * S, half - (by - y0) - 20 * S));
        } else {
          const by = vy + 50 * S, maxH = bottom - by;
          ctx.fillRect(x, bottom - maxH * g, SPAN(2), maxH * g + 1);
        }
      }
    });
  },
  end(s, L, lt) {
    if (LOGO) {
      const p = snapIn(lt, OFF + U * 2), lh = (portrait ? 84 : 96) * S;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, M, W, lh + 20 * S);
      ctx.clip();
      drawLogo(ctx, LOGO, X(0), M + 10 * S + (1 - p) * (lh + 20 * S), lh, SPAN(portrait ? 4 : 5), 'left', p);
      ctx.restore();
    }
    const top = L.y - L.t.size * 1.1;
    if (L.sub) L.sub.lines.forEach((line, k) => rise(line, X(0), top - 30 * S - (L.sub.lines.length - 1 - k) * L.sub.size * 1.3, L.sub.size, F(500, L.sub.size), snapIn(lt, OFF + U), PAL.body, 0));
    note(s.kicker, X(0), top - (L.sub ? 50 * S + L.sub.lines.length * L.sub.size * 1.3 : 30 * S), snapIn(lt, OFF));
    L.t.lines.forEach((line, k) => rise(line, X(0), L.y + k * L.t.size, L.t.size, F(800, L.t.size), snapIn(lt, L.arr[k])));
    // the signal square glides in linearly and stops after the last word
    const last = L.t.lines[L.t.lines.length - 1];
    ctx.font = F(800, L.t.size);
    ctx.letterSpacing = -0.02 * L.t.size + 'px';
    const z = L.t.size * 0.62, tx = X(0) + ctx.measureText(last).width + L.t.size * 0.18;
    const g = seg(lt, L.dotA - U * 4, L.dotA);
    if (g > 0) {
      ctx.fillStyle = SIG;
      ctx.fillRect(W + z - (W + z - tx) * g, bottom - z, z, z);
    }
  },
};

function guides() {
  ctx.fillStyle = rgba(PAL.ink, 0.045);
  for (let i = 0; i <= cols; i++) {
    const x = i === cols ? X(cols - 1) + colW : X(i);
    ctx.fillRect(Math.round(x), 0, 1, H);
  }
}

function chrome(s) {
  ctx.font = MONO(17 * S);
  ctx.letterSpacing = 1.2 * S + 'px';
  ctx.fillStyle = PAL.g3;
  ctx.textAlign = 'right';
  ctx.fillText(`${String(s.i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, W - M, H - M * 0.45);
  ctx.textAlign = 'left';
  // the brand's mark rides in the top corner, except on the end card where it is the hero
  if (LOGO && s.type !== 'end') drawLogo(ctx, LOGO, W - M, M * 0.42, 34 * S, 220 * S, 'right');
}

// captions sit on a column start in the layout; on a landscape title they move off the signal block
function caption(t, s) {
  const c = cues.find(c => t >= c.t0 && t < c.t1);
  if (!c) return;
  const onBlock = s.type === 'title' && !portrait;
  const x = onBlock ? X(6) : X(0), w = onBlock || portrait ? SPAN(6) : SPAN(8);
  if (!c.L || c.L.w !== w) c.L = { w, ...fit(ctx, c.text, z => F(600, z), w, 2, 34 * S, 22 * S, -0.005) };
  const { size, lines } = c.L;
  const p = E(seg(t, c.t0, c.t0 + 0.22)), q = E(seg(t, c.t1 - 0.18, c.t1));
  const y0 = H - M * 0.95 - (lines.length - 1) * size * 1.2;
  ctx.fillStyle = PAL.page;
  ctx.fillRect(x - 12 * S, y0 - size * 1.35, w + 24 * S, lines.length * size * 1.2 + size * 0.75);
  rule(x, y0 - size * 1.25, w, p, PAL.ink);
  lines.forEach((line, k) => rise(line, x, y0 + k * size * 1.2, size, F(600, size), p, PAL.ink, -0.005, q));
}

function draw(t) {
  const s = sceneAt(tl, t), lt = t - s.t0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAL.page;
  ctx.fillRect(0, 0, W, H);
  guides();
  const k = seg(lt, s.dur - TR, s.dur), out = transOut(s);
  ctx.save();
  if (out === 'knife' && k > 0.55) {
    const c = E(seg(k, 0.55, 1));
    ctx.translate(0, H / 2);
    ctx.scale(1, Math.max(1e-4, 1 - c));
    ctx.translate(0, -H / 2);
  }
  DRAW[s.type](s, s.L, lt);
  ctx.restore();
  chrome(s);
  caption(t, s);
  if (out === 'knife' && k > 0) {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, H / 2 - S, W * seg(k, 0, 0.55), 2 * S);
  }
  if (out === 'wipe' && k > 0) {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, 0, W * E(k), H);
  }
  const prev = tl.scenes[s.i - 1];
  if (prev && transOut(prev) === 'wipe') {
    const w = seg(lt, 0, TR);
    if (w < 1) {
      const x = W * E(w);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x, 0, W - x, H);
    }
  }
}

boot({
  // enough time for each scene's choreography to land and hold before it closes
  minDur(s, content) {
    const u = 30 / Math.min(132, Math.max(84, content.bpm || 112)), n = (s.items || []).length;
    return { title: u * 8 + 1.4, number: u * 2 + 1.6 + u * 4 + 1.4, list: u * (4 + 2 * n) + 1.2, compare: u * 8 + 1.4, end: u * 9 + 1.2 }[s.type] || 0;
  },
  fonts: ['800 100px Archivo', '700 100px Archivo', '600 100px Archivo', '500 100px Archivo', '500 20px "JetBrains Mono"'],
  setup(o) {
    ({ ctx, W, H, tl, cues } = o);
    const content = o.content;
    S = Math.min(W, H) / 1080;
    portrait = H > W * 1.1;
    cols = portrait ? 6 : 12;
    M = (portrait ? 64 : 96) * S;
    G = 24 * S;
    colW = (W - 2 * M - (cols - 1) * G) / cols;
    bottom = H - M - (cues.length ? 150 * S : 40 * S);
    B = 60 / Math.min(132, Math.max(84, content.bpm || 112));
    U = fr(B / 2);
    TR = fr(Math.min(0.42, B * 0.75));
    OFF = TR * 0.6;
    SIG = SIGNALS.includes(String(content.accent).toUpperCase()) ? String(content.accent).toUpperCase() : SIGNALS[0];
    const b = o.brand;
    if (b) {
      // a brand kit: its page, ink and accent; the greys are mixed from them so the grid stays quiet
      const c = b.colors || {}, page = c.bg || PAL.page, ink = c.ink || PAL.ink;
      PAL = { page, ink, g1: mix(page, ink, 0.09), g2: mix(page, ink, 0.22), g3: c.muted || mix(page, ink, 0.55), body: mix(c.muted || ink, ink, 0.45) };
      SIG = c.accent || SIG;
      ON_SIG = Math.abs(luminance(SIG) - luminance(ink)) > Math.abs(luminance(SIG) - luminance(page)) ? ink : page;
      if (b.display) { FD = `${b.display.family}, Archivo`; FIXED = b.display.fixed; }
      if (b.body) FB = `${b.body.family}, Archivo`;
      LOGO = b.logo;
      brandName = b.name || '';
    }
    total = tl.scenes.length;
    title = content.title || '';
    for (const s of tl.scenes) {
      if (!LAYOUT[s.type]) s.type = 'statement';
      s.L = LAYOUT[s.type](s);
    }
  },
  events() {
    const ev = [];
    for (const s of tl.scenes) {
      for (const e of s.ev) if (e.t < s.dur - TR) ev.push({ ...e, t: s.t0 + e.t });
      const out = transOut(s);
      ev.push({ t: s.t1 - TR, type: out === 'knife' ? 'knife' : 'wipe' });
    }
    return ev;
  },
  draw,
});
