import type { HolePosition } from './sheetGeometry.ts';

/** Angle canonique, commun aux boutons, gestes, liens et export : 360° = 0°. */
export function normalizeTextRotation(angle: number): number {
  if (!Number.isFinite(angle)) throw new Error('Angle de texte invalide.');
  return ((angle % 360) + 360) % 360;
}

export function rotateTextPoint(x: number, y: number, angle: number): { x: number; y: number } {
  const rotation = normalizeTextRotation(angle);
  // Les anciens projets à 0/90° gardent leurs coordonnées exactes, sans bruit trigonométrique.
  if (rotation === 0) return { x, y };
  if (rotation === 90) return { x: -y, y: x };
  if (rotation === 180) return { x: -x, y: -y };
  if (rotation === 270) return { x: y, y: -x };
  const radians = rotation * Math.PI / 180;
  return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) };
}

/** Tourner les vraies découpes, pas leurs seules boîtes englobantes. Les trous
 * ronds restent ronds ; une découpe rectangulaire oblique devient un contour.
 * Tous les angles tournent autour du même centre du bloc, sans effet miroir. */
export function rotateStencilCuts(cuts: HolePosition[], angle: number, cx: number, cy: number): HolePosition[] {
  if (normalizeTextRotation(angle) === 0) return cuts;
  return cuts.map(cut => {
    const center = rotateTextPoint(cut.dist - cx, cut.offset - cy, angle);
    if (cut.shape === 'round') return { ...cut, dist: cx + center.x, offset: cy + center.y };
    const points = (cut.contour ?? [
      { x: -(cut.length ?? cut.diam!) / 2, y: -(cut.width ?? cut.diam!) / 2 },
      { x: (cut.length ?? cut.diam!) / 2, y: -(cut.width ?? cut.diam!) / 2 },
      { x: (cut.length ?? cut.diam!) / 2, y: (cut.width ?? cut.diam!) / 2 },
      { x: -(cut.length ?? cut.diam!) / 2, y: (cut.width ?? cut.diam!) / 2 },
    ]).map(point => rotateTextPoint(point.x, point.y, angle));
    const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
    const offsetX = (minX + maxX) / 2, offsetY = (minY + maxY) / 2;
    return { ...cut, shape: 'rect', dist: cx + center.x + offsetX, offset: cy + center.y + offsetY,
      length: maxX - minX, width: maxY - minY, cornerRadius: 0,
      contour: points.map(point => ({ x: point.x - offsetX, y: point.y - offsetY })) };
  });
}
