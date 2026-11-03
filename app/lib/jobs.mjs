// In-memory job registry: each film has at most one running job; progress fans out to SSE listeners.
// The latest state is mirrored into <film>/meta.json and every log line into <film>/log.jsonl,
// so the library and a production's activity survive a restart.
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { scrub } from './plain.mjs';

const jobs = new Map();
const BACKLOG = 2000;

export function readMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return null; }
}
// written whole or not at all (a full disk leaves the old file, never an empty one)
export function writeJSON(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
  fs.renameSync(file + '.tmp', file);
}
export function writeMeta(dir, meta) {
  writeJSON(path.join(dir, 'meta.json'), meta);
}
export function readLog(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).line).slice(-BACKLOG);
  } catch { return []; }
}

export function startJob(id, dir, kind) {
  const job = { id, dir, kind, status: 'running', step: '', pct: 0, log: [], listeners: new Set(), proc: null, started: Date.now(), output: null, error: null };
  jobs.set(id, job);
  try { fs.appendFileSync(path.join(dir, 'log.jsonl'), JSON.stringify({ t: 0, line: `── ${kind} started ${new Date().toISOString()}` }) + '\n'); } catch {}
  return job;
}
export const getJob = id => jobs.get(id);
export const runningJobs = () => [...jobs.values()].filter(j => j.status === 'running');

function snapshot(job) {
  const { id, kind, status, step, pct, output, error, started } = job;
  return { id, kind, status, step, pct, output, error, started, elapsed: Math.round((Date.now() - started) / 1000) };
}

// a frame from the finished film for library cards
function poster(job) {
  if (!job.output) return;
  const src = path.join(job.dir, job.output);
  execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], (e, out) => {
    const at = Math.min(4, Math.max(0, (parseFloat(out) || 4) * 0.25));
    execFile('ffmpeg', ['-v', 'error', '-y', '-ss', String(at), '-i', src, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', path.join(job.dir, 'poster.jpg')], () => {});
  });
}

export function emit(job, patch = {}, line = null) {
  // what reaches the browser is in plain words (no provider names or server paths); the raw text is in the server log
  if (line) { if (scrub(line) !== line) console.log(`[${job.id}]`, line); line = scrub(line); }
  for (const k of ['step', 'error']) if (patch[k]) patch[k] = scrub(patch[k]);
  Object.assign(job, patch);
  if (line) {
    job.log.push(line);
    if (job.log.length > BACKLOG) job.log.shift();
    try { fs.appendFileSync(path.join(job.dir, 'log.jsonl'), JSON.stringify({ t: Math.round((Date.now() - job.started) / 1000), line }) + '\n'); } catch {}
  }
  const msg = `data: ${JSON.stringify({ ...snapshot(job), line })}\n\n`;
  for (const res of job.listeners) res.write(msg);
  if (patch.status && patch.status !== 'running') {
    for (const res of job.listeners) res.end();
    job.listeners.clear();
    const meta = readMeta(job.dir) || {};
    writeMeta(job.dir, { ...meta, status: job.status, output: job.output, error: job.error, finished: new Date().toISOString(), seconds: Math.round((Date.now() - job.started) / 1000) });
    if (job.status === 'done') poster(job);
  }
}

export function subscribe(job, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ ...snapshot(job), backlog: job.log.slice(-BACKLOG) })}\n\n`);
  if (job.status !== 'running') return res.end();
  job.listeners.add(res);
  // a comment line now and then, so proxies don't close a stream that's quiet during a long take
  const beat = setInterval(() => res.write(': still working\n\n'), 20000);
  res.on('close', () => { clearInterval(beat); job.listeners.delete(res); });
}

export function cancel(job) {
  if (job.status !== 'running') return;
  // work that pays per item (takes, frames) stops starting new items and ends itself once those under way are in
  if (job.graceful) {
    if (!job.cancelled) emit(job, { step: 'Stopping after the work under way…' }, 'Stopping: no new takes or frames will start.');
    job.cancelled = true;
    return;
  }
  job.cancelled = true;
  if (job.proc) try { job.proc.kill('SIGTERM'); } catch {}
  emit(job, { status: 'cancelled', step: 'Cancelled' }, 'Cancelled.');
}
