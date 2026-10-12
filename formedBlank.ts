import { normalizeBlank, blankProjection, intersectBlankLine, sampleBlank, pointInBlank } from './blankGeometry.ts';
import type { BlankPoint } from './blankGeometry.ts';
import type { SheetMetalState } from './sheetGeometry.ts';
import { flatBlankDefinition } from './flatBlank.ts';

/** Coordinates of the developed blank relative to the common fold normal.
 * Every subsystem uses this same frame; orientation rotates the blank datum,
 * not the camera and not each individual wing's texture independently.
 */
export function blankFrame(state: SheetMetalState) {
  const definition = flatBlankDefinition(state);
  const angle = (state.blankOrientation || 0) * Math.PI / 180;
  const normal = { x: Math.cos(angle), y: Math.sin(angle) };
  const along = { x: -normal.y, y: normal.x };
  const u = blankProjection(definition, normal), v = blankProjection(definition, along);
  const project = (p: BlankPoint) => ({ x: p.x * normal.x + p.y * normal.y - u.min,
    y: p.x * along.x + p.y * along.y - v.min });
  const unproject = (x: number, y: number) => ({ x: (x + u.min) * normal.x + (y + v.min) * along.x,
    y: (x + u.min) * normal.y + (y + v.min) * along.y });
  const crossSection = (x: number) => {
    const hits = intersectBlankLine(definition, normal, x + u.min).map(project);
    if (!hits.length) throw new Error('Section de la forme introuvable.');
    return { min: Math.min(...hits.map(p => p.y)), max: Math.max(...hits.map(p => p.y)) };
  };
  return { definition, normal, along, angle, u, v, length: u.max - u.min, width: v.max - v.min,
    project, unproject, crossSection, outline: sampleBlank(definition).map(project) };
}
export function blankBendPlan(state: SheetMetalState) {
  if (state.blankShape && state.bendCount > 0) throw new Error('Les formes sont réservées aux plaques sans pli.');
  const frame = blankFrame(state);
  const thickness = Math.max(1, state.thickness), radius = thickness * 1.5;
  const count = state.bendCount;
  if (!Number.isInteger(count) || count < 0 || count > 4) throw new Error('Nombre de plis invalide.');
  if (state.blankBendPositions && state.blankBendPositions.length !== count) throw new Error('Positions des plis invalides.');
  const positions = state.blankBendPositions || Array.from({ length: count }, (_, i) => frame.length * (i + 1) / (count + 1));
  const bands = positions.map((position, index) => {
    const bend = state.bends[index];
    const angle = Math.abs(bend.angle) * Math.PI / 180;
    if (!Number.isFinite(position) || !Number.isFinite(angle) || angle < Math.PI / 12 || angle > 165 * Math.PI / 180) throw new Error('Pli invalide.');
    const half = radius * angle / 2;
    const direction = bend.angle < 0 || bend.direction === -1 ? -1 : 1;
    return { index, position, angle, direction, start: position - half, end: position + half, half };
  });
  const wings = Array.from({ length: count + 1 }, (_, index) => {
    const start = index ? bands[index - 1].end : 0;
    const end = index < count ? bands[index].start : frame.length;
    if (end - start < (count ? Math.max(8, 3.5 * thickness) : .01)) throw new Error('Plis trop proches : agrandissez la forme ou espacez les plis.');
    return { index, start, end, length: end - start };
  });
  for (const band of bands) {
    for (const position of [band.start, band.position, band.end]) {
      const section = frame.crossSection(position);
      if (section.max - section.min < Math.max(8, 3.5 * thickness)) throw new Error('Ce pli est trop proche de la pointe de la forme.');
    }
  }
  return { frame, bands, wings, thickness, radius };
}

/** Adapt the old per-wing controls and hole datums to the new developed blank.
 * Exterior lengths include setbacks; hole distances remain on straight faces.
 */
export function normalizeFormedBlank(state: SheetMetalState): SheetMetalState {
  if (!state.blankShape) return state;
  // Switching back to a bent piece restores the established rectangular engine.
  // Keep dimensions/holes; never retain a hidden non-rectangular folded blank.
  if (state.bendCount > 0) return { ...state, blankShape: undefined, blankLength: undefined,
blankWidth: undefined, blankInnerDiameter: undefined, blankToothCount: undefined, blankToothHeight: undefined, blankBranchCount: undefined, blankBranchHeight: undefined, blankOrientation: undefined, blankBendPositions: undefined };
  const plan = blankBendPlan(state);
  const setbacks = plan.bands.map(band => 2 * plan.thickness * Math.tan(band.angle / 2));
  return { ...state, blankLength: plan.frame.definition.length, blankWidth: plan.frame.definition.width,
    width: plan.frame.width, blankInnerDiameter: plan.frame.definition.innerDiameter, blankToothCount: plan.frame.definition.toothCount, blankToothHeight: plan.frame.definition.toothHeight, blankBranchCount: plan.frame.definition.branchCount, blankBranchHeight: plan.frame.definition.branchHeight, blankBendPositions: plan.bands.map(band => band.position),
    legs: state.legs.map((leg, index) => index < plan.wings.length ? {
      ...leg, length: plan.wings[index].length + (setbacks[index - 1] || 0) + (setbacks[index] || 0),
    } : leg) };
}

