// Team: who may do what. A person holds any mix of the roles below, kept in <governance>/team.json. Anyone signed in
// with no record is a Creator, so nobody loses access when this switches on; ADMIN_EMAILS (comma-separated) are always
// admins. Local mode has one person, who plays every part.
import fs from 'fs';
import path from 'path';
import { GOV } from './paths.mjs';
import { authOn, allowedEmail } from './auth.mjs';
import { audit } from './audit.mjs';

export const ROLES = {
  creator: { name: 'Creator', hint: 'Makes films, decks and productions, and submits them for review' },
  lead: { name: 'Creative lead', hint: 'First sign-off: brand and creative quality' },
  reviewer: { name: 'Medical, legal and regulatory', hint: 'Second sign-off: claims, disclosures and testimonials; approves Proof Library entries' },
  budget: { name: 'Budget owner', hint: 'Final sign-off, and the monthly spending caps' },
  admin: { name: 'Admin', hint: 'Manages the team' },
};
const FILE = path.join(GOV, 'team.json');
const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { people: {} }; }
}
function store(t) {
  fs.mkdirSync(GOV, { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(t, null, 1));
  fs.renameSync(FILE + '.tmp', FILE);
}

export function rolesOf(user) {
  if (!user) return [];
  if (user.local) return Object.keys(ROLES);
  if (user.guest) return ['creator'];
  const email = String(user.email).toLowerCase(), rec = load().people[email];
  const roles = rec ? rec.roles : ['creator'];
  return ADMINS.includes(email) ? [...new Set([...roles, 'admin'])] : roles;
}
export const can = (user, role) => rolesOf(user).includes(role);

// everyone with a record, plus the admins named in the settings
export function listTeam() {
  const t = load(), people = Object.entries(t.people).map(([email, p]) => ({ email, ...p, roles: rolesOf({ email }) }));
  for (const email of ADMINS) if (!t.people[email]) people.push({ email, name: null, roles: rolesOf({ email }), fromSettings: true });
  return people.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

export function setPerson(email, { name, roles }, by) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter an email address.');
  if (authOn() && !allowedEmail(email)) throw bad('Only people who can sign in to the studio can join the team.');
  const want = [...new Set((Array.isArray(roles) ? roles : []).filter(r => ROLES[r]))];
  const t = load(), prev = t.people[email];
  // there must always be an admin left to manage the team
  if (!ADMINS.length && prev?.roles.includes('admin') && !want.includes('admin') && !Object.entries(t.people).some(([e, p]) => e !== email && p.roles.includes('admin')))
    throw bad('Someone else needs the Admin role first: the team always needs an admin.');
  t.people[email] = { name: String(name ?? prev?.name ?? '').trim().slice(0, 80) || null, roles: want, by: by?.email || null, at: new Date().toISOString() };
  store(t);
  audit('team.roles-set', { target: email, detail: { roles: want, before: prev?.roles || null } });
  return { email, ...t.people[email], roles: rolesOf({ email }) };
}

export function removePerson(email) {
  email = String(email || '').toLowerCase();
  const t = load();
  if (!t.people[email]) throw bad('No such person.', 404);
  if (!ADMINS.length && t.people[email].roles.includes('admin') && !Object.entries(t.people).some(([e, p]) => e !== email && p.roles.includes('admin')))
    throw bad('Someone else needs the Admin role first: the team always needs an admin.');
  delete t.people[email];
  store(t);
  audit('team.removed', { target: email });
}

// the first admin on a server with no ADMIN_EMAILS and an empty team: nobody yet, so nobody can manage it
export const adminConfigured = () => ADMINS.length > 0 || Object.values(load().people).some(p => p.roles.includes('admin'));
