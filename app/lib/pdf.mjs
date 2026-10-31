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

// logoFile: absolute path of the brand logo, or null. Returns the PDF path, the poster path and the logo as PNG for PowerPoint.
export async function renderDeck(deck, theme, { proof = {}, logoFile = null, pdfFile, posterFile, draft = false }) {
  const logoURL = logoFile ? `data:${logoFile.endsWith('.svg') ? 'image/svg+xml' : logoFile.endsWith('.png') ? 'image/png' : logoFile.endsWith('.webp') ? 'image/webp' : 'image/jpeg'};base64,${b64(logoFile)}` : null;
  const th = { ...theme, logo: logoURL };
  const slides = deck.slides.map((s, index) => renderSlideHTML(s, th, { index, proof, draft })).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces(theme)}
@page { size: ${W}px ${H}px; margin: 0; }
html, body { margin: 0; padding: 0; }
.vg-slide { page-break-after: always; break-after: page; }
.vg-slide:last-of-type { page-break-after: auto; break-after: auto; }
</style></head><body>${slides}${logoURL ? `<img id="logo" src="${logoURL}" style="position:absolute;left:-9999px;top:0;height:200px;">` : ''}</body></html>`;
  const { chromium } = await pw();
  const browser = await chromium.launch(await browserOpts());
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    if (pdfFile) await page.pdf({ path: pdfFile, width: `${W}px`, height: `${H}px`, printBackground: true });
    if (posterFile) await page.locator('.vg-slide').first().screenshot({ path: posterFile, type: 'jpeg', quality: 85 });
    let logo = null;
    if (logoURL) {
      // PowerPoint wants a raster logo with known proportions: render it at 200 px tall, transparent
      const el = page.locator('#logo');
      const dims = await el.evaluate(img => ({ w: img.naturalWidth, h: img.naturalHeight }));
      await page.evaluate(() => { const i = document.getElementById('logo'); i.style.left = '0px'; document.body.style.background = 'transparent'; });
      const png = await el.screenshot({ type: 'png', omitBackground: true });
      logo = { data: 'image/png;base64,' + png.toString('base64'), w: dims.w || 4, h: dims.h || 1 };
    }
    return { pdfFile, posterFile, logo };
  } finally { await browser.close(); }
}
