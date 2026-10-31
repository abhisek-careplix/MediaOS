// Brand kits: colours, type, logo, narrator and tone, stored in <root>/brands/<id>/brand.json.
// Fonts are open-licence Google Fonts, fetched on first use into brands/_fonts with their OFL licence.
import fs from 'fs';
import path from 'path';
import { ROOT } from './paths.mjs';

export const BRANDS = process.env.VIDEOGEN_BRANDS || path.join(ROOT, 'brands');
export const FONTS = path.join(BRANDS, '_fonts');
fs.mkdirSync(FONTS, { recursive: true });

const RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl/';
// family, google/fonts folder, file, style; "fixed" faces ship one weight, so templates set them at 400
export const FONT_LIST = [
  ['Inter', 'inter', 'Inter[opsz,wght].ttf', 'Sans'], ['Archivo', 'archivo', 'Archivo[wdth,wght].ttf', 'Sans'],
  ['Manrope', 'manrope', 'Manrope[wght].ttf', 'Sans'], ['DM Sans', 'dmsans', 'DMSans[opsz,wght].ttf', 'Sans'],
  ['Space Grotesk', 'spacegrotesk', 'SpaceGrotesk[wght].ttf', 'Sans'], ['Sora', 'sora', 'Sora[wght].ttf', 'Sans'],
  ['Outfit', 'outfit', 'Outfit[wght].ttf', 'Sans'], ['Plus Jakarta Sans', 'plusjakartasans', 'PlusJakartaSans[wght].ttf', 'Sans'],
  ['Work Sans', 'worksans', 'WorkSans[wght].ttf', 'Sans'], ['Figtree', 'figtree', 'Figtree[wght].ttf', 'Sans'],
  ['Onest', 'onest', 'Onest[wght].ttf', 'Sans'], ['Instrument Sans', 'instrumentsans', 'InstrumentSans[wdth,wght].ttf', 'Sans'],
  ['IBM Plex Sans', 'ibmplexsans', 'IBMPlexSans[wdth,wght].ttf', 'Sans'], ['Noto Sans', 'notosans', 'NotoSans[wdth,wght].ttf', 'Sans'],
  ['Lexend', 'lexend', 'Lexend[wght].ttf', 'Sans'], ['Montserrat', 'montserrat', 'Montserrat[wght].ttf', 'Sans'],
  ['Raleway', 'raleway', 'Raleway[wght].ttf', 'Sans'],
  ['Bricolage Grotesque', 'bricolagegrotesque', 'BricolageGrotesque[opsz,wdth,wght].ttf', 'Display'], ['Syne', 'syne', 'Syne[wght].ttf', 'Display'],
  ['Unbounded', 'unbounded', 'Unbounded[wght].ttf', 'Display'],
  ['Fraunces', 'fraunces', 'Fraunces[SOFT,WONK,opsz,wght].ttf', 'Serif'], ['Playfair Display', 'playfairdisplay', 'PlayfairDisplay[wght].ttf', 'Serif'],
  ['Lora', 'lora', 'Lora[wght].ttf', 'Serif'], ['Newsreader', 'newsreader', 'Newsreader[opsz,wght].ttf', 'Serif'],
  ['Libre Caslon Text', 'librecaslontext', 'LibreCaslonText[wght].ttf', 'Serif'],
  ['DM Serif Display', 'dmserifdisplay', 'DMSerifDisplay-Regular.ttf', 'Serif', true], ['Instrument Serif', 'instrumentserif', 'InstrumentSerif-Regular.ttf', 'Serif', true],
].map(([family, dir, file, kind, fixed]) => ({ family, dir, file, kind, fixed: !!fixed, local: family.replace(/\s+/g, '') + '.ttf' }));
const fontOf = family => FONT_LIST.find(f => f.family === family);

export async function ensureFont(family) {
  const f = fontOf(family);
  if (!f) throw new Error('unknown font ' + family);
  const dest = path.join(FONTS, f.local);
  if (!fs.existsSync(dest)) {
    const r = await fetch(RAW + f.dir + '/' + encodeURIComponent(f.file).replace(/%2C/g, ','));
    if (!r.ok) throw new Error(`could not download ${family} (${r.status})`);
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    const lic = await fetch(RAW + f.dir + '/OFL.txt').catch(() => null);
    if (lic?.ok) fs.writeFileSync(path.join(FONTS, f.local.replace('.ttf', '-OFL.txt')), await lic.text());
  }
  return { family: f.family, file: f.local, fixed: f.fixed };
}

