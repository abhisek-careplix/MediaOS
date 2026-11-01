// Vertex AI (Google Cloud) for generated images: Gemini's image model through generateContent.
// Access needs no stored key: on Compute Engine the VM's service account (from the metadata server; the VM needs the
// cloud-platform scope and the Vertex AI User role, which deploy/gcp-up.sh sets), elsewhere the gcloud CLI's signed-in account.
// Settings (environment): VERTEX_PROJECT (default: the VM's project, or gcloud's), VERTEX_LOCATION (global),
// VERTEX_IMAGE_MODEL (gemini-2.5-flash-image), VERTEX_IMAGE_PRICE (USD per million output tokens, 30).
import { execFile } from 'child_process';

const META = 'http://169.254.169.254/computeMetadata/v1';
export const IMAGE_MODEL = process.env.VERTEX_IMAGE_MODEL || 'gemini-2.5-flash-image';
const LOCATION = process.env.VERTEX_LOCATION || 'global';
const PRICE = +(process.env.VERTEX_IMAGE_PRICE || 30) / 1e6;

const gcloud = args => new Promise((res, rej) => execFile('gcloud', args, { timeout: 20000 }, (e, out) => e ? rej(e) : res(String(out).trim())));
let onGCE = null;
async function metadata(p) {
  if (onGCE === false) return null;
  try {
    const r = await fetch(META + p, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(onGCE ? 3000 : 600) });
    onGCE = r.ok;
    return r.ok ? r.text() : null;
  } catch { onGCE = false; return null; }
}

let cached = null, project = process.env.VERTEX_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || null;
async function token() {
  if (cached && cached.exp > Date.now() + 120e3) return cached.token;
  const m = await metadata('/instance/service-accounts/default/token');
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
  const parts = [...refs.slice(0, 3).map(r => ({ inlineData: { mimeType: r.mime, data: r.data.toString('base64') } })), { text: prompt }];
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${p}/locations/${LOCATION}/publishers/google/models/${IMAGE_MODEL}:generateContent`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }),
    });
    const j = await r.json().catch(() => ({}));
    // busy or over the per-minute quota: back off (4, 8, 16, 30 s, with jitter) and try again
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await new Promise(res => setTimeout(res, Math.min(30000, 4000 * 2 ** attempt) + Math.random() * 1500)); continue; }
    if (!r.ok) throw Object.assign(new Error(r.status === 429 ? 'Vertex AI is busy (over its per-minute quota). Try this frame again in a minute.' : j.error?.message?.slice(0, 300) || `Vertex AI answered ${r.status}`), { code: r.status });
    const c = j.candidates?.[0], img = c?.content?.parts?.find(x => x.inlineData);
    if (!img) throw new Error(c?.finishReason ? `No image (${c.finishReason.toLowerCase().replace(/_/g, ' ')})` : 'No image came back');
    return { png: Buffer.from(img.inlineData.data, 'base64'), mime: img.inlineData.mimeType, cost: (j.usageMetadata?.candidatesTokenCount || 1290) * PRICE };
  }
}
