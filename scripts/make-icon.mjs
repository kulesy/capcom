// Draws GhostShell's icons from the shell in public/ui/shell.js, white on the dark Ghost look's greys: icon.png for the iPhone home screen,
// favicon.png for the browser tab, icon-maskable.png for Chrome to shape into the Mac Dock icon, and icon-192.png and icon-512.png,
// the same tile already in that shape, for the manifest and the Mac app.
// Run with `node scripts/make-icon.mjs` after changing the shell or the colours below.
// Each Node's zlib packs the same pixels into different bytes, so a run on another Node rewrites every PNG without changing it.
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
// The Mac tile fades from the first lightness at the top of its body to the second at the bottom.
const TILE_TOP = 0.34;
const TILE_BOTTOM = 0.18;
// The shell spans this much of the Mac icon's width, about 72% of its tile, as other Mac apps' glyphs fill theirs.
const MAC_FILL = 0.58;
// Chrome shapes a maskable icon into the Mac Dock icon with these numbers, in 1024ths of its size, so the icons here match it.
// See https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/web_applications/os_integration/mac/icon_utils.mm
const MAC = { inset: 100, radius: 184, drop: 10, blur: 10, shadow: 77 / 255 };

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

// Null off the mark, so the caller supplies what is behind it.
function paint(u, v) {
  const r = Math.hypot(u - 12, v - 12);
  if (r <= EYE_RADIUS) return EYE;
  if (r <= SOCKET_RADIUS) return SOCKET;
  return onPlate(u, v) ? SHELL : null;
}

// Signed distance to a rounded square `inset` in from the icon's edge, negative inside. By default it fills the icon with round corners.
function roundedSquare(x, y, size, inset = 0, round = size * 0.22) {
  const half = size / 2;
  const dx = Math.max(Math.abs(x - half) - half + inset + round, 0);
  const dy = Math.max(Math.abs(y - half) - half + inset + round, 0);
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

// A grey icon, or one that also has an alpha for each pixel.
function png(size, shades, alpha) {
  const channels = alpha ? 4 : 3, stride = 1 + size * channels;
  const rows = Buffer.alloc(size * stride);
  for (let i = 0; i < size * size; i++) {
    const at = Math.floor(i / size) * stride + 1 + i % size * channels;
    rows.fill(shades[i], at, at + 3);
    if (alpha) rows[at + 3] = alpha[i];
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(alpha ? 6 : 2, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The mark on `background`, a grey for each height, with the shell spanning `fill` of the icon's width.
function mark(size, fill, background) {
  const unit = size * fill / 24;
  return (px, py) => paint(12 + (px - size / 2) / unit, 12 + (py - size / 2) / unit) ?? background(py);
}

// Each pixel's shade is the mean of its sample points `inside` the shape, and `cover` is the share of its points that are.
function render(size, colour, inside = () => true, samples = 8) {
  const shades = new Uint8Array(size * size), cover = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, count = 0;
      for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
        const px = x + (sx + 0.5) / samples, py = y + (sy + 0.5) / samples;
        if (!inside(px, py)) continue;
        count++;
        sum += colour(px, py);
      }
      shades[y * size + x] = count ? Math.round(sum / count) : 0;
      cover[y * size + x] = count / samples ** 2;
    }
  }
  return { shades, cover };
}

// A full square on the page, or with round corners that show what is behind it.
function flat(size, fill) {
  return png(size, render(size, mark(size, fill, () => PAGE)).shades);
}
function tab(size, fill) {
  const { shades, cover } = render(size, mark(size, fill, () => PAGE), (x, y) => roundedSquare(x, y, size) <= 0);
  return png(size, shades, cover.map(share => Math.round(255 * share)));
}

// The Mac tile and mark across the whole canvas, with no clip or shadow, lighter at the top of the tile's body and darker at the bottom.
function maskable(size) {
  const top = size * MAC.inset / 1024, span = size - 2 * top;
  const tile = y => grey(TILE_TOP + (TILE_BOTTOM - TILE_TOP) * Math.min(Math.max((y - top) / span, 0), 1));
  return render(size, mark(size, MAC_FILL, tile)).shades;
}

// A Gaussian blur of a size by size mask, along the rows and then down the columns.
function blur(mask, size, sigma) {
  const reach = Math.ceil(3 * sigma);
  const weights = Array.from({ length: 2 * reach + 1 }, (_, i) => Math.exp(-((i - reach) ** 2) / (2 * sigma ** 2)));
  const total = weights.reduce((sum, weight) => sum + weight);
  const pass = (from, step, line) => {
    const to = new Float64Array(size * size);
    for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) {
      let sum = 0;
      for (let k = Math.max(-reach, -b); k <= Math.min(reach, size - 1 - b); k++) sum += weights[k + reach] * from[a * line + (b + k) * step];
      to[a * line + b * step] = sum / total;
    }
    return to;
  };
  return pass(pass(mask, 1, size), size, 1);
}

// The maskable icon as Chrome shapes it on a Mac: clipped to the rounded square, over its shadow.
function shaped(size, shades) {
  const scale = size / 1024;
  const area = drop => render(size, () => 0, (x, y) => roundedSquare(x, y - drop, size, MAC.inset * scale, MAC.radius * scale) <= 0).cover;
  const body = area(0), shadow = blur(area(MAC.drop * scale), size, MAC.blur * scale);
  const out = new Uint8Array(size * size), alpha = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const dark = MAC.shadow * shadow[i], total = body[i] + dark * (1 - body[i]);
    alpha[i] = Math.round(255 * total);
    out[i] = total ? Math.round(shades[i] * body[i] / total) : 0;
  }
  return png(size, out, alpha);
}

const write = (name, icon) => fs.writeFileSync(new URL(`../public/${name}`, import.meta.url), icon);
write('icon.png', flat(180, 0.7));
// A tab shows its icon at 16 pixels, so the shell fills more of the favicon.
write('favicon.png', tab(64, 0.86));
const full = maskable(512);
write('icon-maskable.png', png(512, full));
write('icon-192.png', shaped(192, maskable(192)));
write('icon-512.png', shaped(512, full));
