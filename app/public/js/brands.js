// Brand kits: colours, type, logo, narrator and tone, previewed live in the real templates.
import { $, $$, h, api, icon, toast, sheet, app, go, pillSelect, segmented, wsHeader } from './core.js';

const ROLES = [
  ['bg', 'Background', 'The stage or page behind everything'],
  ['surface', 'Surface', 'Cards and panels'],
  ['ink', 'Text', 'Headlines and body copy'],
  ['muted', 'Secondary', 'Labels, captions, quiet text'],
  ['accent', 'Accent', 'The signature colour: highlights, big numbers'],
];
let root, data = null;

export function mountBrands(el) { root = el; }
export async function loadBrands() {
  data = await api('brands');
  app.brands = data.brands;
  return data;
}

export async function showBrands(args) {
  await loadBrands();
  if (args[0]) return editor(args[0], args[1]);
  list();
}

// —— colour maths ——
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mixHex = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = hex => { const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

// load a curated font into this page for specimens
const fontCache = new Map();
export function useFont(family) {
  if (!family) return Promise.resolve();
  if (!fontCache.has(family)) {
    fontCache.set(family, api('fonts/' + encodeURIComponent(family)).then(async f => {
      const ff = new FontFace('VG ' + family, `url(${f.url})`, { weight: f.fixed ? '400' : '100 900' });
      await ff.load();
      document.fonts.add(ff);
    }).catch(() => fontCache.delete(family)));
  }
  return fontCache.get(family);
}
const face = (family, weight = 700) => `"VG ${family}", -apple-system, sans-serif`;

// a kit's look as a card: page, logo, specimen, accent, swatches
export function brandTile(b, { logo } = {}) {
  const c = b.colors;
  useFont(b.fonts.display);
  useFont(b.fonts.body);
  const src = logo !== undefined ? logo : b.page?.logo;
  return h('div', { class: 'btile', style: { background: c.bg } },
    src ? h('img', { class: 'blogo', src, alt: '' }) : null,
    h('div', { class: 'bspec', style: { color: c.ink, fontFamily: face(b.fonts.display) } }, 'Aa'),
    h('div', { class: 'bline', style: { color: c.muted, fontFamily: face(b.fonts.body) } }, b.tone || 'The quick brown fox jumps over the lazy dog'),
    h('div', { class: 'bacc', style: { background: c.accent } }),
    h('div', { class: 'bswatches' }, ROLES.map(([r]) => h('i', { style: { background: c[r] }, title: r }))));
}

// —— list ——
function list() {
  const mine = data.brands;
  const kit = b => h('div', { class: 'bcard' },
    h('button', { class: 'bframe', onclick: () => go('brands/' + b.id), 'aria-label': 'Edit ' + b.name }, brandTile(b)),
    h('div', { class: 'bmeta' },
      h('div', {}, h('b', {}, b.name), h('small', {}, `${b.fonts.display} / ${b.fonts.body}`)),
      h('button', { class: 'btn', onclick: () => { localStorage.setItem('vg.brand', b.id); go('create'); } }, icon('sparkles', 14), 'Make a film')));
  const theme = p => h('div', { class: 'bcard' },
    h('button', { class: 'bframe', onclick: () => go('brands/new/' + p.id), 'aria-label': 'Start from ' + p.name }, brandTile(p, { logo: null })),
    h('div', { class: 'bmeta' }, h('div', {}, h('b', {}, p.name), h('small', {}, p.tone))));
  const head = h('div', { class: 'g-top' },
    h('div', {},
      h('div', { class: 'eyebrow' }, 'Brand kits'),
      h('h1', { class: 'title-xl' }, 'Your look, in every frame.'),
      h('p', { class: 'sub' }, 'Colours, type, logo and narrator, applied to instant films and passed to the director.')),
    h('button', { class: 'btn primary big', onclick: () => go('brands/new') }, icon('plus', 16), 'New brand kit'));
  const yours = mine.length ? h('section', { class: 'cat-block' }, h('h2', { class: 'title-m' }, 'Your kits'), h('div', { class: 'bgrid' }, mine.map(kit))) : null;
  const themes = h('section', { class: 'cat-block' },
    h('div', { class: 'section-head' },
      h('h2', { class: 'title-m' }, mine.length ? 'Start from a theme' : 'Start from a theme, or from scratch'),
      h('span', { class: 'faint' }, 'Ready-made themes, with open-licence fonts')),
    h('div', { class: 'bgrid' }, data.presets.map(theme)));
  root.replaceChildren(h('div', { class: 'brands' }, head, yours, themes));
}

// —— editor ——
async function editor(id, presetId) {
  const isNew = id === 'new';
  const saved = isNew ? null : data.brands.find(b => b.id === id);
  if (!isNew && !saved) { toast('That brand kit no longer exists.', 'error'); return go('brands'); }
  const preset = data.presets.find(p => p.id === presetId) || data.presets.find(p => p.id === 'modern-minimalist');
  const d = saved ? JSON.parse(JSON.stringify(saved)) : { name: presetId ? preset.name : 'New brand', colors: { ...preset.colors }, fonts: { ...preset.fonts }, voice: 'af_heart', tone: presetId ? preset.tone : '', source: presetId ? 'preset:' + preset.id : 'custom' };
  let logoURL = saved?.page?.logo || null, logoFile = null, logoGone = false;
  const pv = { tpl: localStorage.getItem('vg.brandTpl') || 'swiss', aspect: '16:9', win: null, t: 0, raf: 0, timer: 0 };

  // —— preview ——
  const frame = h('iframe', { title: 'Brand preview', tabindex: '-1' });
  const screen = h('div', { class: 'viewer bpreview' }, frame);
  let sample = null;
  const pageBrand = () => {
    const f = fam => ({ family: fam, url: data.fonts.find(x => x.family === fam)?.url, fixed: data.fonts.find(x => x.family === fam)?.fixed });
    return { name: d.name, colors: d.colors, fonts: { display: f(d.fonts.display), body: f(d.fonts.body) }, logo: logoGone ? null : logoURL, tone: d.tone };
  };
  const refresh = () => {
    clearTimeout(pv.timer);
    pv.timer = setTimeout(async () => {
      sample = sample || await fetch('/gallery/brand-sample.json').then(r => r.json());
      await Promise.all([useFont(d.fonts.display), useFont(d.fonts.body)]);
      cancelAnimationFrame(pv.raf);
      const portrait = pv.aspect === '9:16';
      screen.classList.toggle('portrait', portrait);
      frame.onload = () => {
        frame.contentWindow.postMessage({ type: 'content', content: { ...sample, template: pv.tpl, title: d.name, brand: pageBrand() } }, location.origin);
        const t0 = Date.now();
        const wait = () => {
          const w = frame.contentWindow;
          if (w?.READY) { pv.win = w; pv.last = performance.now(); pv.raf = requestAnimationFrame(loop); return; }
          if (Date.now() - t0 < 8000) setTimeout(wait, 40);
        };
        wait();
      };
      frame.src = `/tpl/${pv.tpl}/index.html?embed=1&size=${portrait ? '720x1280' : '1280x720'}&v=${Date.now()}`;
    }, 280);
  };
  const loop = now => {
    if (!pv.win || !root.contains(frame)) return;
    pv.t = (pv.t + (now - pv.last) / 1000) % pv.win.DUR;
    pv.last = now;
    pv.win.render(pv.t);
    pv.raf = requestAnimationFrame(loop);
  };

  // —— form ——
  const nameIn = h('input', { class: 'bname', value: d.name, 'aria-label': 'Brand name', oninput: e => { d.name = e.target.value; refresh(); } });
  const swatchRows = h('div', { class: 'roles' });
  const paintRoles = () => {
    swatchRows.replaceChildren(...ROLES.map(([r, label, hint]) => {
      const text = h('input', { class: 'hex', value: d.colors[r], spellcheck: false, 'aria-label': label + ' hex', onchange: e => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) { d.colors[r] = (v.startsWith('#') ? v : '#' + v).toLowerCase(); paintRoles(); refresh(); } else e.target.value = d.colors[r]; } });
      const pick = h('input', { type: 'color', value: d.colors[r], 'aria-label': label, oninput: e => { d.colors[r] = e.target.value; text.value = e.target.value; paintChecks(); refresh(); } });
      return h('div', { class: 'role' }, h('label', { class: 'chip-color', style: { background: d.colors[r] } }, pick), h('div', { class: 'grow' }, h('b', {}, label), h('small', {}, hint)), text);
    }));
    paintChecks();
  };
  const checks = h('div', { class: 'checks' });
  const paintChecks = () => {
    const c = d.colors;
    const row = (label, ratio, need) => h('span', { class: 'check-pill ' + (ratio >= need ? 'ok' : 'warn'), title: `needs ${need}:1` }, icon(ratio >= need ? 'check' : 'info', 12), `${label} ${ratio.toFixed(1)}:1`);
    checks.replaceChildren(row('Text', contrast(c.ink, c.bg), 7), row('Secondary', contrast(c.muted, c.bg), 4.5), row('Accent', contrast(c.accent, c.bg), 3));
  };

  // logo
  const logoBox = h('div', { class: 'dropzone', tabindex: 0, role: 'button', 'aria-label': 'Upload logo' });
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/svg+xml,image/jpeg,image/webp', hidden: true, onchange: e => takeLogo(e.target.files[0]) });
  const paintLogo = () => {
    const src = logoGone ? null : logoURL;
    logoBox.replaceChildren(src
      ? h('div', { class: 'logo-pair' }, h('div', { style: { background: d.colors.bg } }, h('img', { src, alt: 'Logo on background' })), h('div', { style: { background: d.colors.surface } }, h('img', { src, alt: 'Logo on surface' })))
      : h('div', { class: 'dz-empty' }, icon('photo', 22), h('b', {}, 'Drop your logo'), h('small', {}, 'PNG or SVG with a transparent background works best')));
    logoActs.hidden = !src;
  };
  const takeLogo = file => {
    if (!file) return;
    if (!/^image\/(png|svg\+xml|jpeg|webp)$/.test(file.type)) return toast('Use a PNG, SVG, JPEG or WebP file.', 'error');
    if (file.size > 5e6) return toast('The logo must be under 5 MB.', 'error');
    logoFile = file;
    logoGone = false;
    const r = new FileReader();
    r.onload = () => { logoURL = r.result; paintLogo(); refresh(); };
    r.readAsDataURL(file);
  };
  logoBox.addEventListener('click', () => fileIn.click());
  logoBox.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  logoBox.addEventListener('dragover', e => { e.preventDefault(); logoBox.classList.add('over'); });
  logoBox.addEventListener('dragleave', () => logoBox.classList.remove('over'));
  logoBox.addEventListener('drop', e => { e.preventDefault(); logoBox.classList.remove('over'); takeLogo(e.dataTransfer.files[0]); });
  const logoActs = h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => fromLogo() }, icon('sparkles', 14), 'Use the logo’s colours'),
    h('button', { class: 'btn ghost', onclick: () => fileIn.click() }, 'Replace'),
    h('button', { class: 'btn ghost danger', onclick: () => { logoGone = true; logoFile = null; paintLogo(); refresh(); } }, 'Remove'));

  // pick the accent (and a tinted surface) from the logo's most characterful colour
  const fromLogo = async () => {
    const img = new Image();
    img.src = logoURL;
    try { await img.decode(); } catch { return toast('Could not read the logo.', 'error'); }
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 48, 48);
    const px = g.getImageData(0, 0, 48, 48).data, bins = new Map();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 160) continue;
      const k = [px[i] >> 4, px[i + 1] >> 4, px[i + 2] >> 4].join(',');
      const b = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2];
      bins.set(k, b);
    }
    let best = null, bestScore = 0;
    for (const b of bins.values()) {
      const col = [b.r / b.n, b.g / b.n, b.b / b.n], sat = Math.max(...col) - Math.min(...col);
      const score = sat * Math.sqrt(b.n);
      if (score > bestScore) { bestScore = score; best = col; }
    }
    if (!best || bestScore < 40) return toast('The logo has no strong colour; keep your accent or pick one.', 'info');
    d.colors.accent = toHex(best);
    d.colors.surface = mixHex(d.colors.bg, d.colors.accent, 0.08);
    paintRoles(); paintLogo(); refresh();
    toast(`Accent set to ${d.colors.accent} from your logo.`, 'ok');
  };

  // type
  const fontSel = role => {
    const s = h('select', { 'aria-label': role + ' font', onchange: e => { d.fonts[role] = e.target.value; paintSpec(); refresh(); } },
      ['Sans', 'Display', 'Serif'].map(k => h('optgroup', { label: k }, data.fonts.filter(f => f.kind === k).map(f => h('option', { value: f.family, selected: f.family === d.fonts[role] }, f.family)))));
    return h('label', { class: 'pill-select' }, s, icon('chevronD', 12));
  };
  const spec = h('div', { class: 'specimen' });
  const paintSpec = async () => {
    await Promise.all([useFont(d.fonts.display), useFont(d.fonts.body)]);
    spec.replaceChildren(
      h('div', { class: 'spec-d', style: { fontFamily: face(d.fonts.display) } }, d.name || 'Headline'),
      h('div', { class: 'spec-b', style: { fontFamily: face(d.fonts.body) } }, 'Body copy and captions read like this, at the size viewers see them.'));
  };

  // describe it → Claude designs a kit
  const describe = h('input', { class: 'input', placeholder: 'e.g. calm clinical health-tech, teal, trustworthy', 'aria-label': 'Describe the brand' });
  const genBtn = h('button', { class: 'btn', onclick: async () => {
    if (!describe.value.trim()) return describe.focus();
    genBtn.disabled = true;
    genBox.classList.add('active');
    genBtn.replaceChildren(h('span', { class: 'spin' }), 'Designing…');
    try {
      const k = await api('brands/generate', { method: 'POST', body: { prompt: describe.value } });
      Object.assign(d, { colors: k.colors, fonts: k.fonts, voice: k.voice, tone: k.tone, source: 'generated' });
      if (isNew || !saved?.name || d.name === 'New brand') { d.name = k.name; nameIn.value = k.name; }
      voiceSel.querySelector('select').value = d.voice;
      toneIn.value = d.tone;
      paintRoles(); paintLogo(); paintSpec(); refresh();
      $$('select', typeBox).forEach((s, i) => { s.value = d.fonts[i ? 'body' : 'display']; });
      toast(`Designed “${k.name}”${k.cost ? ` ($${k.cost.toFixed(3)})` : ''}.`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
    genBtn.disabled = false;
    genBox.classList.remove('active');
    genBtn.replaceChildren(icon('sparkles', 14), 'Design it');
  } }, icon('sparkles', 14), 'Design it');
  const genBox = h('div', { class: 'glow' }, h('div', { class: 'gen' }, describe, genBtn));
  describe.addEventListener('keydown', e => { if (e.key === 'Enter') genBtn.click(); });

  const presetRow = h('div', { class: 'presets' }, data.presets.map(p => h('button', { class: 'preset', title: p.tone, onclick: () => {
    Object.assign(d, { colors: { ...p.colors }, fonts: { ...p.fonts }, source: 'preset:' + p.id });
    if (!d.tone) { d.tone = p.tone; toneIn.value = p.tone; }
    $$('select', typeBox).forEach((s, i) => { s.value = d.fonts[i ? 'body' : 'display']; });
    paintRoles(); paintLogo(); paintSpec(); refresh();
  } }, h('span', { class: 'dots' }, ['bg', 'ink', 'accent'].map(r => h('i', { style: { background: p.colors[r] } }))), p.name)));

  const voiceSel = pillSelect(app.cfg.voices, d.voice, v => { d.voice = v; }, 'Narrator');
  const toneIn = h('textarea', { rows: 2, placeholder: 'How should the narration sound? e.g. warm, plain-spoken, confident', oninput: e => { d.tone = e.target.value; } }, d.tone || '');
  const typeBox = h('div', { class: 'row2' }, h('div', { class: 'field' }, h('span', {}, 'Display'), fontSel('display')), h('div', { class: 'field' }, h('span', {}, 'Body'), fontSel('body')));

  const save = h('button', { class: 'btn primary big', onclick: async () => {
    save.disabled = true;
    try {
      let b = isNew ? await api('brands', { method: 'POST', body: d }) : await api('brands/' + id, { method: 'PUT', body: d });
      if (logoFile) {
        const r = await fetch(`/api/brands/${b.id}/logo`, { method: 'POST', headers: { 'Content-Type': logoFile.type, ...wsHeader() }, body: logoFile });
        if (!r.ok) throw new Error((await r.json()).error);
      } else if (logoGone && saved?.logo) await api(`brands/${b.id}/logo`, { method: 'DELETE' });
      await loadBrands();
      toast(`Saved “${d.name}”.`, 'ok');
      go('brands');
    } catch (e) { toast(e.message, 'error'); save.disabled = false; }
  } }, icon('check', 16), isNew ? 'Create brand kit' : 'Save');
  const del = !isNew ? h('button', { class: 'btn ghost danger', onclick: async () => {
    if (!confirm(`Delete the brand kit “${saved.name}”? Films already made keep their copy.`)) return;
    await api('brands/' + id, { method: 'DELETE' });
    await loadBrands();
    go('brands');
  } }, 'Delete') : null;

  const tplSeg = segmented(app.gallery.templates.map(t => ({ v: t.id, label: t.name })), pv.tpl, v => { pv.tpl = v; localStorage.setItem('vg.brandTpl', v); refresh(); }, { label: 'Preview template' });
  const aspSeg = segmented([{ v: '16:9', icon: 'landscape', label: '16:9' }, { v: '9:16', icon: 'portrait', label: '9:16' }], pv.aspect, v => { pv.aspect = v; refresh(); }, { label: 'Preview format' });

  root.replaceChildren(h('div', { class: 'beditor' },
    h('div', { class: 'bform' },
      h('button', { class: 'btn ghost', onclick: () => go('brands') }, icon('chevronL', 15), 'Brand kits'),
      nameIn,
      h('section', {}, h('div', { class: 'eyebrow' }, 'Describe it'), genBox),
      h('section', {}, h('div', { class: 'eyebrow' }, 'Or start from a theme'), presetRow),
      h('section', {}, h('div', { class: 'eyebrow' }, 'Logo'), logoBox, fileIn, logoActs),
      h('section', {}, h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, 'Colours'), checks), swatchRows),
      h('section', {}, h('div', { class: 'eyebrow' }, 'Type'), typeBox, spec),
      h('section', {}, h('div', { class: 'eyebrow' }, 'Narrator and tone'), h('div', { style: { display: 'grid', gap: '10px' } }, voiceSel, toneIn)),
      h('div', { class: 'actions' }, save, del)),
    h('div', { class: 'bside' },
      h('div', { class: 'bside-head' }, h('span', { class: 'eyebrow' }, 'Live preview'), h('div', { class: 'actions' }, tplSeg, aspSeg)),
      screen,
      h('p', { class: 'faint' }, 'The real template, drawn with this kit. Instant films use it as is; directed films get it as a brief to apply where the style allows.'))));
  paintRoles(); paintLogo(); paintSpec(); refresh();
}
