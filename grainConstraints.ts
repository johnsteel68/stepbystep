import { calculateUnfoldedLength, type SheetMetalState } from './sheetGeometry.ts';

/** Stock dimensions are relative to the brush, not the folded bounding box. */
export function getGrainConstraints(state: SheetMetalState, direction: 'length' | 'width') {
  const length = state.blankLength ?? calculateUnfoldedLength(state);
  const width = state.blankWidth ?? state.width;
  const finite = Number.isFinite(length) && Number.isFinite(width) && length > 0 && width > 0;
  const allowed = {
    length: finite && length <= 2980 && width <= 1480,
    width: finite && width <= 2980 && length <= 1480,
  };
  const applicable = state.finish === 'stainless-brushed';
  const valid = !applicable || allowed[direction];
  const alternative = direction === 'length' ? 'width' : 'length';
  return { length, width, allowed, applicable, valid,
    nextDirection: applicable && !valid && allowed[alternative] ? alternative : direction,
    blocked: applicable && !allowed.length && !allowed.width };
}
