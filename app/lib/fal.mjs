// fal.ai, the gateway for the studio's voice, talking-character, sound, music and Kling models (FAL_KEY).
// A request goes through fal's queue: submit, poll until it is done, read the result; files go up to fal's storage first,
// and finished files are downloaded straight away (fal's links are temporary). Errors are worded without the provider's
// name; the detail goes to the server log.
export const falReady = () => !!process.env.FAL_KEY;
const H = () => ({ Authorization: 'Key ' + process.env.FAL_KEY });
const wait = ms => new Promise(res => setTimeout(res, ms));
const fail = (msg, detail) => Object.assign(new Error(msg), { detail });
// an account without credit is locked: say so plainly, since only an admin can fix it
const unpaid = (status, j) => status === 403 && /balance|locked|billing/i.test(JSON.stringify(j));
const UNPAID = 'The studio service’s account is out of credit. An admin needs to top it up, then try again.';
// a request that survives a dropped connection: three tries, each with its own time limit
async function net(url, opts, ms) {
  for (let k = 0; ; k++) {
    try { return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }
    catch (e) {
      if (k >= 2) throw fail('The studio service couldn’t be reached. Try again.', `network: ${url.split('?')[0]} ${e.cause?.code || e.message}`);
      await wait(2000 * (k + 1));
    }
  }
}

// a file for a model's input: { data: Buffer, mime, name } → a URL fal can read
export async function upload({ data, mime, name = 'file' }) {
  if (!falReady()) throw new Error('This service isn’t set up on this server.');
  for (let attempt = 0; ; attempt++) {
    const r = await net('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
      method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ content_type: mime, file_name: name }) }, 30000);
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.upload_url) {
      const put = await net(j.upload_url, { method: 'PUT', headers: { 'Content-Type': mime }, body: data }, 120000);
      if (put.ok) return j.file_url;
    }
    if (unpaid(r.status, j)) throw Object.assign(fail(UNPAID, 'upload: account locked (balance)'), { code: 402 });
    if (attempt >= 2) throw fail('A file couldn’t be sent to the studio service.', `upload ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    await wait(2000 * (attempt + 1));
  }
}

// run a model: (endpoint, input) → its output object; minutes caps the wait
export async function run(model, input, { minutes = 10 } = {}) {
  if (!falReady()) throw new Error('This service isn’t set up on this server.');
  let q;
  for (let attempt = 0; ; attempt++) {
    const r = await net(`https://queue.fal.run/${model}`, { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, 60000);
    q = await r.json().catch(() => ({}));
    if (r.ok && q.status_url) break;
    if (unpaid(r.status, q)) throw Object.assign(fail(UNPAID, `${model}: account locked (balance)`), { code: 402 });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await wait(4000 * 2 ** attempt); continue; }
    throw Object.assign(fail(r.status === 429 ? 'The studio service is busy. Try again in a minute.' : `The studio service couldn’t take this request (${r.status}).`, `${model} ${JSON.stringify(q.detail || q).slice(0, 400)}`), { code: r.status });
  }
  const until = Date.now() + minutes * 60e3;
  let last = null;
  for (let polls = 0; Date.now() < until; polls++) {
    await wait(polls < 5 ? 2000 : 5000);
    const s = await (await fetch(q.status_url, { headers: H(), signal: AbortSignal.timeout(30000) }).catch(() => null))?.json().catch(() => ({}));
    if (!s) continue;
    last = s.status;
    if (s.status === 'COMPLETED') {
      const r = await net(q.response_url, { headers: H() }, 60000);
      const out = await r.json().catch(() => ({}));
      if (!r.ok) {
        const d = JSON.stringify(out.detail || out).slice(0, 400);
        throw fail(/content|safety|nsfw|policy/i.test(d) ? 'This was blocked by the service’s safety filter. Change the wording or the action and try again.' : 'The studio service couldn’t make this.', `${model} ${r.status} ${d}`);
      }
      return out;
    }
    if (s.status && !['IN_QUEUE', 'IN_PROGRESS'].includes(s.status)) throw fail('The studio service couldn’t make this.', `${model} ${JSON.stringify(s).slice(0, 300)}`);
  }
  throw fail('That took too long. Try again.', `${model}: gave up after ${minutes} min, last status ${last}${last === 'IN_QUEUE' ? ' (still waiting in the queue)' : ''}`);
}

// a finished file, downloaded
export async function fetchFile(url) {
  if (!url) throw new Error('Nothing came back from the studio service.');
  const r = await net(url, {}, 180000);
  if (!r.ok) throw new Error('The finished file couldn’t be downloaded.');
  return Buffer.from(await r.arrayBuffer());
}
