import { getHoleConstraints, getHoleRadii, getPatternPositions, type SheetMetalState, type LegConfig, type HolePosition } from './sheetGeometry.ts';
import { blankHoleAllowed } from './formedBlank.ts';

/** Reject collapsed or overlapping rows instead of silently stacking a series. */
export function holeSeries(leg: LegConfig, state: SheetMetalState): HolePosition[] {
  const holes = explicitHoles({ ...leg, hasHole: true, holePositions: undefined }, state);
  const { rx, rz } = getHoleRadii(leg);
  if (state.blankShape && holes.some(hole => !blankHoleAllowed(state, state.legs.findIndex(item => item.id === leg.id), hole.dist, hole.offset, rx, rz))) return [];
  if (holes.some((hole, index) => holes.slice(index + 1).some(other =>
    Math.abs(hole.dist - other.dist) < 2 * rx && Math.abs(hole.offset - other.offset) < 2 * rz))) return [];
  return holes;
}

export function explicitHoles(leg: LegConfig, state: SheetMetalState): HolePosition[] {
  if (!leg.hasHole) return [];
  const legIndex = state.legs.findIndex(item => item.id === leg.id);
  const hasBendAtStart = legIndex > 0 && legIndex < state.bendCount;
  return getPatternPositions(leg, state.width, leg.holePattern || state.holePattern, state.thickness, state.bendCount > 0, hasBendAtStart).map(position => ({
    ...position, shape: position.shape || leg.holeShape || 'round',
    diam: position.diam ?? leg.holeDiam, length: position.length ?? leg.holeLength ?? 25,
    width: position.width ?? leg.holeWidth ?? 12,
    orientation: position.orientation || leg.holeOrientation || 'along_length',
    cornerRadius: position.cornerRadius ?? leg.holeCornerRadius ?? 0,
  }));
}

export function saveHoles(state: SheetMetalState, legId: string, holes: HolePosition[], editIndex?: number): SheetMetalState {
  const legIndex = state.legs.findIndex(leg => leg.id === legId);
  const target = state.legs[legIndex];
  if (!target || !holes.length) return state;
  // Validate every actual cutout, including individual sizes in a series.
  // Never persist a candidate merely because its centre is inside the sheet.
  if (holes.some(hole => {
    const radii = getHoleRadii({ ...target, holeShape: hole.shape ?? target.holeShape, holeDiam: hole.diam ?? target.holeDiam,
      holeLength: hole.length ?? target.holeLength, holeWidth: hole.width ?? target.holeWidth, holeOrientation: hole.orientation ?? target.holeOrientation });
    if (state.blankShape && !blankHoleAllowed(state, legIndex, hole.dist, hole.offset, radii.rx, radii.rz)) return true;
    const bounds = getHoleConstraints({ ...target,
      holeShape: hole.shape ?? target.holeShape,
      holeDiam: hole.diam ?? target.holeDiam,
      holeLength: hole.length ?? target.holeLength,
      holeWidth: hole.width ?? target.holeWidth,
      holeOrientation: hole.orientation ?? target.holeOrientation,
    }, state.thickness, state.width, state.bendCount > 0, undefined, undefined, undefined,
    state.bendCount > 0, legIndex > 0 && legIndex < state.bendCount);
    return !bounds.isFeasible || !Number.isFinite(hole.dist) || !Number.isFinite(hole.offset)
      || hole.dist < bounds.minDist || hole.dist > bounds.maxDist
      || hole.offset < bounds.minOffset || hole.offset > bounds.maxOffset;
  })) return state;
  return { ...state, legs: state.legs.map(leg => {
    if (leg.id !== legId) return leg;
    const existing = explicitHoles(leg, state);
    const positions = editIndex === undefined ? [...existing, ...holes]
      : existing.map((hole, index) => index === editIndex ? holes[0] : hole);
    return { ...leg, hasHole: positions.length > 0, holePositions: positions,
      holePattern: { mode: 'single' as const, count: 1, margin: 15, rows: 1, columns: 1 } };
  }) };
}

export function clearAllHoles(state: SheetMetalState): SheetMetalState {
  return {
    ...state,
    legs: state.legs.map(leg => ({
      ...leg,
      hasHole: !!leg.holePositions?.some(hole => hole.textCutout),
      holePositions: leg.holePositions?.filter(hole => hole.textCutout).length ? leg.holePositions.filter(hole => hole.textCutout) : undefined,
      holePattern: { mode: 'single', count: 1, margin: 15, rows: 1, columns: 1 },
    })),
  };
}

export type HoleSizeField = 'holeDiam' | 'holeLength' | 'holeWidth';

/** Keep existing holes independent from the defaults used by the next hole. */
export function resizeDraftHole(state: SheetMetalState, legId: string, field: HoleSizeField, value: number): SheetMetalState {
  if (!Number.isFinite(value)) return state;
  return {
    ...state,
    legs: state.legs.map(leg => {
      if (leg.id !== legId) return leg;
      const legIndex = state.legs.findIndex(item => item.id === leg.id);
      const hasBendAtStart = legIndex > 0 && legIndex < state.bendCount;
      const limits = getHoleConstraints(leg, state.thickness, state.width, state.bendCount > 0, undefined, undefined, undefined, state.bendCount > 0, hasBendAtStart);
      const size = Math.max(limits.minDiam, Math.min(limits.maxDiam, Math.round(value)));
      const positions = leg.hasHole
        ? getPatternPositions(leg, state.width, leg.holePattern || state.holePattern, state.thickness, state.bendCount > 0, hasBendAtStart).map(position => ({
            ...position,
            shape: position.shape || leg.holeShape || 'round',
            diam: position.diam ?? leg.holeDiam,
            length: position.length ?? leg.holeLength ?? 25,
            width: position.width ?? leg.holeWidth ?? 12,
            orientation: position.orientation || leg.holeOrientation || 'along_length',
            cornerRadius: position.cornerRadius ?? leg.holeCornerRadius ?? 0,
          }))
        : leg.holePositions;
      return { ...leg, [field]: size, holePositions: positions };
    }),
  };
}
