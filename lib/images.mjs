// What Capcom accepts as an attached image. The server checks every one before it is written to the CLI.
// The page keeps its own copy of these limits in public/ui/images.js.
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_IMAGES = 10;
// The API takes 5 MB per image. 3.75 MB of image is 5 MB as base64, so it fits however the API counts.
export const MAX_IMAGE_BYTES = (5 * 1024 * 1024 * 3) / 4;
// Ten full-size images as base64, plus room for the message and the JSON around them.
export const MAX_BODY_BYTES = MAX_IMAGES * (Math.ceil(MAX_IMAGE_BYTES / 3) * 4) + 1_000_000;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The type the first bytes say, or null for anything that is not one of the four.
export function sniff(head) {
  if (head.subarray(0, 8).equals(PNG)) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  const tag = head.toString('latin1');
  if (tag.startsWith('GIF87a') || tag.startsWith('GIF89a')) return 'image/gif';
  if (tag.startsWith('RIFF') && tag.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// The images in a request body as { mediaType, data }, or the reason they are refused. The type comes from the
// bytes, so a WebP saved under a .png name goes to Claude as the WebP it is.
export function readImages(list) {
  if (list == null) return { images: [] };
  if (!Array.isArray(list)) return { error: 'Images must be a list.' };
  if (list.length > MAX_IMAGES) return { error: `Attach at most ${MAX_IMAGES} images to one message.` };
  const images = [];
  for (const [n, img] of list.entries()) {
    const who = list.length > 1 ? `Image ${n + 1}` : 'The image';
    const data = img?.data;
    if (typeof data !== 'string' || data.length % 4 || !BASE64.test(data)) return { error: `${who} is not valid base64.` };
    const mediaType = sniff(Buffer.from(data.slice(0, 16), 'base64'));
    if (!IMAGE_TYPES.includes(img.mediaType) || !mediaType) return { error: `${who} is not a PNG, JPEG, GIF or WebP.` };
    if (Buffer.byteLength(data, 'base64') > MAX_IMAGE_BYTES) return { error: `${who} is over the ${MAX_IMAGE_BYTES / 1024 ** 2} MB limit.` };
    images.push({ mediaType, data });
  }
  return { images };
}