// Starting points: the ten themes from Anthropic's theme-factory skill (Apache-2.0), mapped onto the five
// colour roles the templates use, with open-licence Google Fonts in place of the system fonts they name.
export const PRESETS = [
  ['ocean-depths', 'Ocean Depths', 'Calm, professional, trust-building', { bg: '#1a2332', surface: '#283543', ink: '#f1faee', muted: '#b7e0e0', accent: '#2d8b8b' }, 'Manrope', 'Inter'],
  ['sunset-boulevard', 'Sunset Boulevard', 'Warm, vibrant, optimistic', { bg: '#264653', surface: '#37545f', ink: '#fdf6ec', muted: '#bcc1be', accent: '#e76f51' }, 'Fraunces', 'DM Sans'],
  ['forest-canopy', 'Forest Canopy', 'Natural, grounded, earthy', { bg: '#faf9f6', surface: '#ecede4', ink: '#2d4a2b', muted: '#7d8471', accent: '#5f7a3a' }, 'Lora', 'Work Sans'],
  ['modern-minimalist', 'Modern Minimalist', 'Clean, contemporary, precise', { bg: '#ffffff', surface: '#f1f2f3', ink: '#36454f', muted: '#708090', accent: '#36454f' }, 'Inter', 'Inter'],
  ['golden-hour', 'Golden Hour', 'Rich, warm, autumnal', { bg: '#f3ebe2', surface: '#e7d8c5', ink: '#4a403a', muted: '#7a6a5a', accent: '#c1666b' }, 'Fraunces', 'Outfit'],
  ['arctic-frost', 'Arctic Frost', 'Cool, crisp, clear', { bg: '#fafafa', surface: '#d4e4f7', ink: '#21324a', muted: '#4a6fa5', accent: '#4a6fa5' }, 'Sora', 'Inter'],
  ['desert-rose', 'Desert Rose', 'Soft, sophisticated, dusty', { bg: '#f5ece4', surface: '#e8d5c4', ink: '#5d2e46', muted: '#865258', accent: '#b87d6d' }, 'Playfair Display', 'DM Sans'],
  ['tech-innovation', 'Tech Innovation', 'Bold, modern, high-tech', { bg: '#1e1e1e', surface: '#2a2a2a', ink: '#ffffff', muted: '#9a9a9a', accent: '#0066ff' }, 'Space Grotesk', 'Inter'],
  ['botanical-garden', 'Botanical Garden', 'Fresh, organic, lively', { bg: '#f5f3ed', surface: '#e4e7de', ink: '#294431', muted: '#4a7c59', accent: '#b7472a' }, 'Fraunces', 'Figtree'],
  ['midnight-galaxy', 'Midnight Galaxy', 'Dramatic, cosmic, deep', { bg: '#2b1e3e', surface: '#3a2c4e', ink: '#e6e6fa', muted: '#a490c2', accent: '#a490c2' }, 'Unbounded', 'Outfit'],
].map(([id, name, tone, colors, display, body]) => ({ id, name, tone, colors, fonts: { display, body } }));

const HEX = /^#[0-9a-f]{6}$/i;
const ROLES = ['bg', 'surface', 'ink', 'muted', 'accent'];
const slug = s => String(s || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'brand';
const dirOf = id => {
  if (!/^[a-z0-9-]+$/.test(id) || id.startsWith('_')) throw Object.assign(new Error('bad brand id'), { code: 400 });
  return path.join(BRANDS, id);
};

export function readBrand(id) {
  try { return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'brand.json'), 'utf8')); } catch { return null; }
}
export function listBrands() {
  return fs.readdirSync(BRANDS).filter(d => !d.startsWith('_')).map(readBrand).filter(Boolean).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
}

