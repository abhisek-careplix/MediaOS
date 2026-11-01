// Quick-mode templates: id → name, the style brief given to Claude, and the accents the template supports.
import fs from 'fs';
import path from 'path';
import { LIB } from './paths.mjs';

export const TEMPLATES = {
  swiss: {
    id: 'swiss',
    name: 'Swiss Motion Graphics',
    blurb: 'Modular grid, one signal colour, type that snaps on the beat.',
    brief: 'International Typographic Style in motion: a light paper page, black grotesque type flush left on a 12-column grid, one saturated signal colour, everything snapping on the beat, knife cuts and page wipes. Cool, crisp, rule-like sentences.',
    accents: ['#E30613', '#FF5A00', '#1F3FFF', '#00A651'],
    bpm: 112,
    librarySlug: 'swiss-motion',
  },
  keynote: {
    id: 'keynote',
    name: 'Dark Tech Keynote',
    blurb: 'Near-black stage, light-sweep reveals, one luminous accent.',
    brief: 'A software launch keynote: near-black stage with a hairline grid, soft light sweeps that reveal one line per screen, UI cards that land on the beat, one giant number, one luminous accent colour. Confident, restrained, short declaratives.',
    accents: ['#B7F34A', '#8B7CFF', '#FF7A1A', '#3DD6F5'],
    bpm: 104,
    librarySlug: 'dark-keynote',
  },
  // internal: pre-production's animatic (storyboard frames timed to a temp voice); never offered in Create
  animatic: {
    id: 'animatic',
    name: 'Animatic',
    blurb: 'Storyboard frames timed to a temp voice and music.',
    brief: '',
    accents: ['#0a84ff'],
    bpm: 96,
    hidden: true,
  },
};

export const VOICES = [
  ['af_heart', 'Heart (US, female)'], ['af_bella', 'Bella (US, female)'], ['af_nicole', 'Nicole (US, female, soft)'], ['af_sarah', 'Sarah (US, female)'],
  ['am_michael', 'Michael (US, male)'], ['am_adam', 'Adam (US, male)'], ['am_onyx', 'Onyx (US, male, deep)'], ['am_puck', 'Puck (US, male, bright)'],
  ['bf_emma', 'Emma (UK, female)'], ['bf_isabella', 'Isabella (UK, female)'], ['bm_george', 'George (UK, male)'], ['bm_daniel', 'Daniel (UK, male)'],
];

// every library style, for director mode
export function libraryStyles() {
  const dir = path.join(LIB, 'styles');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(s => !s.startsWith('_')).map(slug => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, slug, 'style.json'), 'utf8'));
      return { slug, name: j.en, category: j.category_en, line: j.line };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
