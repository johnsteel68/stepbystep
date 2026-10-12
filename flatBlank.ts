import { blankEdges, normalizeBlank, pointInBlank } from './blankGeometry.ts';
import type { BlankDefinition, BlankShape } from './blankGeometry.ts';
import type { SheetMetalState } from './sheetGeometry.ts';

/** Shared flat contour datum: X starts at the free left end, Y is sheet width.
 * The existing terminal-wing hole datum runs in the opposite X direction.
 */
export function flatBlankDefinition(state: SheetMetalState): BlankDefinition {
  const fallback = state.cornerRadius || 0;
  const corners = state.cornerRadii;
  return normalizeBlank({ shape: state.blankShape || 'rectangle', length: state.blankLength ?? state.legs[0].length, width: state.blankWidth ?? state.width,
    innerDiameter: state.blankInnerDiameter,
    toothCount: state.blankToothCount, toothHeight: state.blankToothHeight,
    branchCount: state.blankBranchCount, branchHeight: state.blankBranchHeight,
    cornerRadii: [corners?.startLeft ?? fallback, corners?.endLeft ?? fallback, corners?.endRight ?? fallback, corners?.startRight ?? fallback] });
}
export function isShapedBlank(state: SheetMetalState): boolean {
  return !!state.blankShape && state.blankShape !== 'rectangle';
}
export function selectFlatBlankShape(state: SheetMetalState, shape: BlankShape): SheetMetalState {
  if (state.bendCount > 0 && shape !== 'rectangle') throw new Error('Les formes non rectangulaires pliées ne sont pas encore disponibles.');
  const dimensions = normalizeBlank({ shape, length: Math.max(state.legs[0].length, state.width), width: state.width });
  return { ...state, blankShape: shape, width: dimensions.width,
    cornerRadius: 0, cornerRadii: { startLeft: 0, startRight: 0, endLeft: 0, endRight: 0 },
    legs: state.legs.map((leg, index) => index === 0 ? { ...leg, length: dimensions.length } : leg) };
}
export function resizeFlatBlank(state: SheetMetalState, dimension: 'length' | 'width', value: number): SheetMetalState {
  const current = flatBlankDefinition(state);
  const shape = current.shape;
  // Regular polygons are driven by their distance across flats; circles and
  // squares by length. Never let the second input silently distort a shape.
  const next = normalizeBlank({ ...current, [dimension]: value,
    ...((shape === 'hexagon' || shape === 'octagon') && dimension === 'length' ? { width: shape === 'hexagon' ? value * Math.sqrt(3) / 2 : value } : {}),
    ...((shape === 'square' || shape === 'circle') && dimension === 'width' ? { length: value } : {}),
    ...(shape === 'semicircle' && dimension === 'width' ? { length: value * 2 } : {}),
  });
  return { ...state, width: next.width, legs: state.legs.map((leg, index) => index === 0 ? { ...leg, length: next.length } : leg) };
}

/** Use the shared contour to reject
 * hole centres outside the part; intentional cut-outs through free edges stay
 * allowed. Fold-zone validation remains a separate mandatory check.
 */
export function pointInsideFlatBlank(state: SheetMetalState, x: number, y: number): boolean {
  return pointInBlank(flatBlankDefinition(state), x, y);
}
export { blankEdges };