/** Formed median line, using the same neutral radius as the developed bands. */
export function blankBeam(state: SheetMetalState, foldFraction = 1) {
  const plan = blankBendPlan(state);
  const fraction = Math.max(0, Math.min(1, foldFraction));
  const animatedRadius = fraction > 1e-8 ? plan.radius / fraction : 0;
  let point = { x: 0, y: 0 }, angle = 0;
  const wings = plan.wings.map((wing, index) => {
    const start = { ...point }, theta = angle;
    const end = { x: start.x + wing.length * Math.cos(theta), y: start.y + wing.length * Math.sin(theta) };
    const band = plan.bands[index];
    let center: BlankPoint | undefined;
    if (band) {
      center = { x: end.x - band.direction * animatedRadius * Math.sin(theta), y: end.y + band.direction * animatedRadius * Math.cos(theta) };
      angle += band.direction * band.angle * fraction;
      point = fraction > 1e-8 ? { x: center.x + band.direction * animatedRadius * Math.sin(angle), y: center.y - band.direction * animatedRadius * Math.cos(angle) }
        : { x: end.x + band.end - band.start, y: end.y };
    }
    return { ...wing, startPoint: start, endPoint: end, angle: theta, center };
  });
  function at(u: number) {
    const bandIndex = plan.bands.findIndex(band => u > band.start + 1e-8 && u < band.end - 1e-8);
    if (bandIndex >= 0) {
      const band = plan.bands[bandIndex], wing = wings[bandIndex], center = wing.center!;
      if (fraction <= 1e-8) return { x: wing.endPoint.x + u - band.start, y: wing.endPoint.y, angle: 0 };
      const theta = wing.angle + band.direction * (u - band.start) / animatedRadius;
      return { x: center.x + band.direction * animatedRadius * Math.sin(theta),
        y: center.y - band.direction * animatedRadius * Math.cos(theta), angle: theta };
    }
    const wing = wings.find(item => u <= item.end + 1e-7) || wings[wings.length - 1];
    return { x: wing.startPoint.x + (u - wing.start) * Math.cos(wing.angle),
      y: wing.startPoint.y + (u - wing.start) * Math.sin(wing.angle), angle: wing.angle };
  }
  return { ...plan, wings, at };
}

export function blankHoleCenter(state: SheetMetalState, legIndex: number, dist: number, offset: number) {
  const wing = blankBendPlan(state).wings[legIndex];
  return { x: legIndex === state.bendCount ? wing.end - dist : wing.start + dist, y: offset };
}
export function blankHoleAllowed(state: SheetMetalState, legIndex: number, dist: number, offset: number, rx: number, rz: number) {
  const plan = blankBendPlan(state), center = blankHoleCenter(state, legIndex, dist, offset);
  if (![center.x, center.y, rx, rz].every(Number.isFinite)) return false;
  const original = plan.frame.unproject(center.x, center.y);
  if (!pointInBlank(plan.frame.definition, original.x, original.y)) return false;
  // Protect the actual developed band AND the workshop's larger safety zone.
  return plan.bands.every(band => Math.abs(center.x - band.position) > Math.max(band.half, 3.5 * plan.thickness, 4) + rx + 1e-6);
}

/** Unlike a hole, a text block may never cross the outside contour. Test
 * its complete padded envelope against the developed outline, including
 * concave notches; checking only its centre or four corners is insufficient. */
export function blankTextBlockAllowed(state: SheetMetalState, legIndex: number, dist: number, offset: number, rx: number, rz: number): boolean {
  if (!blankHoleAllowed(state, legIndex, dist, offset, rx, rz)) return false;
  const frame = blankFrame(state), center = blankHoleCenter(state, legIndex, dist, offset);
  const left = center.x - rx, right = center.x + rx, bottom = center.y - rz, top = center.y + rz;
  if (![left, right, bottom, top].every(Number.isFinite) || rx <= 0 || rz <= 0) return false;
  for (const p of [{ x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top }]) {
    const original = frame.unproject(p.x, p.y);
    if (!pointInBlank(frame.definition, original.x, original.y)) return false;
  }
  // Slab intersection: reject any outline segment entering the open box.
  // The sampled outline is deliberately conservative around curved edges.
  const outline = frame.outline;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    let low = 0, high = 1;
    for (const [origin, delta, min, max] of [[a.x, b.x - a.x, left, right], [a.y, b.y - a.y, bottom, top]]) {
      if (Math.abs(delta) < 1e-9) { if (origin <= min || origin >= max) { high = -1; break; } }
      else { const first = (min - origin) / delta, last = (max - origin) / delta;
        low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last)); }
    }
    if (high > low + 1e-9) return false;
  }
  // Integral centre openings (washer/gear) are not ordinary user holes.
  if (frame.definition.innerDiameter) {
    const hole = frame.project({ x: frame.definition.length / 2, y: frame.definition.width / 2 });
    const dx = Math.max(left - hole.x, 0, hole.x - right), dy = Math.max(bottom - hole.y, 0, hole.y - top);
    if (Math.hypot(dx, dy) <= frame.definition.innerDiameter / 2) return false;
  }
  return true;
}
