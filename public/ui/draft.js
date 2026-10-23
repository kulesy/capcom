// The unsent message lives outside every component, so it follows you from one session to the next
// and typing redraws only the prompt box.
import { api, postFile } from './api.js';
import { MAX_IMAGES, prepare, TYPES } from './images.js';
import { createStore } from './store.js';

let text = '';

export const draftText = () => text;
export const setDraftText = value => { text = value; };

// The images and files attached to it. A store, because a file is decoded and scaled, or uploaded, before it shows as sent, and the box that
// took it may have been replaced by then. A file still on its way up carries `uploading` and the controller that can stop it.
export const attached = createStore({ images: [], files: [], preparing: 0 });

// What this server takes as a file, or null on one that takes only images. Asked for when the page loads.
export const uploads = createStore({ limits: null });

export async function checkUploads() {
  try {
    const { maxBytes, maxFiles } = await api('api/uploads');
    uploads.set({ limits: { maxBytes, maxFiles } });
  } catch {
    uploads.set({ limits: null });
  }
}

// The files a paste takes. A server that takes only images leaves any other pasted file to the browser, as it did before files, and is asked
// again in the background, so a paste after the server has been updated works.
export function pastedFiles(files) {
  if (uploads.get().limits) return files;
  if (files.some(f => !f.type.startsWith('image/'))) checkUploads();
  return files.filter(f => f.type.startsWith('image/'));
}

export const detach = id => attached.set(s => ({ images: s.images.filter(i => i.id !== id) }));

export function detachFile(key) {
  attached.get().files.find(f => f.key === key)?.abort?.abort();
  attached.set(s => ({ files: s.files.filter(f => f.key !== key) }));
}

const isNative = file => TYPES.includes(file.type);
// An image the server does not take as one, such as HEIC. The page redraws it if the browser can decode it, and SVG is text.
const isOther = file => file.type.startsWith('image/') && file.type !== 'image/svg+xml' && !isNative(file);

const full = limit => `A message can hold up to ${limit} files.`;

let counter = 0;

// Uploads one file, its card showing at once. A failure drops the card and says why, and so does a file the server would refuse.
async function uploadFile(file, notice, { maxBytes, maxFiles }) {
  const name = file.name || 'file';
  if (file.size > maxBytes) return notice(`${name} is over the ${maxBytes / 1024 ** 2} MB limit.`);
  if (attached.get().files.length >= maxFiles) return notice(full(maxFiles));
  const key = `file${++counter}`;
  const abort = new AbortController();
  attached.set(s => ({ files: [...s.files, { key, name, size: file.size, uploading: true, abort }] }));
  try {
    const saved = await postFile('api/uploads', file, name, abort.signal);
    attached.set(s => ({ files: s.files.map(f => (f.key === key ? { key, id: saved.id, name: saved.name, size: saved.size, type: saved.type } : f)) }));
  } catch (err) {
    attached.set(s => ({ files: s.files.filter(f => f.key !== key) }));
    if (!abort.signal.aborted) notice(err instanceof TypeError ? `${name} could not be uploaded.` : err.message);
  }
}

async function addImage(file, notice, limits) {
  try {
    const image = await prepare(file, { convert: !!limits });
    attached.set(s => ({ images: [...s.images, image], preparing: s.preparing - 1 }));
  } catch (err) {
    attached.set(s => ({ preparing: s.preparing - 1 }));
    // An image the browser cannot decode goes up as the file it is. One of the four types that will not decode is still an error.
    if (limits && !isNative(file)) await uploadFile(file, notice, limits);
    else notice(err.message);
  }
}

// Takes the files in order, as many as fit. Anything left out is reported through `notice`. The four image types, and other images the
// browser can decode, become images. Everything else uploads, when this server takes files, and otherwise gets the notice it always did.
export async function attach(files, notice) {
  if (!uploads.get().limits && files.some(f => !isNative(f))) await checkUploads();
  const { limits } = uploads.get();
  const pictures = limits ? files.filter(f => isNative(f) || isOther(f)) : files;
  const rest = limits ? files.filter(f => !isNative(f) && !isOther(f)) : [];
  const { images, preparing } = attached.get();
  const room = Math.max(MAX_IMAGES - images.length - preparing, 0);
  if (pictures.length > room) notice(`A message can hold up to ${MAX_IMAGES} images.`);
  const take = pictures.slice(0, room);
  attached.set(s => ({ preparing: s.preparing + take.length }));
  const places = limits ? Math.max(limits.maxFiles - attached.get().files.length, 0) : 0;
  if (rest.length > places) notice(full(limits.maxFiles));
  const uploading = rest.slice(0, places).map(file => uploadFile(file, notice, limits));
  for (const file of take) await addImage(file, notice, limits);
  await Promise.all(uploading);
}
