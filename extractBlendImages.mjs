import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Read-only inspection of Blender blocks; no Blender code or nodes are executed.
// zstd handles Blender's concatenated frames, unlike a single-frame decoder.
const results = [];
for (const file of readdirSync('Textures').filter(name => name.endsWith('.blend'))) {
  const raw = readFileSync(resolve('Textures', file));
  const decoded = raw.subarray(0, 7).toString() === 'BLENDER' ? raw : spawnSync('/opt/homebrew/bin/zstd', ['-dc', resolve('Textures', file)], { maxBuffer: 512 * 1024 * 1024 });
  if (!Buffer.isBuffer(decoded) && decoded.status !== 0) throw new Error(`Unable to decompress ${file}`);
  const bytes = Buffer.isBuffer(decoded) ? decoded : decoded.stdout;
  if (bytes.subarray(0, 7).toString() !== 'BLENDER') throw new Error(`Invalid Blender header: ${file}`);
  const modern = bytes.subarray(0,12).toString() === 'BLENDER17-01';
  if (!modern && ![45,95].includes(bytes[7])) throw new Error(`Unsupported header: ${file}`);
  const pointer = bytes[7] === 45 ? 8 : 4;
  const header = modern ? 32 : 16 + pointer;
  const folder = resolve('tmp/blend-images', file.replace('.blend', ''));
  mkdirSync(folder, { recursive: true });
  const images = [], names = [];
  let position = modern ? 17 : 12;
  while (position + header <= bytes.length) {
    const code = bytes.subarray(position, position + 4).toString();
    const length = modern ? Number(bytes.readBigUInt64LE(position + 16)) : bytes.readUInt32LE(position + 4);
    const start = position + header, end = start + length;
    if (end > bytes.length) throw new Error(`Truncated block in ${file}`);
    const data = bytes.subarray(start, end);
    if (code.startsWith('IM')) names.push(...(data.toString('latin1').match(/[\w .\/\\-]+\.(?:png|jpg|jpeg|exr|tif)/gi) || []));
    // Packed files are separate DATA blocks; extract complete JPEG/PNG streams.
    if (code === 'DATA') {
      if (data[0] === 255 && data[1] === 216) {
        const endJpeg = data.lastIndexOf(Buffer.from([255,217]));
        if (endJpeg > 2) {
          const name = `image-${images.length + 1}.jpg`;
          writeFileSync(resolve(folder, name), data.subarray(0, endJpeg + 2));
          images.push({ name });
        }
      }
      const signature = Buffer.from([137,80,78,71,13,10,26,10]);
      const png = data.indexOf(signature);
      if (png >= 0) {
        let cursor = png + 8, complete = false;
        while (cursor + 12 <= data.length) {
          const size = data.readUInt32BE(cursor), type = data.subarray(cursor + 4, cursor + 8).toString();
          if (cursor + size + 12 > data.length) break;
          cursor += size + 12;
          if (type === 'IEND') { complete = true; break; }
        }
        if (complete) {
          const name = `image-${images.length + 1}.png`;
          writeFileSync(resolve(folder, name), data.subarray(png, cursor));
          images.push({ name, width: data.readUInt32BE(png + 16), height: data.readUInt32BE(png + 20) });
        }
      }
    }
    position = end;
    if (code === 'ENDB') break;
  }
  const result = { file, version: modern ? bytes.subarray(13,17).toString() : bytes.subarray(9,12).toString(), names: [...new Set(names)], images };
  results.push(result); console.log(JSON.stringify(result));
}
writeFileSync(resolve('tmp/blend-images/manifest.json'), JSON.stringify(results, null, 2));
