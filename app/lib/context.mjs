// The request a piece of work belongs to: who asked, and for which product (brand kit) and asset. Set once per API
// request and carried through everything it starts, background jobs included, so the ledger and the audit trail know
// who to record without every function passing it along.
import { AsyncLocalStorage } from 'async_hooks';

const store = new AsyncLocalStorage();
export const runAs = (user, fn) => store.run({ user }, fn);
export const current = () => store.getStore() || {};
// name the product and asset the rest of this request works on
export const tag = info => { const s = store.getStore(); if (s) Object.assign(s, info); };
