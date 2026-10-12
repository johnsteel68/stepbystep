import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Original, seamless five-bar relief. No third-party photograph is embedded.
const size = 1024, cells = 4, pitch = size / cells;
const heights = new Float32Array(size * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const cx = Math.floor(x / pitch), cy = Math.floor(y / pitch);
  const angle = (cx + cy) % 2 ? -Math.PI / 4 : Math.PI / 4;
  const dx = x % pitch - pitch / 2, dy = y % pitch - pitch / 2;
  const u = dx * Math.cos(angle) + dy * Math.sin(angle);
  const v = -dx * Math.sin(angle) + dy * Math.cos(angle);
  let height = 0;
  for (let bar = -2; bar <= 2; bar++) {
    // Tapered lenticular ribs, not rectangular studs.
    const r = (u / 82) ** 2 + ((v - bar * 19) / 5.5) ** 2;
    if (r < 1) height = Math.max(height, Math.sqrt(1 - r));
  }
  heights[y * size + x] = height;
}
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(payload));
  return Buffer.concat([head, payload, tail]);
}
const folder = new URL('./public/textures/aluminum-five-bar/', import.meta.url);
mkdirSync(folder, { recursive: true });
function png(name, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgb = pixel(x, y), offset = y * (size * 3 + 1) + 1 + x * 3;
    rgb.forEach((v, i) => { raw[offset + i] = Math.round(Math.max(0, Math.min(255, v))); });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  writeFileSync(new URL(name + '.png', folder), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const h = (x,y) => heights[((y + size) % size) * size + (x + size) % size];
png('height', (x,y) => Array(3).fill(h(x,y) * 255));
png('normal', (x,y) => {
  const nx = (h(x-1,y) - h(x+1,y)) * 3, ny = (h(x,y-1) - h(x,y+1)) * 3;
  const length = Math.hypot(nx,ny,1);
  return [128 + nx / length * 127, 128 + ny / length * 127, 128 + 127 / length];
});
png('color', () => [210,214,218]);
png('roughness', (x,y) => Array(3).fill(145 - h(x,y) * 20));
png('metalness', () => [255,255,255]);
// Swatch conveys the rib pattern; the 3D albedo deliberately has no baked light.
png('preview', (x,y) => { const v = 170 + (h(x-1,y-1) - h(x+1,y+1)) * 120; return [v,v+3,v+6]; });