export async function saveBrand(input, id = null) {
  const prev = id ? readBrand(id) : null;
  if (id && !prev) throw Object.assign(new Error('no such brand'), { code: 404 });
  const colors = {};
  for (const r of ROLES) {
    const v = input.colors?.[r] ?? prev?.colors?.[r];
    if (!HEX.test(v || '')) throw Object.assign(new Error(`colour "${r}" must be a hex value like #1a2332`), { code: 400 });
    colors[r] = v.toLowerCase();
  }
  const fonts = { display: input.fonts?.display || prev?.fonts?.display || 'Inter', body: input.fonts?.body || prev?.fonts?.body || 'Inter' };
  await Promise.all([ensureFont(fonts.display), ensureFont(fonts.body)]);
  if (!id) {
    id = slug(input.name);
    while (fs.existsSync(dirOf(id))) id = slug(input.name) + '-' + Math.random().toString(36).slice(2, 5);
    fs.mkdirSync(dirOf(id), { recursive: true });
  }
  const brand = {
    id, name: String(input.name ?? prev?.name ?? 'Untitled brand').slice(0, 60), colors, fonts,
    logo: prev?.logo || null, voice: input.voice || prev?.voice || 'af_heart', tone: String(input.tone ?? prev?.tone ?? '').slice(0, 300),
    source: input.source || prev?.source || 'custom', created: prev?.created || new Date().toISOString(), updated: new Date().toISOString(),
    createdBy: prev?.createdBy || input.editor || null, updatedBy: input.editor || null,
  };
  fs.writeFileSync(path.join(dirOf(id), 'brand.json'), JSON.stringify(brand, null, 1));
  return brand;
}

const LOGO_TYPES = { 'image/png': 'png', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export function saveLogo(id, buf, type) {
  const ext = LOGO_TYPES[type];
  if (!ext) throw Object.assign(new Error('the logo must be PNG, SVG, JPEG or WebP'), { code: 400 });
  if (buf.length > 5e6) throw Object.assign(new Error('the logo must be under 5 MB'), { code: 400 });
  const brand = readBrand(id);
  if (!brand) throw Object.assign(new Error('no such brand'), { code: 404 });
  for (const e of Object.values(LOGO_TYPES)) fs.rmSync(path.join(dirOf(id), 'logo.' + e), { force: true });
  fs.writeFileSync(path.join(dirOf(id), 'logo.' + ext), buf);
  brand.logo = 'logo.' + ext;
  brand.updated = new Date().toISOString();
  fs.writeFileSync(path.join(dirOf(id), 'brand.json'), JSON.stringify(brand, null, 1));
  return brand;
}
export function removeLogo(id) {
  const brand = readBrand(id);
  if (!brand) throw Object.assign(new Error('no such brand'), { code: 404 });
  if (brand.logo) fs.rmSync(path.join(dirOf(id), brand.logo), { force: true });
  brand.logo = null;
  fs.writeFileSync(path.join(dirOf(id), 'brand.json'), JSON.stringify(brand, null, 1));
  return brand;
}
export function deleteBrand(id) {
  if (!readBrand(id)) throw Object.assign(new Error('no such brand'), { code: 404 });
  fs.rmSync(dirOf(id), { recursive: true, force: true });
}

// what a page needs: font URLs and the logo, resolved for where the page is served from
function pageBrand(brand, url) {
  const face = family => { const f = fontOf(family); return { family, url: url(f.local, 'font'), fixed: f.fixed }; };
  return { id: brand.id, name: brand.name, colors: brand.colors, fonts: { display: face(brand.fonts.display), body: face(brand.fonts.body) }, logo: brand.logo ? url(brand.logo, 'logo') : null, tone: brand.tone };
}
// copy the brand's fonts and logo into a film folder (pages there are rendered without this server)
export async function brandIntoFilm(id, filmDir) {
  const brand = readBrand(id);
  if (!brand) throw Object.assign(new Error('no such brand'), { code: 404 });
  await Promise.all([ensureFont(brand.fonts.display), ensureFont(brand.fonts.body)]);
  const dest = path.join(filmDir, 'brand');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const fam of new Set([brand.fonts.display, brand.fonts.body])) {
    const f = fontOf(fam);
    fs.copyFileSync(path.join(FONTS, f.local), path.join(dest, f.local));
    const lic = path.join(FONTS, f.local.replace('.ttf', '-OFL.txt'));
    if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(dest, f.local.replace('.ttf', '-OFL.txt')));
  }
  if (brand.logo) fs.copyFileSync(path.join(dirOf(id), brand.logo), path.join(dest, brand.logo));
  return { brand, page: pageBrand(brand, file => 'brand/' + file) };
}
export const brandForPreview = brand => pageBrand(brand, (file, kind) => kind === 'font' ? '/fonts/' + file : `/brands/${brand.id}/${file}`);
