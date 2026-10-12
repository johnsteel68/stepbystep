import { draw, Plane, isShape3D, makeCylinder } from 'replicad';
import { blankEdges, flatBlankDefinition } from './flatBlank.ts';
import type { SheetMetalState } from './sheetGeometry.ts';

/** Analytical OCC sketch, never the sampled display polygon. Circular and
 * elliptical boundaries therefore remain arcs in the STEP file.
 */
export function createFlatBlankSolid(state: SheetMetalState) {
  if (state.bendCount !== 0) throw new Error('Un contour plié nécessite le nouveau moteur de pliage.');
  const definition = flatBlankDefinition(state);
  const edges = blankEdges(definition);
  const point = (edge: typeof edges[number], t: number): [number, number] => edge.type === 'line'
    ? [edge.from.x + (edge.to.x - edge.from.x) * t, edge.from.y + (edge.to.y - edge.from.y) * t]
    : [edge.center.x + edge.rx * Math.cos(edge.start + edge.sweep * t), edge.center.y + edge.ry * Math.sin(edge.start + edge.sweep * t)];
  let path = draw(point(edges[0], 0));
  for (const edge of edges) {
    if (edge.type === 'line') path = path.lineTo(point(edge, 1));
    else {
      // At most a quarter ellipse per edge avoids an ambiguous identical
      // start/end point and does not rely on SVG large-arc conventions.
      const count = Math.ceil(edge.sweep / (Math.PI / 2));
      for (let i = 1; i <= count; i++) {
        if (Math.abs(edge.rx - edge.ry) < 1e-7) {
          path = path.threePointsArcTo(point(edge, i / count), point(edge, (i - .5) / count));
        } else path = path.ellipseTo(point(edge, i / count), edge.rx, edge.ry, 0, false, true);
      }
    }
  }
  const plane = new Plane([0, state.thickness / 2, 0], [1, 0, 0], [0, -1, 0]);
  const solid = path.close().sketchOnPlane(plane).extrude(state.thickness);
  if (!isShape3D(solid)) { solid.delete(); throw new Error('Le contour ne produit pas un solide 3D.'); }
  if (!['washer', 'gear'].includes(definition.shape) || !definition.innerDiameter) return solid;
  const cutter = makeCylinder(definition.innerDiameter! / 2, state.thickness * 3,
    [definition.length / 2, state.thickness, definition.width / 2], [0, -1, 0]);
  try { return solid.cut(cutter); } finally { solid.delete(); cutter.delete(); }
}
