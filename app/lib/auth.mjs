// Google sign-in for a deployed CarePlix Studio, limited to Google Workspace domains (default careplix.com).
// Server-side OpenID Connect: authorization code + PKCE, ID token verified against Google's keys, then a
// signed, HttpOnly session cookie. With no GOOGLE_CLIENT_ID the app runs in local mode (localhost only, no login).
import crypto from 'crypto';

export const AUTH = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  domains: (process.env.ALLOWED_DOMAINS || 'careplix.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  publicURL: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  secret: process.env.SESSION_SECRET || '',
  days: +process.env.SESSION_DAYS || 7,
};
export const authOn = () => !!AUTH.clientId;
const LOCAL_USER = { email: 'local', name: 'Local', local: true };
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// what is missing before the app may face the internet
export function configProblems() {
  if (!authOn()) return [];
  const p = [];
  if (!AUTH.clientSecret) p.push('GOOGLE_CLIENT_SECRET is not set');
  if (!/^https:\/\//.test(AUTH.publicURL) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(AUTH.publicURL)) p.push('PUBLIC_URL must be the https:// address of the site');
  if (AUTH.secret.length < 32) p.push('SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)');
  if (!AUTH.domains.length) p.push('ALLOWED_DOMAINS is empty');
  return p;
}

// —— signed tokens (sessions and the short-lived OAuth state) ——
const mac = data => crypto.createHmac('sha256', AUTH.secret).update(data).digest('base64url');
export function seal(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return body + '.' + mac(body);
}
export function unseal(token, kind) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = mac(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let o;
  try { o = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (o.kind !== kind || !(o.exp > Date.now() / 1000)) return null;
  return o;
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const secure = () => AUTH.publicURL.startsWith('https://');
function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure() ? '; Secure' : ''}`;
}

export const allowedEmail = email => {
  const d = String(email || '').toLowerCase().split('@')[1];
  return !!d && AUTH.domains.includes(d);
};

// the signed-in user, or null; local mode always has one
export function currentUser(req) {
  if (!authOn()) return LOCAL_USER;
  const s = unseal(cookies(req).vg_session, 'session');
  return s && allowedEmail(s.email) ? { email: s.email, name: s.name, picture: s.picture } : null;
}

// a same-site path to return to after sign-in
const safeNext = n => (typeof n === 'string' && /^\/(?!\/)/.test(n) && !/[\r\n]/.test(n) ? n : '/');

export function startLogin(res, next) {
  const state = crypto.randomBytes(18).toString('base64url');
  const nonce = crypto.randomBytes(18).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({
    client_id: AUTH.clientId, redirect_uri: AUTH.publicURL + '/auth/google/callback', response_type: 'code',
    scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  if (AUTH.domains.length === 1) q.set('hd', AUTH.domains[0]);   // a hint to Google's account picker; enforced below regardless
  res.writeHead(302, {
    Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q,
    'Set-Cookie': cookie('vg_oauth', seal({ kind: 'oauth', state, nonce, verifier, next: safeNext(next), exp: Date.now() / 1000 + 600 }), 600),
    'Cache-Control': 'no-store',
  });
  res.end();
}

// Google's signing keys, cached for as long as Google says
let jwksCache = { keys: null, until: 0 };
async function googleKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('could not fetch Google signing keys');
  const age = +(/max-age=(\d+)/.exec(r.headers.get('cache-control') || '') || [])[1] || 3600;
  jwksCache = { keys: (await r.json()).keys, until: Date.now() + age * 1000 };
  return jwksCache.keys;
}

// Verify an ID token's signature and claims; returns the claims or throws with a reason code.
export function verifyIdToken(token, { keys, nonce, now = Date.now() / 1000 }) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) throw new Error('malformed');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const jwk = keys.find(k => k.kid === header.kid);
  if (header.alg !== 'RS256' || !jwk) throw new Error('unknown-key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('bad-signature');
  const c = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (!ISSUERS.includes(c.iss)) throw new Error('bad-issuer');
  if (c.aud !== AUTH.clientId) throw new Error('bad-audience');
  if (!(c.exp > now - 60)) throw new Error('expired');
  if (nonce && c.nonce !== nonce) throw new Error('bad-nonce');
  if (c.email_verified !== true) throw new Error('unverified-email');
  // both the Workspace domain claim and the address itself must be allowed
  if (!AUTH.domains.includes(String(c.hd || '').toLowerCase()) || !allowedEmail(c.email)) throw new Error('domain');
  return c;
}

export async function finishLogin(req, res, url) {
  const fail = code => {
    res.writeHead(302, { Location: '/login?error=' + code, 'Set-Cookie': cookie('vg_oauth', '', 0), 'Cache-Control': 'no-store' });
    res.end();
  };
  const st = unseal(cookies(req).vg_oauth, 'oauth');
  if (url.searchParams.get('error')) return fail('cancelled');
  if (!st || !url.searchParams.get('state') || url.searchParams.get('state') !== st.state) return fail('state');
  let claims;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: url.searchParams.get('code') || '', client_id: AUTH.clientId, client_secret: AUTH.clientSecret,
        redirect_uri: AUTH.publicURL + '/auth/google/callback', grant_type: 'authorization_code', code_verifier: st.verifier,
      }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) throw new Error('exchange');
    claims = verifyIdToken(tok.id_token, { keys: await googleKeys(), nonce: st.nonce });
  } catch (e) {
    console.error('[auth] sign-in refused:', e.message);
    return fail(['domain', 'unverified-email', 'expired'].includes(e.message) ? e.message : 'google');
  }
  const session = seal({ kind: 'session', email: claims.email.toLowerCase(), name: claims.name || claims.email, picture: claims.picture || null, exp: Math.floor(Date.now() / 1000) + AUTH.days * 86400 });
  console.log('[auth] signed in', claims.email);
  res.writeHead(302, { Location: st.next, 'Set-Cookie': [cookie('vg_session', session, AUTH.days * 86400), cookie('vg_oauth', '', 0)], 'Cache-Control': 'no-store' });
  res.end();
}

export function logout(res) {
  res.writeHead(302, { Location: '/login?signedout=1', 'Set-Cookie': cookie('vg_session', '', 0), 'Cache-Control': 'no-store' });
  res.end();
}
