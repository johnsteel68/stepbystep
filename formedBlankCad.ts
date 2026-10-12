import { drawRoundedRectangle, Plane, makeBox, Sketch } from 'replicad';
import type { Shape3D } from 'replicad';
import type { SheetMetalState } from './sheetGeometry.ts';
import { blankBeam } from './formedBlank.ts';
import { createFlatBlankSolid } from './flatBlankCad.ts';

/** Straight faces retain their exact original arcs. Curved strips use a smooth
 * OCC loft in radial section planes rather than a faceted mesh-derived STEP.
 * All joins share the exact same endpoint sections as the adjacent wings.
 */
export function createFormedBlankSolid(state: SheetMetalState): Shape3D {
  if (state.bendCount === 0) {
    const frame = blankBeam(state).frame;
    return createFlatBlankSolid(state).rotate(state.blankOrientation || 0, [0, 0, 0], [0, 1, 0])
      .translate([-frame.u.min, 0, -frame.v.min]);
  }
  const beam = blankBeam(state);
  const flatState = { ...state, bendCount: 0, blankShape: beam.frame.definition.shape,
    width: beam.frame.definition.width, legs: state.legs.map((leg, index) => index ? leg : { ...leg, length: beam.frame.definition.length }) };
  const flat = createFlatBlankSolid(flatState)
    .rotate(state.blankOrientation || 0, [0, 0, 0], [0, 1, 0])
    .translate([-beam.frame.u.min, 0, -beam.frame.v.min]);
  let result: Shape3D | undefined;
  try {
    for (const wing of beam.wings) {
      const box = makeBox([wing.start, -beam.thickness, -1], [wing.end, beam.thickness, beam.frame.width + 1]);
      let part = flat.intersect(box);
      box.delete();
      part = part.translate([-wing.start, 0, 0]).rotate(wing.angle * 180 / Math.PI, [0, 0, 0], [0, 0, 1])
        .translate([wing.startPoint.x, wing.startPoint.y, 0]);
      if (!result) result = part;
      else { const joined = result.fuse(part); result.delete(); part.delete(); result = joined; }
      const band = beam.bands[wing.index];
      if (!band) continue;
      const count = Math.max(8, Math.ceil(band.angle / (Math.PI / 2) * 24));
      const sketches = Array.from({ length: count + 1 }, (_, i) => {
        const u = band.start + (band.end - band.start) * i / count;
        const median = beam.at(u), cross = beam.frame.crossSection(u);
        const plane = new Plane([median.x, median.y, (cross.min + cross.max) / 2],
          [-Math.sin(median.angle), Math.cos(median.angle), 0], [Math.cos(median.angle), Math.sin(median.angle), 0]);
        const sketch = drawRoundedRectangle(beam.thickness, cross.max - cross.min).sketchOnPlane(plane);
        if (!(sketch instanceof Sketch)) throw new Error('Section de pli invalide.');
        return sketch;
      });
      const bent = sketches[0].loftWith(sketches.slice(1), { ruled: false });
      const joined = result.fuse(bent);
      result.delete(); bent.delete(); result = joined;
      // loftWith consumes its sketches; deleting them again is a WASM double-free.
    }
    if (!result) throw new Error('La pièce ne contient aucun solide.');
    return result;
  } catch (error) { result?.delete(); throw error; }
  finally { flat.delete(); }
}
