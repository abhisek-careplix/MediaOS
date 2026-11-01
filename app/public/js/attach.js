// Attachments for a brief, shared by Create and Productions: product photos (shown in the piece), reference images
// (Claude reads them, they aren't shown) and notes. state = { media: [], refs: [], notes: '' }; items are { id, url } from /api/uploads.
import { h, icon, toast } from './core.js';

export async function upload(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(`${file.name}: use PNG, JPEG or WebP images.`);
  if (file.size > 12e6) throw new Error(`${file.name} is over 12 MB.`);
  const r = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
export const uploading = state => [...state.media, ...state.refs].some(a => a.busy);
export const attachedIds = state => ({ media: state.media.map(a => a.id), refs: state.refs.map(a => a.id), notes: state.notes });

// the row of tiles and buttons; box.attach(files, 'media' | 'refs') adds files (for drop targets)
export function attachments(state) {
  const box = h('div', { class: 'attach' });
  let notesOpen = false;
  const attach = async (files, list) => {
    const room = 4 - state[list].length;
    if (files.length > room) toast(`Up to 4 ${list === 'media' ? 'product photos' : 'reference images'}.`, 'error');
    const adding = files.slice(0, Math.max(0, room)).map(file => ({ file, url: URL.createObjectURL(file), busy: true }));
    state[list].push(...adding);
    paint();
    await Promise.all(adding.map(async a => {
      try { Object.assign(a, await upload(a.file), { busy: false }); } catch (e) { toast(e.message, 'error'); state[list].splice(state[list].indexOf(a), 1); }
      paint();
    }));
  };
  const pick = list => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true, onchange: e => attach([...e.target.files], list) });
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  };
  const tile = (a, list, tag) => h('div', { class: 'att' + (a.busy ? ' busy' : ''), title: tag },
    h('img', { src: a.url, alt: tag }), h('span', { class: 'tag' }, tag),
    h('button', { class: 'rm', 'aria-label': 'Remove ' + tag.toLowerCase(), onclick: () => { state[list].splice(state[list].indexOf(a), 1); paint(); } }, icon('x', 11)));
  function paint() {
    const notes = h('textarea', { rows: 3, class: 'notes', placeholder: 'Reference notes: product facts, the offer, links, words to use or avoid…', 'aria-label': 'Reference notes', oninput: e => { state.notes = e.target.value; } });
    notes.value = state.notes;
    const open = notesOpen || !!state.notes;
    box.replaceChildren(
      ...state.media.map((a, i) => tile(a, 'media', `Product ${i + 1}`)),
      ...state.refs.map((a, i) => tile(a, 'refs', `Ref ${i + 1}`)),
      h('button', { class: 'chip', onclick: () => pick('media'), title: 'Product photos are shown in the piece' }, icon('photo', 13), 'Product photo'),
      h('button', { class: 'chip', onclick: () => pick('refs'), title: 'References guide Claude (an example ad, a landing page, a brand guide) but are not shown' }, icon('eye', 13), 'Reference'),
      h('button', { class: 'chip' + (open ? ' on' : ''), onclick: () => { notesOpen = !open; if (!notesOpen) state.notes = ''; paint(); } }, icon('pencil', 13), 'Notes'),
      ...(open ? [notes] : []));
  }
  box.attach = attach;
  paint();
  return box;
}

// images dropped anywhere on target become product photos
export function dropPhotos(target, box) {
  target.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); target.classList.add('over'); } });
  target.addEventListener('dragleave', e => { if (!target.contains(e.relatedTarget)) target.classList.remove('over'); });
  target.addEventListener('drop', e => { e.preventDefault(); target.classList.remove('over'); box.attach([...e.dataTransfer.files], 'media'); });
}
