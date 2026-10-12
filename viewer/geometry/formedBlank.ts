import * as THREE from 'three';
import { blankBeam } from '../../formedBlank.ts';
import { createFlatBlankGeometry } from './flatBlank.ts';
import type { SheetMetalState } from '../../sheetGeometry.ts';

/** Closed strip mesh built in the developed datum. Its UVs never restart at
 * an individual wing, so brushing/tread continues across every bend.
 */
export function createFormedBlankGeometry(state: SheetMetalState, oneSided: boolean, foldFraction = 1) {
  const beam = blankBeam(state, foldFraction);
  // Concave outlines and the washer opening need a real triangulated contour,
  // not a min/max strip (which would fill the star valleys and central opening).
  if (state.bendCount === 0) {
    const geometry = createFlatBlankGeometry(state, oneSided);
    geometry.rotateY((state.blankOrientation || 0) * Math.PI / 180);
    geometry.translate(-beam.frame.u.min, 0, -beam.frame.v.min);
    return geometry;
  }
  const stations = [0, beam.frame.length, ...beam.frame.outline.map(p => p.x)];
  for (const band of beam.bands) {
    const count = Math.ceil(band.angle / (Math.PI / 2) * 96);
    for (let i = 0; i <= count; i++) stations.push(band.start + (band.end - band.start) * i / count);
  }
  const sorted = stations.sort((a, b) => a - b).filter((u, i, all) => !i || u - all[i - 1] > 1e-7);
  const vertices: number[] = [], uv: number[] = [], groups: { start: number; count: number; materialIndex: number }[] = [];
  type Vertex = { p: THREE.Vector3; u: number; v: number };
  function triangle(a: Vertex, b: Vertex, c: Vertex, material: number) {
    const ab = b.p.clone().sub(a.p), ac = c.p.clone().sub(a.p);
    if (ab.cross(ac).lengthSq() < 1e-14) return;
    const start = vertices.length / 3;
    for (const vertex of [a, b, c]) {
      vertices.push(vertex.p.x, vertex.p.y, vertex.p.z);
      const original = beam.frame.unproject(vertex.u, vertex.v);
      uv.push(original.x, original.y);
    }
    const previous = groups[groups.length - 1];
    if (previous?.materialIndex === material) previous.count += 3;
    else groups.push({ start, count: 3, materialIndex: material });
  }
  function quad(a: Vertex, b: Vertex, c: Vertex, d: Vertex, material: number) {
    triangle(a, b, c, material); triangle(a, c, d, material);
  }
  const sections = sorted.map(u => {
    const cross = beam.frame.crossSection(u), median = beam.at(u);
    const n = new THREE.Vector3(-Math.sin(median.angle), Math.cos(median.angle), 0);
    function vertex(v: number, side: number): Vertex {
      return { p: new THREE.Vector3(median.x, median.y, v).addScaledVector(n, side * beam.thickness / 2), u, v };
    }
    return [vertex(cross.min, 1), vertex(cross.max, 1), vertex(cross.max, -1), vertex(cross.min, -1)];
  });
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    quad(a[0], a[1], b[1], b[0], oneSided ? 1 : 0);
    quad(a[3], b[3], b[2], a[2], 0);
    quad(a[0], b[0], b[3], a[3], oneSided ? 2 : 0);
    quad(a[1], a[2], b[2], b[1], oneSided ? 2 : 0);
  }
  const first = sections[0], last = sections[sections.length - 1];
  quad(first[0], first[3], first[2], first[1], oneSided ? 2 : 0);
  quad(last[0], last[1], last[2], last[3], oneSided ? 2 : 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeVertexNormals();
  return geometry;
}
