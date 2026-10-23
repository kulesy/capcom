// Draws GhostShell's icons from the shell in public/ui/shell.js, white on the dark Ghost page: icon.png for the iPhone home screen,
// icon-192.png and icon-512.png for the manifest and the Mac app, and favicon.png for the browser tab.
// Run with `node scripts/make-icon.mjs` after changing the shell or the colours below.
import fs from 'node:fs';
import zlib from 'node:zlib';

const shell = fs.readFileSync(new URL('../public/ui/shell.js', import.meta.url), 'utf8');
function find(pattern, what) {
  const found = pattern.exec(shell);
  if (!found) throw new Error(`public/ui/shell.js no longer has ${what} in the form this script reads.`);
  return found[1];
}
const plate = name => find(new RegExp(`const ${name} = '([^']+)'`), `the ${name} plate`);
const PLATES = JSON.parse(find(/const PLATES = (\[.*\]);/, 'the list of plates').replace(/[A-Z]+/g, name => JSON.stringify(plate(name))));
const radius = part => Number(find(new RegExp(`class="shell-${part}" cx="12" cy="12" r="([\\d.]+)"`), `the ${part}`));
const SOCKET_RADIUS = radius('socket');
const EYE_RADIUS = radius('eye');

// The OKLCH lightness of the dark Ghost look's page, shell, socket and eye in public/ghost.css.
const grey = lightness => {
  const linear = lightness ** 3;
  return Math.round(255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055));
};
const PAGE = grey(0.21);
const SHELL = grey(0.955);
const SOCKET = grey(0.15);
const EYE = grey(0.99);

function corners(d) {
  const unreadable = () => new Error(`A plate in public/ui/shell.js uses path syntax this script does not draw: ${d}`);
  if (/[^MLQZ\d.,\s-]/.test(d)) throw unreadable();
  const points = [];
  for (const [, command, args] of d.matchAll(/([MLQZ])([^MLQZ]*)/g)) {
    const n = args.match(/-?[\d.]+/g)?.map(Number) ?? [];
    if (n.length !== { M: 2, L: 2, Q: 4, Z: 0 }[command] || n.some(Number.isNaN)) throw unreadable();
    if (command === 'M' || command === 'L') points.push([n[0], n[1]]);
    if (command === 'Q') {
      const [x0, y0] = points.at(-1);
      for (let i = 1; i <= 32; i++) {
        const t = i / 32, u = 1 - t;
        points.push([u * u * x0 + 2 * u * t * n[0] + t * t * n[2], u * u * y0 + 2 * u * t * n[1] + t * t * n[3]]);
      }
    }
  }
  return points;
}

function inside(points, x, y) {
  let crossed = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) crossed = !crossed;
  }
  return crossed;
}

const plates = PLATES.map(([turn, d]) => {
  const points = corners(d), xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  return { cos: Math.cos(turn * Math.PI / 180), sin: Math.sin(turn * Math.PI / 180), points, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
});

// Each plate is drawn pointing up and turned into place, so a point is turned back before it is tested against the plate.
const onPlate = (u, v) => plates.some(({ cos, sin, points, left, right, top, bottom }) => {
  const x = 12 + (u - 12) * cos + (v - 12) * sin, y = 12 - (u - 12) * sin + (v - 12) * cos;
  return x >= left && x <= right && y >= top && y <= bottom && inside(points, x, y);
});

function paint(u, v) {
  const r = Math.hypot(u - 12, v - 12);
  if (r <= EYE_RADIUS) return EYE;
  if (r <= SOCKET_RADIUS) return SOCKET;
  return onPlate(u, v) ? SHELL : PAGE;
}

// Signed distance to a rounded square filling the icon, negative inside.
function roundedSquare(x, y, size) {
  const half = size / 2, round = size * 0.22;
  const dx = Math.max(Math.abs(x - half) - half + round, 0);
  const dy = Math.max(Math.abs(y - half) - half + round, 0);
  return Math.hypot(dx, dy) - round;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

// The shell spans `fill` of the icon's width. A tile has round corners that show what is behind it; any other icon is a full square.
function draw(size, fill, tile = false) {
  const unit = size * fill / 24, samples = 8, channels = tile ? 4 : 3;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * channels);
    for (let x = 0; x < size; x++) {
      let sum = 0, cover = 0;
      for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
        const px = x + (sx + 0.5) / samples, py = y + (sy + 0.5) / samples;
        if (tile && roundedSquare(px, py, size) > 0) continue;
        cover++;
        sum += paint(12 + (px - size / 2) / unit, 12 + (py - size / 2) / unit);
      }
      row.fill(cover ? Math.round(sum / cover) : 0, 1 + x * channels, 4 + x * channels);
      if (tile) row[4 + x * channels] = Math.round(255 * cover / samples ** 2);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(tile ? 6 : 2, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const write = (name, icon) => fs.writeFileSync(new URL(`../public/${name}`, import.meta.url), icon);
write('icon.png', draw(180, 0.7));
write('icon-192.png', draw(192, 0.7));
write('icon-512.png', draw(512, 0.7));
// A tab shows its icon at 16 pixels, so the shell fills more of the favicon.
write('favicon.png', draw(64, 0.86, true));
