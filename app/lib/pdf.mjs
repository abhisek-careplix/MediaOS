// Deck PDF, poster and logo rasterising, through the library's headless Chromium.
import fs from 'fs';
import path from 'path';
import { LIB, APP } from './paths.mjs';
import { FONTS, FONT_LIST } from './brands.mjs';
import { renderSlideHTML, W, H } from '../public/js/deck-render.js';

const pw = () => import(path.join(LIB, 'node_modules/playwright-core/index.mjs'));
const browserOpts = async () => { const b = await import(path.join(LIB, 'core/render/browser.mjs')); return { executablePath: b.EXE, args: b.ARGS }; };
const b64 = file => fs.readFileSync(file).toString('base64');

function fontFaces(theme) {
  const faces = [];
  for (const fam of new Set([theme.fonts.display, theme.fonts.body])) {
    const f = FONT_LIST.find(x => x.family === fam);
    const file = f && path.join(FONTS, f.local);
    if (file && fs.existsSync(file)) faces.push(`@font-face{font-family:"VG ${fam}";src:url(data:font/ttf;base64,${b64(file)});font-weight:${f.fixed ? 400 : '100 900'};}`);
  }
  const mono = path.join(APP, 'templates/shared/fonts/JetBrainsMono.ttf');
  faces.push(`@font-face{font-family:"JetBrains Mono";src:url(data:font/ttf;base64,${b64(mono)});font-weight:100 800;}`);
  return faces.join('\n');
}

// logoFile: absolute path of the brand logo, or null. The logo is trimmed and given its one-colour versions in this
// Chromium, by the same module the films use (templates/shared/logo.js). Returns the PDF and poster paths, the theme the
// slides were laid out with, and the logo images for PowerPoint ({ logo, light, dark } → { data, w, h }).
export async function renderDeck(deck, theme, { proof = {}, logoFile = null, pdfFile, posterFile, draft = false }) {
  const logoURL = logoFile ? `data:${logoFile.endsWith('.svg') ? 'image/svg+xml' : logoFile.endsWith('.png') ? 'image/png' : logoFile.endsWith('.webp') ? 'image/webp' : 'image/jpeg'};base64,${b64(logoFile)}` : null;
  const { chromium } = await pw();
  const browser = await chromium.launch(await browserOpts());
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    let th = { ...theme, logo: logoURL }, logos = null;
    if (logoURL) {
      await page.setContent('<!doctype html><html><body></body></html>');
      const code = fs.readFileSync(path.join(APP, 'templates/shared/logo.js'), 'utf8');
      const a = await page.evaluate(async ([code, url]) => {
        const m = await import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
        return m.logoAssets(await m.loadLogo(url));
      }, [code, logoURL]).catch(() => null);
      if (a) {
        th = { ...theme, logo: a.logo, logoLight: a.light, logoDark: a.dark, logoR: a.r, logoHist: a.hist };
        const png = url => ({ data: url.replace(/^data:/, ''), w: a.w, h: a.h });
        logos = { logo: png(a.logo), light: png(a.light), dark: png(a.dark) };
      }
    }
    const slides = deck.slides.map((s, index) => renderSlideHTML(s, th, { index, proof, draft })).join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces(theme)}
@page { size: ${W}px ${H}px; margin: 0; }
html, body { margin: 0; padding: 0; }
.vg-slide { page-break-after: always; break-after: page; }
.vg-slide:last-of-type { page-break-after: auto; break-after: auto; }
</style></head><body>${slides}</body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    if (pdfFile) await page.pdf({ path: pdfFile, width: `${W}px`, height: `${H}px`, printBackground: true });
    if (posterFile) await page.locator('.vg-slide').first().screenshot({ path: posterFile, type: 'jpeg', quality: 85 });
    return { pdfFile, posterFile, theme: th, logos };
  } finally { await browser.close(); }
}
