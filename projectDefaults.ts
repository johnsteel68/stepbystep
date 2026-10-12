import type { SheetMetalState } from './sheetGeometry';

export const DEFAULT_HOLE_DIAMETER = 5;

/**
 * A fresh object per project: sharing nested default arrays would let editing
 * one part mutate the defaults used by another. Inactive wings are retained
 * so switching from one to four bends never discards their dimensions.
 */
export function createDefaultProject(): SheetMetalState {
  return {
    bendCount: 1,
    legs: [300, 300, 300, 300, 300].map((length, index) => {
      const id = String.fromCharCode(65 + index);
      return { id, label: `Aile ${id}`, length, hasHole: false,
        holeDiam: DEFAULT_HOLE_DIAMETER, holeDist: 25, holeOffset: 25 };
    }),
    bends: [1, -1, 1, -1].map((direction, index) => ({
      id: String(index + 1), angle: 90, direction: direction as 1 | -1,
    })),
    width: 300, thickness: 3, material: 'Steel', finish: 'steel-raw',
    cornerRadius: 0,
    cornerRadii: { startLeft: 0, startRight: 0, endLeft: 0, endRight: 0 },
  };
}
