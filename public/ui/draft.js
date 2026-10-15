// The unsent message lives outside every component, so it follows you from one session to the next
// and typing redraws only the prompt box.
import { MAX_IMAGES, prepare } from './images.js';
import { createStore } from './store.js';

let text = '';

export const draftText = () => text;
export const setDraftText = value => { text = value; };

// The images attached to it. A store, because a file is decoded and scaled before it shows, and the box that
// took it may have been replaced by then.
export const attached = createStore({ images: [], preparing: 0 });

export const detach = id => attached.set(s => ({ images: s.images.filter(i => i.id !== id) }));

// Takes the files in order, as many as fit. Anything left out is reported through `notice`.
export async function attach(files, notice) {
  const { images, preparing } = attached.get();
  const room = Math.max(MAX_IMAGES - images.length - preparing, 0);
  if (files.length > room) notice(`A message can hold up to ${MAX_IMAGES} images.`);
  const take = files.slice(0, room);
  attached.set(s => ({ preparing: s.preparing + take.length }));
  for (const file of take) {
    try {
      const image = await prepare(file);
      attached.set(s => ({ images: [...s.images, image], preparing: s.preparing - 1 }));
    } catch (err) {
      attached.set(s => ({ preparing: s.preparing - 1 }));
      notice(err.message);
    }
  }
}
