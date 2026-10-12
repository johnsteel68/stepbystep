import * as THREE from 'three';
import { flatBlankDefinition } from '../../flatBlank.ts';
import { sampleBlank, blankInnerContours } from '../../blankGeometry.ts';
import type { SheetMetalState } from '../../sheetGeometry.ts';

/** Positive Y is always the finishing face; the reverse and cut edges retain
 * their smooth material, including on mirror and tread-plate finishes.
 */
export function createFlatBlankGeometry(state: SheetMetalState, oneSided: boolean) {
  const definition = flatBlankDefinition(state);
  const points = sampleBlank(definition);
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, p.y)));
  shape.holes = blankInnerContours(definition).map(points => new THREE.Path(points.map(p => new THREE.Vector2(p.x, p.y))));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: state.thickness, bevelEnabled: false, steps: 1 });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, state.thickness / 2, 0);
  const normals = geometry.getAttribute('normal');
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  geometry.clearGroups();
  let start = 0, material = -1;
  for (let index = 0; index < normals.count; index += 3) {
    const ny = normals.getY(index);
    const next = oneSided ? (ny > .5 ? 1 : ny < -.5 ? 0 : 2) : 0;
    if (next !== material) {
      if (index > start) geometry.addGroup(start, index - start, material);
      start = index; material = next;
    }
    for (let j = index; j < index + 3; j++) uvs.setXY(j, positions.getX(j), positions.getZ(j));
  }
  geometry.addGroup(start, normals.count - start, material);
  return geometry;
}
