import type { LegTransform, SheetMetalState } from '../../sheetGeometry.ts';

export interface BendMeasurementReference {
  id: string;
  a: [number, number, number];
  b: [number, number, number];
  label: string;
}

/** Exact tangent lines where the curved bend meets each wing, on both faces.
 * These are physical fold boundaries, not the virtual intersection of wings.
 * Radii and signed angles match generateSheetProfile (all values in mm).
 */
export function bendMeasurementReferences(state: SheetMetalState, legs: LegTransform[]): BendMeasurementReference[] {
  const thickness = Math.max(1, state.thickness);
  return state.bends.slice(0, state.bendCount).flatMap((bend, index) => {
    const wing = legs[index];
    if (!wing || !legs[index + 1]) return [];
    const direction = bend.angle < 0 ? -1 : (bend.direction === -1 ? -1 : 1);
    const angle = Math.max(15, Math.min(165, Math.abs(bend.angle))) * Math.PI / 180;
    const centerX = wing.bendStart.x + direction * 1.5 * thickness * wing.normal.x;
    const centerY = wing.bendStart.y + direction * 1.5 * thickness * wing.normal.y;
    const start = Math.atan2(wing.bendStart.y - centerY, wing.bendStart.x - centerX);
    return ['inner', 'outer'].flatMap(face => [0, 1].map(end => {
      const radius = (face === 'inner' ? 1 : 2) * thickness;
      const theta = start + end * direction * angle;
      const x = centerX + radius * Math.cos(theta), y = centerY + radius * Math.sin(theta);
      return {
        id: `bend-${index}-${face}-${end}`,
        a: [x, y, 0] as [number, number, number],
        b: [x, y, state.width] as [number, number, number],
        label: `Pli ${index + 1} · ${face === 'inner' ? 'intérieur' : 'extérieur'} · aile ${legs[index + end].id}`,
      };
    }));
  });
}
