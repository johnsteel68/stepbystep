import { getHoleRadii, type LegConfig, type HolePosition } from '../../sheetGeometry.ts';

export type LabelPoint = { x: number; y: number };
export type Opening = LabelPoint & { rx: number; ry: number };
export function annotationOpenings(leg: LegConfig, holes: HolePosition[]): Opening[] {
  return holes.map(h => {
    const r = getHoleRadii({ ...leg, holeShape: h.shape ?? leg.holeShape, holeDiam: h.diam ?? leg.holeDiam,
      holeLength: h.length ?? leg.holeLength, holeWidth: h.width ?? leg.holeWidth, holeOrientation: h.orientation ?? leg.holeOrientation });
    return { x: h.dist, y: h.offset, rx: r.rx, ry: r.rz };
  });
}
/** Conservative circle/rectangle separation also protects non-round holes
 * and stencil cutouts. Never put a badge across a real opening. */
export function clearsOpenings(point: LabelPoint, radius: number, openings: Opening[], gap = .8) {
  return openings.every(h => {
    const dx = Math.max(0, Math.abs(point.x - h.x) - h.rx);
    const dy = Math.max(0, Math.abs(point.y - h.y) - h.ry);
    return Math.hypot(dx, dy) >= radius + gap;
  });
}
export function wingLabelPoint(length: number, width: number, radius: number, openings: Opening[], fits?: (p: LabelPoint) => boolean): LabelPoint | null {
  const margin = radius + .8;
  if (length < margin * 2 || width < margin * 2) return null;
  const candidates: LabelPoint[] = [{ x: length / 2, y: width / 2 }];
  for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) candidates.push({ x: margin + (length - 2 * margin) * x / 10, y: margin + (width - 2 * margin) * y / 10 });
  candidates.sort((a, b) => Math.hypot(a.x - length / 2, a.y - width / 2) - Math.hypot(b.x - length / 2, b.y - width / 2));
  return candidates.find(p => clearsOpenings(p, radius, openings) && (!fits || fits(p))) ?? null;
}
export function holeLabelPoint(hole: Opening, radius: number, openings: Opening[], length: number, width: number): LabelPoint {
  const dx = hole.rx + radius + 1, dy = hole.ry + radius + 1;
  const candidates = [{ x: hole.x + dx, y: hole.y }, { x: hole.x - dx, y: hole.y },
    { x: hole.x, y: hole.y + dy }, { x: hole.x, y: hole.y - dy },
    { x: hole.x + dx, y: hole.y + dy }, { x: hole.x - dx, y: hole.y + dy },
    { x: hole.x + dx, y: hole.y - dy }, { x: hole.x - dx, y: hole.y - dy }];
  const clear = candidates.filter(p => clearsOpenings(p, radius, openings));
  return clear.find(p => p.x >= radius && p.x <= length - radius && p.y >= radius && p.y <= width - radius)
    ?? clear[0] ?? { x: Math.max(length, ...openings.map(h => h.x + h.rx)) + radius + 1, y: hole.y };
}
