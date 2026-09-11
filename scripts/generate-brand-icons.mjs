import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Deterministic exports of the approved artwork; never redraw the master.
const source = 'assets/brand/sticky-official.png';
await mkdir('public/brand', { recursive: true });
for (const size of [16, 32, 48, 180, 192, 512]) {
  await sharp(source).resize(size, size).png().toFile(`public/brand/sticky-${size}.png`);
}
await sharp(source).resize(1024, 1024).png().toFile('public/brand/sticky-master.png');
await sharp(source).resize(320, 320).extend({ top: 96, bottom: 96, left: 96, right: 96, background: '#050d1a' }).png().toFile('public/brand/sticky-maskable-512.png');
const images = await Promise.all([16, 32, 48].map(size => readFile(`public/brand/sticky-${size}.png`)));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((data, i) => {
  const entry = 6 + i * 16;
  header[entry] = [16, 32, 48][i]; header[entry + 1] = [16, 32, 48][i];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
await writeFile('public/favicon.ico', Buffer.concat([header, ...images]));
const png = await readFile('public/brand/sticky-512.png');
await writeFile('public/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`);
