import { Vector3 } from 'three';
import type { SheetMetalState } from '../../sheetGeometry.ts';
import type { WingDimensionLayout } from './wingDimensionLayout.ts';

/** The same centered XY datum as FlatPlacementSheet. These are editing
 * dimensions per wing, not a second calculation of the manufacturing blank.
 */
export function flatDimensionLayouts(state: SheetMetalState, length: number, width: number): WingDimensionLayout[] {
  const z = Math.max(1, state.thickness) + .4;
  const offset = Math.max(12, Math.min(60, Math.max(length, width) * .055));
  const dimension = (baseStart: Vector3, baseEnd: Vector3, outward: Vector3, value: number): WingDimensionLayout => ({
    baseStart, baseEnd, start: baseStart.clone().addScaledVector(outward, offset),
    end: baseEnd.clone().addScaledVector(outward, offset), outward, value, normal: new Vector3(0, 0, 1),
  });
  let start = -length / 2;
  const lengths = state.blankShape ? [length] : state.legs.slice(0, state.bendCount + 1).map(leg => leg.length);
  const chain = lengths.map(value => {
    const result = dimension(new Vector3(start, width / 2, z), new Vector3(start + value, width / 2, z), new Vector3(0, 1, 0), value);
    start += value;
    return result;
  });
  return [...chain, dimension(new Vector3(length / 2, -width / 2, z), new Vector3(length / 2, width / 2, z), new Vector3(1, 0, 0), width)];
}
