// Attaching images: scaling a file down to what the API accepts, and turning it into what the server takes.
// The server checks the same limits in lib/images.mjs.
export const MAX_IMAGES = 10;
export const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_EDGE = 2000;
// The API takes 5 MB per image. 3.75 MB of image is 5 MB as base64, so it fits however the API counts.
const MAX_BYTES = (5 * 1024 * 1024 * 3) / 4;

// A counter rather than crypto.randomUUID, which a page served over plain http from another device does not have.
let counter = 0;

const dataUrl = blob => new Promise((done, fail) => {
  const reader = new FileReader();
  reader.onload = () => done(reader.result);
  reader.onerror = () => fail(reader.error);
  reader.readAsDataURL(blob);
});

const encode = (canvas, type, quality) => new Promise(done => canvas.toBlob(done, type, quality));

function draw(bitmap, width, height, background) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

// PNG first, so a screenshot stays sharp. JPEG only when the PNG is too big, and a smaller picture if that is too.
async function fit(bitmap, width, height, photo) {
  for (let scale = 1; ; scale *= 0.75) {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (!photo) {
      const png = await encode(draw(bitmap, w, h), 'image/png');
      if (png?.size <= MAX_BYTES) return png;
    }
    const flat = draw(bitmap, w, h, '#fff');
    for (const quality of [0.9, 0.75, 0.6]) {
      const jpeg = await encode(flat, 'image/jpeg', quality);
      if (jpeg?.size <= MAX_BYTES) return jpeg;
    }
    if (Math.max(w, h) < 200) return null;
  }
}

// A file as the page holds it: a data URL, which draws the thumbnail and is what gets sent. A file within both limits
// goes as it is, which keeps an animated GIF animated. Anything else is redrawn smaller first.
export async function prepare(file) {
  const name = file.name || 'That file';
  if (!TYPES.includes(file.type)) throw new Error(`${name} is not a PNG, JPEG, GIF or WebP image.`);
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`${name} could not be read as an image.`); });
  try {
    const { width, height } = bitmap;
    const shrink = Math.min(1, MAX_EDGE / Math.max(width, height));
    const blob = shrink === 1 && file.size <= MAX_BYTES ? file : await fit(bitmap, Math.round(width * shrink), Math.round(height * shrink), file.type === 'image/jpeg');
    if (!blob) throw new Error(`${name} could not be made small enough to send.`);
    return { id: ++counter, name, src: await dataUrl(blob) };
  } finally {
    bitmap.close();
  }
}

// The images as the send and new routes take them.
export const payload = images => images.map(({ src }) => ({ mediaType: src.slice(5, src.indexOf(';')), data: src.slice(src.indexOf(',') + 1) }));
