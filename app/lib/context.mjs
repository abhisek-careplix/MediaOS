// The request a piece of work belongs to: who asked, in which workspace, and for which product (brand kit) and asset.
// Set once per request and carried through everything it starts, background jobs included, so every folder, the ledger
// and the audit trail are the workspace's own without every function passing it along.
import { AsyncLocalStorage } from 'async_hooks';

const store = new AsyncLocalStorage();
export const runAs = (user, ws, fn) => store.run({ user, ws }, fn);
// the server's own work in one workspace (a follow-up, a sweep), with nobody behind it
export const inWorkspace = (ws, fn) => store.run({ user: null, ws }, fn);
export const current = () => store.getStore() || {};
// name the product and asset the rest of this request works on
export const tag = info => { const s = store.getStore(); if (s) Object.assign(s, info); };
