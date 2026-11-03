// Team: who may do what in each workspace. A person holds any mix of the roles below in a workspace, kept in its
// governance/team.json. They are in a workspace when its admin added them (by email: any Google account with that
// verified address), or when they sign in with a Google Workspace account on one of its domains, as a Creator; someone
// removed stays out even if their domain matches. ADMIN_EMAILS are the studio's operators: they create workspaces and
// are admins of the CarePlix one, but are in a customer's workspace only if added to it. Local mode has one person, who
// is in every workspace and plays every part.
import fs from 'fs';
import path from 'path';
import { dirsOf } from './paths.mjs';
import { current } from './context.mjs';
import { getWorkspace, listWorkspaces, homeWorkspace } from './workspaces.mjs';
import { audit } from './audit.mjs';

export const ROLES = {
  creator: { name: 'Creator', hint: 'Makes films, decks and productions, and submits them for review' },
  lead: { name: 'Creative lead', hint: 'First sign-off: brand and creative quality' },
  reviewer: { name: 'Medical, legal and regulatory', hint: 'Second sign-off: claims, disclosures and testimonials; approves Proof Library entries' },
  budget: { name: 'Budget owner', hint: 'Final sign-off, and the monthly spending caps' },
  admin: { name: 'Admin', hint: 'Manages the team' },
};
const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });
const fileOf = ws => path.join(dirsOf(ws).governance, 'team.json');
const domainOf = email => String(email || '').toLowerCase().split('@')[1] || '';

const cache = new Map();
function load(ws) {
  const f = fileOf(ws);
  try {
    const st = fs.statSync(f), c = cache.get(f);
    if (c?.key === st.mtimeMs + ':' + st.size) return c.data;
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    cache.set(f, { key: st.mtimeMs + ':' + st.size, data });
    return data;
  } catch { return { people: {} }; }
}
function store(ws, t) {
  const f = fileOf(ws);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(t, null, 1));
  fs.renameSync(f + '.tmp', f);
  cache.delete(f);
}
const wsNow = () => current().ws || (() => { throw bad('This request has no workspace.', 500); })();

// the studio's operators: they manage workspaces (local mode's one person included)
export const isOperator = user => !!user && (!!user.local || ADMINS.includes(String(user.email).toLowerCase()));

// a person's roles in one workspace, or null when they aren't in it. hd is the Google Workspace domain their sign-in
// proved (none for a personal Google account).
export function rolesIn(user, ws) {
  if (!user || !ws) return null;
  const w = getWorkspace(ws);
  if (!w) return null;
  if (user.local) return Object.keys(ROLES);
  if (user.guest) return ws === homeWorkspace() ? ['creator'] : null;
  const email = String(user.email).toLowerCase(), rec = load(ws).people[email];
  let roles = rec ? (rec.removed ? null : rec.roles) : user.hd && w.domains.includes(user.hd) && w.domains.includes(domainOf(email)) ? ['creator'] : null;
  if (ws === homeWorkspace() && ADMINS.includes(email)) roles = [...new Set([...(roles || []), 'admin'])];
  return roles;
}
// in this request's workspace
export const rolesOf = user => rolesIn(user, current().ws) || [];
export const can = (user, role) => rolesOf(user).includes(role);
// every workspace this person can enter, with their roles there
export const workspacesOf = user => listWorkspaces().map(w => ({ id: w.id, name: w.name, roles: rolesIn(user, w.id) })).filter(w => w.roles);

// everyone with a record in this workspace, plus (in the CarePlix one) the admins named in the settings
export function listTeam() {
  const ws = wsNow(), t = load(ws);
  const people = Object.entries(t.people).filter(([, p]) => !p.removed).map(([email, p]) => ({ email, name: p.name, by: p.by, at: p.at, roles: rolesIn({ email }, ws) || [] }));
  if (ws === homeWorkspace()) for (const email of ADMINS) if (!t.people[email] || t.people[email].removed) people.push({ email, name: null, roles: rolesIn({ email }, ws), fromSettings: true });
  return people.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}
const settingsAdmins = ws => ws === homeWorkspace() && ADMINS.length > 0;
const otherAdmin = (t, email) => Object.entries(t.people).some(([e, p]) => e !== email && !p.removed && p.roles.includes('admin'));

export function setPerson(email, { name, roles }, by) {
  const ws = wsNow();
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter an email address.');
  const want = [...new Set((Array.isArray(roles) ? roles : []).filter(r => ROLES[r]))];
  const t = load(ws), prev = t.people[email]?.removed ? null : t.people[email];
  // there must always be an admin left to manage the team
  if (!settingsAdmins(ws) && prev?.roles.includes('admin') && !want.includes('admin') && !otherAdmin(t, email))
    throw bad('Someone else needs the Admin role first: the team always needs an admin.');
  t.people[email] = { name: String(name ?? prev?.name ?? '').trim().slice(0, 80) || null, roles: want, by: by?.email || null, at: new Date().toISOString() };
  store(ws, t);
  audit('team.roles-set', { target: email, detail: { roles: want, before: prev?.roles || null } });
  return { email, ...t.people[email], roles: rolesIn({ email }, ws) || [] };
}

// they leave this workspace; the record stays, marked removed, so a domain that matches doesn't let them back in (which
// is also how someone who joined through the domain, and so has no record, is shut out)
export function removePerson(email) {
  const ws = wsNow();
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter an email address.');
  const t = load(ws);
  if (t.people[email]?.removed) throw bad('They are already removed.', 404);
  if (!settingsAdmins(ws) && t.people[email]?.roles.includes('admin') && !otherAdmin(t, email))
    throw bad('Someone else needs the Admin role first: the team always needs an admin.');
  t.people[email] = { removed: true, by: current().user?.email || null, at: new Date().toISOString() };
  store(ws, t);
  audit('team.removed', { target: email });
}

// a workspace with no admin yet: nobody can manage its team
export const adminConfigured = () => { const ws = wsNow(); return settingsAdmins(ws) || Object.values(load(ws).people).some(p => !p.removed && p.roles?.includes('admin')); };
export const memberCount = ws => Object.values(load(ws).people).filter(p => !p.removed).length;
