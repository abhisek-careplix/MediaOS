// Vertex AI (Google Cloud) for generated images: Gemini's image model through generateContent.
// Access needs no stored key: on Compute Engine the VM's service account (from the metadata server; the VM needs the
// cloud-platform scope and the Vertex AI User role, which deploy/gcp-up.sh sets), elsewhere the gcloud CLI's signed-in account.
// Settings (environment): VERTEX_PROJECT (default: the VM's project, or gcloud's), VERTEX_LOCATION (global),
// VERTEX_IMAGE_MODEL (gemini-3.1-flash-image), VERTEX_IMAGE_PRICE (USD per million output tokens; by model below),
// VERTEX_LOOK_MODEL (the take check's vision model).
import { execFile } from 'child_process';
import { billed } from './ledger.mjs';

const META = 'http://169.254.169.254/computeMetadata/v1';
export const IMAGE_MODEL = process.env.VERTEX_IMAGE_MODEL || 'gemini-3.1-flash-image';
// the newer image models keep faces and products truer and take more references (portraits and full-length views)
export const MAX_REFS = /^gemini-2\./.test(IMAGE_MODEL) ? 3 : 6;
const LOCATION = process.env.VERTEX_LOCATION || 'global';
// USD per million output tokens (a 1K frame is about 1,100-1,300 tokens); list-price estimates for the newer models
const PRICES = { 'gemini-2.5-flash-image': 30, 'gemini-3.1-flash-image': 60, 'gemini-nano-banana-2.1': 60, 'gemini-3-pro-image': 120 };
const PRICE = +(process.env.VERTEX_IMAGE_PRICE || PRICES[IMAGE_MODEL] || 60) / 1e6;

const gcloud = args => new Promise((res, rej) => execFile('gcloud', args, { timeout: 20000 }, (e, out) => e ? rej(e) : res(String(out).trim())));
// off Google Cloud, the metadata server is asked again only every 10 minutes; on it, one slow answer is just retried
// (it never switches the server to gcloud, which a deployed server doesn't have)
let onGCE = null, probed = 0;
async function metadata(p) {
  if (onGCE === false && Date.now() - probed < 600e3) return null;
  try {
    const r = await fetch(META + p, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(onGCE ? 3000 : 1500) });
    onGCE = r.ok;
    probed = Date.now();
    return r.ok ? r.text() : null;
  } catch {
    if (!onGCE) { onGCE = false; probed = Date.now(); }
    return null;
  }
}

let cached = null, project = process.env.VERTEX_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || null;
async function token() {
  if (cached && cached.exp > Date.now() + 120e3) return cached.token;
  let m = await metadata('/instance/service-accounts/default/token');
  if (!m && onGCE) m = await metadata('/instance/service-accounts/default/token');   // on Google Cloud: ask again, never gcloud
  if (m) { const j = JSON.parse(m); cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 }; return cached.token; }
  const t = await gcloud(['auth', 'print-access-token']);
  cached = { token: t, exp: Date.now() + 45 * 60e3 };
  return t;
}
async function projectId() {
  if (project) return project;
  project = (await metadata('/project/project-id')) || (await gcloud(['config', 'get-value', 'project']).catch(() => '')) || null;
  return project;
}

// for other Vertex AI callers (video shots)
export { token as vertexToken, projectId as vertexProject };

// whether images can be generated here, checked once every ten minutes: { ok, model, reason }
let status = null;
export async function vertexStatus() {
  if (status && status.at > Date.now() - 600e3) return status;
  try {
    const [t, p] = await Promise.all([token(), projectId()]);
    if (!p) throw new Error('No Google Cloud project: set VERTEX_PROJECT.');
    const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${p}/locations/${LOCATION}/publishers/google/models/${IMAGE_MODEL}:countTokens`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ok' }] }] }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    status = r.ok ? { ok: true, model: IMAGE_MODEL, project: p } : { ok: false, model: IMAGE_MODEL, reason: j.error?.message?.slice(0, 200) || `Vertex AI answered ${r.status}` };
  } catch (e) { status = { ok: false, model: IMAGE_MODEL, reason: 'Vertex AI is not reachable: ' + String(e.message || e).slice(0, 160) }; }
  status.at = Date.now();
  return status;
}

// One image from a prompt and up to three reference images ([{ mime, data: Buffer }]).
// Returns { png: Buffer, mime, cost }, or throws with the model's reason (for example a safety block).
export async function generateImage({ prompt, refs = [], aspect = '16:9' }) {
  const [t, p] = await Promise.all([token(), projectId()]);
  const parts = [...refs.slice(0, MAX_REFS).map(r => ({ inlineData: { mimeType: r.mime, data: r.data.toString('base64') } })), { text: prompt }];
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${p}/locations/${LOCATION}/publishers/google/models/${IMAGE_MODEL}:generateContent`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }),
    });
    const j = await r.json().catch(() => ({}));
    // busy or over the per-minute quota: back off (4, 8, 16, 30 s, with jitter) and try again
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise(res => setTimeout(res, Math.min(30000, 4000 * 2 ** attempt) + Math.random() * 1500)); continue; }
    // the reason people see names no provider
    if (!r.ok) throw Object.assign(new Error(r.status === 429 ? 'The image service is busy. Try this frame again in a minute.' : `The image service couldn’t make this frame (${r.status}).`), { code: r.status, detail: j.error?.message });
    const c = j.candidates?.[0], img = c?.content?.parts?.find(x => x.inlineData);
    if (!img) throw new Error(c?.finishReason ? `No image (${c.finishReason.toLowerCase().replace(/_/g, ' ')})` : 'No image came back.');
    return billed('image', { png: Buffer.from(img.inlineData.data, 'base64'), mime: img.inlineData.mimeType, cost: (j.usageMetadata?.candidatesTokenCount || 1290) * PRICE });
  }
}

// A quick look at images (a fast vision model): { prompt, images: [{ mime, data, label }], schema } → the JSON the schema
// asks for. Used to check a take against the cast's portraits and the product photo.
const LOOK_MODEL = process.env.VERTEX_LOOK_MODEL || 'gemini-3.8-flash';
export async function lookAt({ prompt, images, schema }) {
  const [t, p] = await Promise.all([token(), projectId()]);
  const parts = images.flatMap(im => [{ text: im.label }, { inlineData: { mimeType: im.mime, data: im.data.toString('base64') } }]);
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${p}/locations/${LOCATION}/publishers/google/models/${LOOK_MODEL}:generateContent`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [...parts, { text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    const j = await r.json().catch(() => ({}));
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise(res => setTimeout(res, 3000 * 2 ** attempt)); continue; }
    if (!r.ok) throw Object.assign(new Error(`The check couldn’t run (${r.status}).`), { code: r.status, detail: j.error?.message });
    const text = j.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('') || '';
    const u = j.usageMetadata || {};
    return billed('writer', { data: JSON.parse(text), cost: (u.promptTokenCount || 0) * 0.3e-6 + (u.candidatesTokenCount || 0) * 2.5e-6 });
  }
}
