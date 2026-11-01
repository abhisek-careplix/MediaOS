// Deck layout engine, shared by the browser preview, the PDF export and the PowerPoint export.
// layoutSlide() turns a slide into positioned elements on a 1280×720 canvas; renderSlideHTML() draws them as HTML/SVG,
// and the server's PPTX writer maps the same elements to native PowerPoint text, shapes and charts.
// Pure functions only (no DOM), so Node can import this file too.

export const W = 1280, H = 720, M = 64;
export const LAYOUTS = [
  ['title', 'Title'], ['agenda', 'Agenda'], ['statement', 'Statement'], ['bignumber', 'Big number'], ['chart', 'Chart'],
  ['compare', 'Comparison'], ['process', 'Process'], ['quote', 'Quote'], ['cards', 'Cards'], ['closing', 'Closing'],
];
export const DEFAULT_THEME = { colors: { bg: '#ffffff', surface: '#f2f4f7', ink: '#0f1720', muted: '#5b6573', accent: '#0a84ff' }, fonts: { display: 'Inter', body: 'Inter' }, logo: null, name: '' };

// —— colour helpers ——
const rgb = h => { const n = parseInt(String(h).replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const mix = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const lum = hex => { const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

export function themeFrom(brand) {
  if (!brand) return DEFAULT_THEME;
  return { colors: { ...DEFAULT_THEME.colors, ...brand.colors }, fonts: { display: brand.fonts?.display?.family || brand.fonts?.display || 'Inter', body: brand.fonts?.body?.family || brand.fonts?.body || 'Inter' }, logo: brand.logo || null, name: brand.name || '' };
}
export const seriesColors = c => [c.accent, mix(c.ink, c.bg, 0.35), mix(c.accent, c.bg, 0.5), mix(c.muted, c.bg, 0.3), mix(c.ink, c.bg, 0.65)];

// —— text fitting (the same estimate on both sides keeps PPTX and preview in step) ——
// average glyph width per font size, a little generous so real fonts rarely overflow what the estimate fits
const CW = { display: 0.6, body: 0.56, mono: 0.62 };
function wrapCount(text, perLine) {
  let lines = 0;
  for (const para of String(text || '').split('\n')) {
    let len = 0;
    lines++;
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (len && len + 1 + w.length > perLine) { lines++; len = w.length; } else len += (len ? 1 : 0) + w.length;
    }
  }
  return lines;
}
export function fitSize(text, w, h, max, min, font = 'body', lh = 1.15, k = 1) {
  for (let s = max; s >= min; s -= 1) {
    const per = Math.max(4, Math.floor(w / (s * CW[font] * k)));
    if (wrapCount(text, per) * s * lh <= h) return s;
  }
  return min;
}
// one line, as large as fits: for headline numbers that must never wrap
export const fitLine = (text, w, max, min, font = 'display', k = 1.2) => Math.max(min, Math.min(max, Math.floor(w / (Math.max(1, String(text || '').length) * CW[font] * k))));
const fitList = (items, w, h, max, min, font = 'body', lh = 1.3, gap = 0.6) => {
  for (let s = max; s >= min; s -= 1) {
    const per = Math.max(4, Math.floor((w - s * 1.2) / (s * CW[font])));
    const total = items.reduce((a, t) => a + wrapCount(t, per) * s * lh + s * gap, 0);
    if (total <= h) return s;
  }
  return min;
};

// —— element builders ——
const T = (x, y, w, h, text, o = {}) => ({ type: 'text', x, y, w, h, text: String(text ?? ''), font: 'body', size: 20, weight: 400, color: '#000', align: 'left', valign: 'top', lh: 1.15, ...o });
const R = (x, y, w, h, o = {}) => ({ type: 'rect', x, y, w, h, fill: null, line: null, radius: 0, ...o });

export const closingColors = c => lum(c.bg) < lum(c.ink) ? { dark: c.bg, light: c.ink } : { dark: c.ink, light: c.bg };

// The logo in a box at (x, y, w, h) on a background bg. A prepared theme (logoR, logoHist from templates/shared/logo.js)
// gets the logo trimmed and sized by its visible area, so wordmarks and square marks carry the same weight, and its
// one-colour version where bg would hide too much of it; otherwise the file is fitted into the box as it is.
function logoEl(th, x, y, w, h, bg) {
  if (!th.logoR) return { type: 'image', x, y, w, h, src: th.logo, variant: 'logo', fit: 'contain-left' };
  let lh = Math.min(h * 1.5, Math.sqrt(w * h / th.logoR)), lw = lh * th.logoR;
  if (lw > w) { lw = w; lh = lw / th.logoR; }
  const l = lum(bg), cr = v => (Math.max(v, l) + 0.05) / (Math.min(v, l) + 0.05);
  const lost = th.logoHist.reduce((s, v, i) => s + (v && cr((i + 0.5) / 64) < 1.6 ? v : 0), 0);
  const variant = lost <= 0.18 ? 'logo' : l < 0.4 ? 'light' : 'dark';
  return { type: 'image', x, y: y + (h - lh) / 2, w: lw, h: lh, src: { logo: th.logo, light: th.logoLight, dark: th.logoDark }[variant], variant, fit: 'contain-left' };
}

function chrome(els, slide, theme, ctx, { dark = false, bg = theme.colors.bg } = {}) {
  const c = theme.colors, fg = dark ? closingColors(c).light : c.muted;
  // exported despite failed checks: say so on every slide
  if (ctx.draft) els.push(T(W - M - 420, 20, 420, 20, 'DRAFT · contains unverified claims', { font: 'mono', size: 12, weight: 700, color: '#d92d20', align: 'right', spacing: 0.08 }));
  if (theme.logo && slide.layout !== 'title' && slide.layout !== 'closing') els.push(logoEl(theme, M, H - 52, 140, 24, bg));
  els.push(T(W - M - 80, H - 50, 80, 20, `${ctx.index + 1}`, { size: 12, color: fg, align: 'right', font: 'mono' }));
  // the sources behind the claims on this slide
  const notes = (slide.proof || []).map(id => ctx.proof?.[id]).filter(Boolean);
  if (notes.length) {
    const txt = notes.map(p => [p.source?.title ? 'Source: ' + p.source.title : null, p.disclaimer].filter(Boolean).join('. ')).filter(Boolean).join('  ·  ');
    if (txt) els.push(T(theme.logo ? M + 160 : M, H - 52, W - 2 * M - 260 + (theme.logo ? 0 : 160), 32, txt, { size: 10, color: fg, lh: 1.25 }));
  }
}

function heading(els, slide, theme, y = 56, w = W - 2 * M) {
  const c = theme.colors;
  let top = y;
  if (slide.kicker) { els.push(T(M, top, w, 20, String(slide.kicker).toUpperCase(), { font: 'mono', size: 13, weight: 600, color: c.accent, spacing: 0.12 })); top += 30; }
  const size = fitSize(slide.title, w, 120, 44, 26, 'display', 1.08);
  els.push(T(M, top, w, 120, slide.title, { font: 'display', size, weight: 700, color: c.ink, lh: 1.08, spacing: -0.015 }));
  const lines = Math.max(1, Math.ceil(slide.title ? wrapCount(slide.title, Math.floor(w / (size * CW.display))) : 1));
  return top + lines * size * 1.08 + 28;
}

const L = {
  title(s, th) {
    const c = th.colors, els = [];
    els.push(R(0, 0, W, H, { fill: c.bg }));
    els.push(R(W - 420, -120, 560, 560, { fill: mix(c.accent, c.bg, 0.86), radius: 280 }));
    els.push(R(W - 250, 380, 300, 300, { fill: mix(c.accent, c.bg, 0.72), radius: 150 }));
    els.push(R(M, 236, 8, 220, { fill: c.accent, radius: 4 }));
    if (th.logo) els.push(logoEl(th, M, 64, 220, 44, c.bg));
    if (s.kicker) els.push(T(M + 36, 236, 760, 22, String(s.kicker).toUpperCase(), { font: 'mono', size: 14, weight: 600, color: c.accent, spacing: 0.12 }));
    const ts = fitSize(s.title, 800, 170, 68, 36, 'display', 1.04);
    els.push(T(M + 36, 268, 800, 170, s.title, { font: 'display', size: ts, weight: 700, color: c.ink, lh: 1.04, spacing: -0.02, valign: 'top' }));
    if (s.body) els.push(T(M + 36, 456, 760, 90, s.body, { size: fitSize(s.body, 760, 90, 24, 16, 'body', 1.35), color: c.muted, lh: 1.35 }));
    if (s.footer) els.push(T(M, H - 92, 800, 24, s.footer, { size: 15, color: c.muted }));
    return els;
  },
  agenda(s, th) {
    const c = th.colors, els = [R(0, 0, W, H, { fill: c.bg })], y = heading(els, s, th);
    const items = (s.bullets || []).slice(0, 8), two = items.length > 4, colW = two ? (W - 2 * M - 48) / 2 : W - 2 * M;
    const per = two ? Math.ceil(items.length / 2) : items.length, rowH = Math.min(96, (H - 110 - y) / Math.max(1, per));
    items.forEach((t, i) => {
      const col = two && i >= per ? 1 : 0, r = col ? i - per : i, x = M + col * (colW + 48), yy = y + r * rowH;
      els.push(R(x, yy, colW, 1, { fill: mix(c.ink, c.bg, 0.85) }));
      els.push(T(x, yy + 16, 70, 40, String(i + 1).padStart(2, '0'), { font: 'display', size: 28, weight: 700, color: c.accent }));
      els.push(T(x + 80, yy + 18, colW - 80, rowH - 24, t, { size: fitSize(t, colW - 80, rowH - 24, 24, 15, 'body', 1.25), color: c.ink, lh: 1.25 }));
    });
    return els;
  },
  statement(s, th) {
    const c = th.colors, els = [R(0, 0, W, H, { fill: c.bg })];
    if (s.kicker) els.push(T(M, 72, 900, 20, String(s.kicker).toUpperCase(), { font: 'mono', size: 13, weight: 600, color: c.accent, spacing: 0.12 }));
    // the title sets the rhythm: rule and supporting points follow right under it
    const tw = W - 2 * M - 120, ts = fitSize(s.title, tw, 230, 54, 30, 'display', 1.08);
    const tl = wrapCount(s.title, Math.floor(tw / (ts * CW.display))), titleH = tl * ts * 1.08;
    const top = Math.max(108, 300 - titleH / 2 - 60);
    els.push(T(M, top, tw, titleH + 8, s.title, { font: 'display', size: ts, weight: 700, color: c.ink, lh: 1.08, spacing: -0.02 }));
    const ry = top + titleH + 40;
    els.push(R(M, ry, 80, 6, { fill: c.accent, radius: 3 }));
    const pts = (s.bullets || []).slice(0, 4), py = ry + 40, ph = H - 110 - py;
    if (pts.length) {
      const colW = (W - 2 * M - 32 * (pts.length - 1)) / pts.length, size = Math.min(...pts.map(p => fitSize(p, colW, ph, 22, 14, 'body', 1.4)));
      pts.forEach((p, i) => els.push(T(M + i * (colW + 32), py, colW, ph, p, { size, color: c.muted, lh: 1.4 })));
    } else if (s.body) els.push(T(M, py, 900, ph, s.body, { size: fitSize(s.body, 900, ph, 26, 16, 'body', 1.4), color: c.muted, lh: 1.4 }));
    return els;
  },
  bignumber(s, th) {
    const c = th.colors, els = [R(0, 0, W, H, { fill: c.bg })];
    if (s.kicker) els.push(T(M, 72, 700, 20, String(s.kicker).toUpperCase(), { font: 'mono', size: 13, weight: 600, color: c.accent, spacing: 0.12 }));
    const val = s.number?.value || '', ns = fitLine(val, 700, 190, 56);
    els.push(T(M - 6, 140, 720, 230, val, { font: 'display', size: ns, weight: 800, color: c.accent, lh: 1, spacing: -0.04, valign: 'bottom' }));
    els.push(T(M, 392, 640, 110, s.number?.label || '', { font: 'display', size: fitSize(s.number?.label, 640, 110, 32, 18, 'display'), weight: 600, color: c.ink, lh: 1.15 }));
    els.push(R(800, 150, 1, 380, { fill: mix(c.ink, c.bg, 0.82) }));
    if (s.title) els.push(T(840, 150, W - M - 840, 120, s.title, { font: 'display', size: fitSize(s.title, W - M - 840, 120, 30, 18, 'display'), weight: 700, color: c.ink, lh: 1.15 }));
    if (s.body) els.push(T(840, 290, W - M - 840, 240, s.body, { size: fitSize(s.body, W - M - 840, 240, 20, 12, 'body', 1.45), color: c.muted, lh: 1.45 }));
    return els;
  },
  chart(s, th) {
    const c = th.colors, els = [R(0, 0, W, H, { fill: c.bg })], y = heading(els, s, th, 56, W - 2 * M);
    const hasSide = !!(s.body || s.number?.value), cw = hasSide ? 780 : W - 2 * M;
    els.push({ type: 'chart', x: M, y, w: cw, h: H - 96 - y, chart: s.chart || { type: 'column', categories: [], series: [] }, colors: seriesColors(c), ink: c.ink, muted: c.muted, grid: mix(c.ink, c.bg, 0.88), font: 'body' });
    if (hasSide) {
      const x = M + cw + 48, w = W - M - x;
      let yy = y + 10;
      if (s.number?.value) {
        els.push(T(x, yy, w, 90, s.number.value, { font: 'display', size: fitLine(s.number.value, w, 72, 28), weight: 800, color: c.accent, lh: 1 }));
        yy += 96;
        if (s.number.label) { els.push(T(x, yy, w, 60, s.number.label, { size: 16, weight: 600, color: c.ink, lh: 1.25 })); yy += 70; }
      }
      if (s.body) els.push(T(x, yy, w, H - 110 - yy, s.body, { size: fitSize(s.body, w, H - 110 - yy, 19, 12, 'body', 1.45), color: c.muted, lh: 1.45 }));
    }
    return els;
  },
  compare(s, th) {
    const c = th.colors, els = [R(0, 0, W, H, { fill: c.bg })], y = heading(els, s, th);
    const gap = 32, cw = (W - 2 * M - gap) / 2, ch = H - 100 - y;
    [[s.left, false], [s.right, true]].forEach(([side, hero], i) => {
      side = side || {};
      const x = M + i * (cw + gap);
      els.push(R(x, y, cw, ch, { fill: hero ? mix(c.accent, c.bg, 0.9) : c.surface, radius: 18, line: hero ? c.accent : null, lineWidth: 2 }));
      els.push(T(x + 32, y + 28, cw - 64, 20, String(side.label || '').toUpperCase(), { font: 'mono', size: 13, weight: 600, color: hero ? c.accent : c.muted, spacing: 0.12 }));
      els.push(T(x + 32, y + 58, cw - 64, 80, side.value || '', { font: 'display', size: fitLine(side.value, cw - 64, 56, 22), weight: 800, color: hero ? c.accent : c.ink, lh: 1.05 }));
      const pts = (side.points || []).slice(0, 4);
      if (pts.length) els.push(T(x + 32, y + 158, cw - 64, ch - 182, '', { bullets: pts, size: fitList(pts, cw - 64, ch - 182, 19, 12), color: c.ink, lh: 1.3, bulletColor: hero ? c.accent : c.muted }));
    });
    return els;
  },
  process(s, th) {
    const c = th.colors, els = [R(0, 0, W, H, { fill: c.bg })], y = heading(els, s, th) + 10;
    const steps = (s.steps || []).slice(0, 5), n = Math.max(1, steps.length), gap = 28, cw = (W - 2 * M - gap * (n - 1)) / n;
    els.push(R(M + 28, y + 27, W - 2 * M - 56, 2, { fill: mix(c.accent, c.bg, 0.6) }));
    const tsz = Math.min(...steps.map(st => fitSize(st.title, cw, 64, 24, 15, 'display')), 24);
    const bsz = Math.min(...steps.map(st => fitSize(st.text, cw, H - 120 - (y + 156), 17, 11, 'body', 1.45)), 17);
    steps.forEach((st, i) => {
      const x = M + i * (cw + gap);
      els.push(R(x, y, 56, 56, { fill: c.accent, radius: 28 }));
      els.push(T(x, y + 13, 56, 30, String(i + 1), { font: 'display', size: 22, weight: 700, color: c.bg, align: 'center' }));
      els.push(T(x, y + 82, cw, 64, st.title || '', { font: 'display', size: tsz, weight: 700, color: c.ink, lh: 1.15 }));
      els.push(T(x, y + 156, cw, H - 120 - (y + 156), st.text || '', { size: bsz, color: c.muted, lh: 1.45 }));
    });
    return els;
  },
  quote(s, th) {
    const c = th.colors, els = [R(0, 0, W, H, { fill: c.surface })];
    els.push(T(M + 40, 60, 200, 200, '“', { font: 'display', size: 220, weight: 700, color: mix(c.accent, c.surface, 0.25), lh: 1 }));
    const q = s.quote?.text || s.title || '';
    els.push(T(M + 120, 170, W - 2 * M - 220, 300, q, { font: 'display', size: fitSize(q, W - 2 * M - 220, 300, 40, 22, 'display', 1.25), weight: 600, color: c.ink, lh: 1.25, valign: 'middle' }));
    els.push(R(M + 120, 500, 60, 4, { fill: c.accent, radius: 2 }));
    els.push(T(M + 120, 520, 900, 30, s.quote?.name || '', { size: 20, weight: 700, color: c.ink }));
    els.push(T(M + 120, 552, 900, 26, [s.quote?.role, s.quote?.org].filter(Boolean).join(', '), { size: 17, color: c.muted }));
    return els;
  },
  cards(s, th) {
    const c = th.colors, els = [R(0, 0, W, H, { fill: c.bg })], y = heading(els, s, th);
    const cards = (s.cards || []).slice(0, 6), n = Math.max(1, cards.length), cols = n <= 3 ? n : Math.ceil(n / 2), rows = n <= 3 ? 1 : 2;
    const gap = 24, cw = (W - 2 * M - gap * (cols - 1)) / cols, ch = (H - 100 - y - gap * (rows - 1)) / rows;
    const tsz = Math.min(...cards.map(k => fitSize(k.title, cw - 56, 60, 24, 14, 'display')), 24);
    const bsz = Math.min(...cards.map(k => fitSize(k.text, cw - 56, ch - 140, 17, 11, 'body', 1.45)), 17);
    cards.forEach((k, i) => {
      const x = M + (i % cols) * (cw + gap), yy = y + Math.floor(i / cols) * (ch + gap);
      els.push(R(x, yy, cw, ch, { fill: c.surface, radius: 16 }));
      els.push(R(x + 28, yy + 28, 14, 14, { fill: c.accent, radius: 7 }));
      els.push(T(x + 28, yy + 58, cw - 56, 60, k.title || '', { font: 'display', size: tsz, weight: 700, color: c.ink, lh: 1.15 }));
      els.push(T(x + 28, yy + 120, cw - 56, ch - 140, k.text || '', { size: bsz, color: c.muted, lh: 1.45 }));
    });
    return els;
  },
  closing(s, th) {
    // always a dark stage: the brand's own background when it is dark, its text colour when the brand is light
    const c = th.colors, { dark, light } = closingColors(c), els = [R(0, 0, W, H, { fill: dark })];
    els.push(R(W - 360, H - 360, 520, 520, { fill: mix(c.accent, dark, 0.35), radius: 260 }));
    // a prepared logo turns one-colour where the stage would hide it; an unprepared one only appears on the brand's own background
    if (th.logo && (th.logoR || dark === c.bg)) els.push(logoEl(th, M, 64, 220, 44, dark));
    if (s.kicker) els.push(T(M, 220, 900, 22, String(s.kicker).toUpperCase(), { font: 'mono', size: 14, weight: 600, color: c.accent, spacing: 0.12 }));
    els.push(T(M, 254, 900, 170, s.title, { font: 'display', size: fitSize(s.title, 900, 170, 62, 32, 'display', 1.05), weight: 700, color: light, lh: 1.05, spacing: -0.02 }));
    if (s.body) els.push(T(M, 440, 820, 90, s.body, { size: fitSize(s.body, 820, 90, 24, 14, 'body', 1.4), color: mix(light, dark, 0.25), lh: 1.4 }));
    if (s.footer) els.push(T(M, H - 100, 900, 26, s.footer, { size: 17, weight: 600, color: light }));
    return els;
  },
};

export function layoutSlide(slide, theme, ctx = {}) {
  const fn = L[slide.layout] || L.statement;
  const els = fn(slide, theme);
  // the background is the full-slide rectangle each layout starts with
  const bg = els.find(e => e.type === 'rect' && !e.x && !e.y && e.w === W && e.h === H)?.fill || theme.colors.bg;
  chrome(els, slide, theme, ctx, { dark: slide.layout === 'closing', bg });
  return els;
}

// —— HTML / SVG ——
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// single quotes: these stacks go inside double-quoted style attributes
export const fontStack = (family, generic = 'sans-serif') => `'VG ${family}', '${family}', ${generic}`;

function chartSVG(e, th) {
  const ch = e.chart, cats = ch.categories || [], series = (ch.series || []).filter(sr => Array.isArray(sr.values));
  const fam = fontStack(th.fonts.body), w = e.w, hgt = e.h, unit = ch.unit || '';
  const fmt = v => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : +(+v).toFixed(2)) + unit;
  if (!series.length || !cats.length) return `<svg width="${w}" height="${hgt}"><text x="${w / 2}" y="${hgt / 2}" text-anchor="middle" font-family="${fam}" font-size="16" fill="${e.muted}">Add data to draw the chart</text></svg>`;
  let svg = `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" xmlns="http://www.w3.org/2000/svg" font-family="${fam}">`;
  if (ch.type === 'donut') {
    const vals = series[0].values.map(Number), total = vals.reduce((a, b) => a + b, 0) || 1, cx = Math.min(w, hgt) / 2, cy = hgt / 2, r = Math.min(w, hgt) / 2 - 10, ir = r * 0.6;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0, p = (rr, a) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      svg += `<path d="M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(ir, a1)} A${ir},${ir} 0 ${large} 0 ${p(ir, a0)} Z" fill="${e.colors[i % e.colors.length]}"/>`;
      a0 = a1;
    });
    const lx = cx * 2 + 30;
    cats.forEach((cname, i) => {
      svg += `<rect x="${lx}" y="${30 + i * 34}" width="14" height="14" rx="3" fill="${e.colors[i % e.colors.length]}"/><text x="${lx + 24}" y="${42 + i * 34}" font-size="16" fill="${e.ink}">${esc(cname)} · ${esc(fmt(vals[i] ?? 0))}</text>`;
    });
    return svg + '</svg>';
  }
  const all = series.flatMap(sr => sr.values.map(Number)), max = Math.max(...all, 0) * 1.1 || 1, min = Math.min(0, ...all);
  const left = 64, bottom = 40, top = series.length > 1 ? 34 : 10, pw = w - left - 10, ph = hgt - bottom - top;
  const yv = v => top + ph - ((v - min) / (max - min)) * ph;
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4, yy = yv(v);
    svg += `<line x1="${left}" x2="${w - 10}" y1="${yy}" y2="${yy}" stroke="${e.grid}"/><text x="${left - 10}" y="${yy + 5}" font-size="13" text-anchor="end" fill="${e.muted}">${esc(fmt(Math.round(v * 10) / 10))}</text>`;
  }
  const bw = pw / cats.length;
  cats.forEach((cname, i) => { svg += `<text x="${left + bw * i + bw / 2}" y="${hgt - 14}" font-size="14" text-anchor="middle" fill="${e.muted}">${esc(cname)}</text>`; });
  if (ch.type === 'line') {
    series.forEach((sr, k) => {
      const pts = sr.values.map((v, i) => `${left + bw * i + bw / 2},${yv(Number(v))}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${e.colors[k % e.colors.length]}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
      sr.values.forEach((v, i) => { svg += `<circle cx="${left + bw * i + bw / 2}" cy="${yv(Number(v))}" r="5" fill="${e.colors[k % e.colors.length]}"/>`; });
    });
  } else {
    const n = series.length, inner = bw * 0.7, sw = inner / n;
    series.forEach((sr, k) => sr.values.forEach((v, i) => {
      const x = left + bw * i + (bw - inner) / 2 + k * sw, y0 = yv(Math.max(0, Number(v))), y1 = yv(Math.min(0, Number(v)));
      svg += `<rect x="${x + 2}" y="${y0}" width="${sw - 4}" height="${Math.max(1, y1 - y0)}" rx="4" fill="${e.colors[k % e.colors.length]}"/>`;
      if (n === 1) svg += `<text x="${x + sw / 2}" y="${y0 - 8}" font-size="14" font-weight="600" text-anchor="middle" fill="${e.ink}">${esc(fmt(Number(v)))}</text>`;
    }));
  }
  if (series.length > 1) series.forEach((sr, k) => { svg += `<rect x="${left + k * 180}" y="4" width="14" height="14" rx="3" fill="${e.colors[k % e.colors.length]}"/><text x="${left + k * 180 + 22}" y="16" font-size="14" fill="${e.ink}">${esc(sr.name)}</text>`; });
  return svg + '</svg>';
}

export function renderSlideHTML(slide, theme, ctx = {}) {
  const els = layoutSlide(slide, theme, ctx);
  const fam = { display: fontStack(theme.fonts.display), body: fontStack(theme.fonts.body), mono: "'JetBrains Mono', ui-monospace, monospace" };
  let html = '';
  els.forEach((e, i) => {
    const pos = `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;`;
    if (e.type === 'rect') html += `<div style="position:absolute;${pos}background:${e.fill || 'transparent'};border-radius:${e.radius}px;${e.line ? `box-shadow:inset 0 0 0 ${e.lineWidth || 1}px ${e.line};` : ''}"></div>`;
    else if (e.type === 'image') html += `<div style="position:absolute;${pos}display:flex;align-items:center;"><img src="${esc(e.src)}" style="max-width:100%;max-height:100%;object-fit:contain;" alt=""></div>`;
    else if (e.type === 'chart') html += `<div style="position:absolute;${pos}">${chartSVG(e, theme)}</div>`;
    else if (e.type === 'text') {
      const just = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[e.valign];
      const style = `position:absolute;${pos}display:flex;flex-direction:column;justify-content:${just};font-family:${fam[e.font]};font-size:${e.size}px;font-weight:${e.weight};color:${e.color};text-align:${e.align};line-height:${e.lh};letter-spacing:${(e.spacing || 0)}em;overflow:hidden;`;
      const body = e.bullets
        ? `<ul style="margin:0;padding:0;list-style:none;">${e.bullets.map(b => `<li style="display:flex;gap:.6em;margin-bottom:.6em;"><span style="color:${e.bulletColor || e.color};flex:none;">●</span><span>${esc(b)}</span></li>`).join('')}</ul>`
        : `<div style="white-space:pre-wrap;">${esc(e.text)}</div>`;
      html += `<div data-el="${i}" data-fit="1" style="${style}">${body}</div>`;
    }
  });
  return `<div class="vg-slide" style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${theme.colors.bg};">${html}</div>`;
}
