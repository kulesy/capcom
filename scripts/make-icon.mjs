// Draws public/icon.png, a lit amber lamp with a speech tail on the dark console, for the iPhone home screen.
// Run with `node scripts/make-icon.mjs` after changing the colours below.
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIZE = 180;
const CONSOLE = [0x17, 0x1e, 0x24];
const LAMP = [0xf2, 0xb8, 0x4b];
const LAMP_HI = [0xfb, 0xdc, 0x95];

// Signed distance to a rounded square centred in the icon, negative inside.
function roundedSquare(x, y, half, radius) {
  const dx = Math.max(Math.abs(x - SIZE / 2) - half + radius, 0);
  const dy = Math.max(Math.abs(y - SIZE / 2) - half + radius, 0);
  return Math.hypot(dx, dy) - radius;
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp = t => Math.min(1, Math.max(0, t));

// The speech tail hangs off the lamp's lower left corner, which is what makes it Capcom rather than Mission Control.
const TAIL = [[48, 128], [44, 164], [84, 136]];
function inTail(x, y) {
  const [[ax, ay], [bx, by], [cx, cy]] = TAIL;
  const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 3);
  for (let x = 0; x < SIZE; x++) {
    let cover = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
      if (roundedSquare(px, py, 50, 14) <= 0 || inTail(px, py)) cover++;
    }
    const d = roundedSquare(x + 0.5, y + 0.5, 50, 14);
    const glow = clamp(1 - d / 34) ** 2 * 0.35;
    const lit = mix(LAMP_HI, LAMP, clamp(Math.hypot(x - SIZE / 2, y - SIZE * 0.36) / 80));
    const px = mix(mix(CONSOLE, LAMP, d > 0 ? glow : 0), lit, cover / 16);
    px.forEach((v, i) => { row[1 + x * 3 + i] = v; });
  }
  rows.push(row);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.writeUInt8(8, 8);
header.writeUInt8(2, 9);

fs.writeFileSync(new URL('../public/icon.png', import.meta.url), Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
  chunk('IEND', Buffer.alloc(0)),
]));
