// Run with `npm test`. Every icon the manifest lists is a PNG of the size it says. The maskable one is opaque, because Chrome
// clips the whole image to the Mac tile, and the others are the Mac icon with its shadow, so their corners are clear.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));

function read(src) {
  const file = fs.readFileSync(new URL(`../public/${src}`, import.meta.url));
  assert.deepEqual([...file.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${src} is a PNG`);
  const data = [];
  for (let at = 8; at < file.length; at += 12 + file.readUInt32BE(at)) {
    if (file.toString('latin1', at + 4, at + 8) === 'IDAT') data.push(file.subarray(at + 8, at + 8 + file.readUInt32BE(at)));
  }
  const pixels = zlib.inflateSync(Buffer.concat(data));
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20), colourType: file[25], pixels };
}

test('every icon the manifest lists is a PNG the size it says', () => {
  for (const { src, sizes } of manifest.icons) {
    const { width, height } = read(src);
    assert.equal(`${width}x${height}`, sizes, src);
  }
});

test('the maskable icon is opaque', () => {
  const maskable = manifest.icons.filter(icon => icon.purpose === 'maskable');
  assert.equal(maskable.length, 1);
  assert.equal(read(maskable[0].src).colourType, 2);
});

test('the other icons have alpha, and their top left pixel is clear', () => {
  for (const { src } of manifest.icons.filter(icon => icon.purpose !== 'maskable')) {
    const { colourType, pixels } = read(src);
    assert.equal(colourType, 6, src);
    assert.equal(pixels[0], 0, `${src} has no filter on its first row`);
    assert.equal(pixels[4], 0, src);
  }
});
