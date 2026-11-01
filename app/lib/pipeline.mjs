// Quick-mode render: narration → events → frames (headless Chrome) → mix → master, using the library's core/ tools.
// Narration is a studio voice (lib/voice.mjs) where the film or a scene asks for one and the service is reachable,
// otherwise the offline voice (Kokoro).
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { emit } from './jobs.mjs';
import { LIB, APP } from './paths.mjs';
import { STUDIO_VOICES, isStudioVoice, studioReady, speak } from './voice.mjs';
import { VOICES } from './templates.mjs';

const PY = path.join(LIB, '.venv', 'bin', 'python');

// run a command, stream its lines to the job log, resolve on exit 0
function run(job, cmd, args, { cwd = LIB, onLine, env } = {}) {
  return new Promise((resolve, reject) => {
    if (job.cancelled) return reject(new Error('cancelled'));
    const p = spawn(cmd, args, { cwd, env: { ...process.env, LIB, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    job.proc = p;
    const tail = [];
    const feed = buf => {
      for (const line of String(buf).split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        if (onLine?.(line) !== false) emit(job, {}, line.slice(0, 300));
      }
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', reject);
    p.on('close', code => {
      job.proc = null;
      if (job.cancelled) return reject(new Error('cancelled'));
      code === 0 ? resolve() : reject(new Error(`${path.basename(args[0] || cmd)} exited ${code}: ${tail.slice(-4).join(' | ')}`));
    });
  });
}

const srtTime = t => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

export async function renderQuick(job, meta) {
  const dir = job.dir, size = meta.size, cf = path.join(dir, 'content.json');
  const content = JSON.parse(fs.readFileSync(cf, 'utf8'));
  const slug = (content.title || 'film').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'film';
  const outFile = path.join(dir, `${slug}.mp4`);
  try {
    // 1. narration: one WAV per scene, then the real durations go back into content.json so the timeline fits the voice.
    // A scene's own voice (a character's line in a cut from a production) wins over the film's narrator.
    delete content.voice;
    const known = v => isStudioVoice(v) || VOICES.some(x => x[0] === v);
    const lines = content.scenes.map((s, i) => ({ id: 's' + i, text: (s.narration || '').trim(), voice: [s.voice, meta.voice].find(known) || 'af_heart', delivery: s.delivery || '', speed: 1.0 })).filter(l => l.text);
    if (meta.narration !== false && lines.length) {
      emit(job, { step: 'Recording narration', pct: 3 });
      const vdir = path.join(dir, 'voice'), durs = {};
      fs.rmSync(vdir, { recursive: true, force: true });
      fs.mkdirSync(vdir, { recursive: true });
      // studio lines first (kept in voicecache/, so a re-render only records what changed); any that can't be recorded
      // join the offline ones in that voice's stand-in
      const offline = [];
      for (const l of lines) {
        if (!isStudioVoice(l.voice)) { offline.push(l); continue; }
        try {
          if (!studioReady()) throw new Error('the studio voices aren’t set up');
          const r = await speak({ text: l.text, voice: l.voice, delivery: l.delivery, cacheDir: path.join(dir, 'voicecache') });
          fs.copyFileSync(r.file, path.join(vdir, l.id + '.wav'));
          durs[l.id] = r.dur;
        } catch (e) {
          emit(job, {}, `Studio voice unavailable for ${l.id} (${e.message}); using the offline voice`);
          offline.push({ id: l.id, text: l.text, voice: STUDIO_VOICES[l.voice].k, speed: l.speed });
        }
      }
      if (offline.length) {
        fs.writeFileSync(path.join(dir, 'lines.json'), JSON.stringify(offline, null, 1));
        await run(job, PY, [path.join(LIB, 'core/tts/tts.py'), path.join(dir, 'lines.json'), vdir]);
        Object.assign(durs, JSON.parse(fs.readFileSync(path.join(vdir, 'dur.json'), 'utf8')));
      }
      fs.writeFileSync(path.join(vdir, 'dur.json'), JSON.stringify(durs, null, 1));
      content.voice = { durs };
    } else {
      content.voice = { durs: {} };
      content.scenes.forEach((s, i) => { content.voice.durs['s' + i] = 0; });
    }
    fs.writeFileSync(cf, JSON.stringify(content, null, 1));

    // 2. timeline and sound events from the page itself
    emit(job, { step: 'Laying out the timeline', pct: 12 });
    await run(job, 'node', ['core/render/events.mjs', dir, '--size', size]);
    const ev = JSON.parse(fs.readFileSync(path.join(dir, 'events.json'), 'utf8'));

    // 3. frames: headless Chrome, frame by frame, 4 workers
    emit(job, { step: 'Rendering frames', pct: 15 });
    const total = Math.round(ev.dur * 24), done = new Map();
    await run(job, 'node', ['core/render/video.mjs', dir, '--fps', '24', '--workers', '4', '--size', size, '--out', path.join(dir, 'out', 'video.mp4')], {
      onLine: line => {
        const m = /^w(\d+) (\d+)\/(\d+)/.exec(line);
        if (!m) return true;
        done.set(m[1], +m[2]);
        const n = [...done.values()].reduce((a, b) => a + b, 0);
        emit(job, { pct: Math.min(80, 15 + Math.round((65 * n) / Math.max(1, total))) });
        return false;
      },
    });

    // 4. score + foley + voice
    emit(job, { step: 'Scoring and mixing', pct: 82 });
    await run(job, PY, [path.join(APP, 'audio', 'mix.py'), dir]);

    // 5. master: loudness to −14 LUFS, no grain for these flat styles
    emit(job, { step: 'Mastering', pct: 92 });
    await run(job, 'sh', ['core/render/mux.sh', path.join(dir, 'out', 'video.mp4'), path.join(dir, 'out', 'mix.wav'), outFile, '24', '0']);

    // 6. subtitles from the page's caption cues
    const cues = ev.ev.filter(e => e.type === 'cue');
    if (cues.length) fs.writeFileSync(outFile.replace(/\.mp4$/, '.srt'), cues.map((c, i) => `${i + 1}\n${srtTime(c.t)} --> ${srtTime(c.t1)}\n${c.text}\n`).join('\n'));

    emit(job, { status: 'done', step: 'Done', pct: 100, output: path.basename(outFile) }, `Finished: ${outFile}`);
  } catch (e) {
    if (job.cancelled) return;
    emit(job, { status: 'failed', step: 'Failed', error: String(e.message || e) }, 'Error: ' + (e.message || e));
  }
}
