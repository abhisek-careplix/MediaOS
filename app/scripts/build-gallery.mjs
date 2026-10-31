// Build the style gallery: metadata for every library style plus its frame image, and the quick templates' teasers.
//   node app/scripts/build-gallery.mjs
// Frames come from the library's GitHub repo (docs/frames, CC BY 4.0, LemoLab); demo films stream from the official gallery site.
import fs from 'fs';
import path from 'path';
import { LIB, APP } from '../lib/paths.mjs';
import { TEMPLATES } from '../lib/templates.mjs';

const OUT = path.join(APP, 'public', 'gallery');
const RAW = 'https://raw.githubusercontent.com/lemomo-ai/lemo-opuscar/main/docs/frames/';
const SITE = 'https://lemomo-ai.github.io/lemo-opuscar/';
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

const styles = [];
for (const slug of fs.readdirSync(path.join(LIB, 'styles')).filter(s => !s.startsWith('_')).sort()) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(LIB, 'styles', slug, 'style.json'), 'utf8')); } catch { continue; }
  const md = fs.readFileSync(path.join(LIB, 'styles', slug, 'STYLE.md'), 'utf8');
  const essence = (/^>\s*(.+)$/m.exec(md) || [])[1] || '';
  const frame = path.join(OUT, 'frames', slug + '.jpg');
  if (!fs.existsSync(frame)) {
    const r = await fetch(RAW + slug + '.jpg');
    if (r.ok) fs.writeFileSync(frame, Buffer.from(await r.arrayBuffer()));
    else console.error('no frame for', slug, r.status);
  }
  styles.push({
    slug, name: j.en, category: j.category_en, film: j.film, line: j.line, uses: j.uses || [], dur: j.dur || 0,
    essence: essence.replace(/\*\*/g, ''),
    frame: fs.existsSync(frame) ? `gallery/frames/${slug}.jpg` : null,
    video: `${SITE}films/${slug}.mp4`,
    instant: Object.values(TEMPLATES).find(t => t.librarySlug === slug)?.id || null,
  });
}
const templates = Object.values(TEMPLATES).map(t => ({ id: t.id, name: t.name, blurb: t.blurb, accents: t.accents, librarySlug: t.librarySlug,
  teaser: `gallery/teasers/${t.id}.mp4`, teaserPortrait: `gallery/teasers/${t.id}-portrait.mp4` }));
fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify({ credit: 'Style frames and demo films: LemoLab, CC BY 4.0', source: 'https://github.com/lemomo-ai/lemo-opuscar', styles, templates }, null, 1));
console.log(styles.length, 'styles →', path.join(OUT, 'styles.json'));
