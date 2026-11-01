// The brand logo, prepared once for drawing: shared by the film templates (runtime.js) and the deck renderer
// (the deck editor's preview and the PDF / PowerPoint export). Browser only: it needs a canvas.
const hexRGB = h => { h = String(h || '#000').replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const luminance = hex => { const [r, g, b] = hexRGB(hex).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };

// —— the logo ——
// Uploaded logos often carry a wide empty margin, arrive many times larger than they are drawn, and can vanish on a
// background close to their own colours. prepLogo trims the margin (keying out a solid backdrop when the file has no
// transparency) and measures the logo's colours once; drawLogo draws a copy shrunk in steps to the exact pixel size,
// and swaps in a one-colour version where too much of the original would disappear. The uploaded file is never changed.
const lum8 = (r, g, b) => luminance('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''));
const LUM = new Float32Array(4096);   // 4-bit-per-channel luminance table, so measuring a logo stays cheap
for (let i = 0; i < 4096; i++) LUM[i] = lum8((i >> 8) * 17, (i >> 4 & 15) * 17, (i & 15) * 17);
export const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const sheet = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

export function prepLogo(img, svg) {
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
export function lostOn(logo, l) {
  let s = 0;
  for (let i = 0; i < 64; i++) if (logo.hist[i] && contrast((i + 0.5) / 64, l) < 1.6) s += logo.hist[i];
  return s;
}

// the logo as a single colour (white on dark grounds; its own darkest colour, or near-black, on light ones)
export function monoOf(logo, light) {
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
export function sizedOf(v, w, h) {
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
export function groundUnder(ctx, logo, x, y, w, h) {
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

export async function loadLogo(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return prepLogo(img, /\.svg(\?|$)/i.test(url) || url.startsWith('data:image/svg'));
}

// For documents: the trimmed logo and its two one-colour versions as PNG data URLs (at most maxW wide), with what
// decides between them, so a slide renderer can pick per background the way drawLogo does.
export function logoAssets(logo, maxW = 1600) {
  const w = Math.min(maxW, logo.src.width), h = Math.max(1, Math.round(w / logo.r));
  const url = v => sizedOf(v, w, h).toDataURL('image/png');
  return { r: logo.r, hist: Array.from(logo.hist, v => +v.toFixed(4)), w, h, logo: url(logo), light: url(monoOf(logo, true)), dark: url(monoOf(logo, false)) };
}
