// What people see when work reports progress or fails: plain words, never an AI provider's or model's name, a server
// path or a program's raw output. The full detail always goes to the server log.

// names → what the studio calls them
const NAMES = [
  [/\b(?:fal-ai|bytedance)\/[\w./-]+/gi, 'the studio service'], [/\bfal(?:\.ai|\.run|\.media)?\b/gi, 'the studio service'],
  [/\bclaude code\b/gi, 'the AI writer'], [/\bclaude[\w.-]*/gi, 'the AI writer'], [/\banthropic\b/gi, 'the AI provider'],
  [/\bkokoro\b/gi, 'the offline voice'], [/\beleven[\w./-]*/gi, 'the studio voices'], [/\bkling[\w./-]*/gi, 'the Character engine'],
  [/\bveo[\w.-]*/gi, 'the video engine'], [/\bvertex(?: ai)?\b/gi, 'the image service'], [/\bgemini[\w.-]*/gi, 'the image service'],
  [/\b(?:bytedance|omnihuman)[\w./-]*/gi, 'the talking-shot service'], [/\bmmaudio\b/gi, 'the sound service'],
];
// an absolute path on the server → just the file's name
const PATHS = /(?:\/(?:home|Users|data|tmp|private|var|opt|app)\b)[^\s'"`),]*/g;

export const scrub = text => {
  let s = String(text ?? '');
  for (const [re, word] of NAMES) s = s.replace(re, word);
  return s.replace(PATHS, m => m.split('/').filter(Boolean).pop() || '');
};

// a program's output rather than a sentence written for people
const RAW = /Traceback|exited \d+|\bE(?:NOENT|ACCES|PIPE|CONNRESET|CONNREFUSED|TIMEDOUT|PERM|NOSPC)\b|\bat [\w.<>]+ \(|\w+Error\b|spawn |command failed|\bstderr\b/;

// an error as people should read it: its own message when that was written for them, otherwise the fallback (and the
// detail goes to the log)
export function forPeople(e, fallback = 'Something went wrong. Try again in a minute.') {
  const msg = String(e?.message ?? e ?? '').trim();
  if (msg && msg.length <= 300 && !RAW.test(msg)) return scrub(msg);
  console.error('[error]', e?.detail || msg);
  return fallback;
}
