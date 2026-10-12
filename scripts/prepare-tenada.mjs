import opentype from 'opentype.js';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import clipping from 'polygon-clipping';
function contains(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function prepareFont(source, reinforce = false) {
const bytes = readFileSync(source);
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const height = font.charToGlyph('H').getBoundingBox().y2;
const glyphs = {};
for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. ') {
  const glyph = font.charToGlyph(letter), path = glyph.getPath(0, 0, 1 / height * font.unitsPerEm);
  let contours = [], points = [], previous;
  const push = p => { points.push([+p.x.toFixed(6), +p.y.toFixed(6)]); previous = p; };
  for (const c of path.commands) {
    if (c.type === 'M') { if (points.length) contours.push(points); points = []; push(c); }
    else if (c.type === 'L') push(c);
    else if (c.type === 'Q' || c.type === 'C') {
      const p = previous;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, s = 1 - t;
        push(c.type === 'Q' ? { x: s*s*p.x + 2*s*t*c.x1 + t*t*c.x, y: s*s*p.y + 2*s*t*c.y1 + t*t*c.y }
          : { x: s*s*s*p.x + 3*s*s*t*c.x1 + 3*s*t*t*c.x2 + t*t*t*c.x, y: s*s*s*p.y + 3*s*s*t*c.y1 + 3*s*t*t*c.y2 + t*t*t*c.y });
      }
    } else if (c.type === 'Z') { if (points.length) contours.push(points); points = []; }
  }
  if (points.length) contours.push(points);
  contours = contours.map(ps => ps.filter((p, i) => i === 0 || p[0] !== ps[i-1][0] || p[1] !== ps[i-1][1]));
  const outer = contours.filter(ring => !contours.some(other => other !== ring && contains(other, ring[0])));
  const cutouts = [];
  for (const ring of outer) {
    const counters = contours.filter(other => other !== ring && contains(ring, other[0]));
    let polygons = [[ring, ...counters]];
    if (reinforce && 'ABDOPQR04689'.includes(letter)) {
      const minX = Math.min(...ring.map(p => p[0])) - .1, maxX = Math.max(...ring.map(p => p[0])) + .1;
      for (const y of [-.25, -.75]) polygons = clipping.difference(polygons, [[[minX,y-1/48],[maxX,y-1/48],[maxX,y+1/48],[minX,y+1/48],[minX,y-1/48]]]);
    }
    // Open enclosed counters to the retained sheet with a horizontal bridge.
    // At the minimum cap height (24×thickness), this bridge is >= thickness.
    for (const counter of counters) {
      const y = (Math.min(...counter.map(p => p[1])) + Math.max(...counter.map(p => p[1]))) / 2;
      const minX = Math.min(...ring.map(p => p[0])) - .1, maxX = Math.max(...ring.map(p => p[0])) + .1;
      polygons = clipping.difference(polygons, [[[minX,y-1/48],[maxX,y-1/48],[maxX,y+1/48],[minX,y+1/48],[minX,y-1/48]]]);
    }
    for (const polygon of polygons) {
      if (polygon.length !== 1) throw new Error(`Unattached counter in ${letter}`);
      cutouts.push(polygon[0].slice(0,-1));
    }
  }
  glyphs[letter] = { advance: glyph.advanceWidth / height, contours: cutouts };
}
return glyphs;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(prepareFont(process.argv[2] ?? new URL('../FontSources/tenada/Tenada.ttf', import.meta.url), process.argv[3] === 'reinforce')));
}
