import type { SheetMetalState, HolePosition } from './sheetGeometry.ts';

/** The frame opening belongs to the template, not to the next selected shape.
 * Keep additional user holes and leave states without an opening untouched.
 */
export function removeFrameOpening(state: SheetMetalState): SheetMetalState {
  if (!['frame', 'mounting-plate'].includes(state.blankShape || '')) return state;
  const leg = state.legs[0];
  if (!leg.hasHole || !leg.holePositions?.length) return state;
  const positions = leg.holePositions;
  const tagged = positions.some(hole => hole.templateOrigin);
  // Compatibility with projects saved before template ownership was recorded.
  let legacyCount = state.blankShape === 'frame' && positions[0]?.shape === 'rect' ? 1 : 0;
  if (!tagged && state.blankShape === 'mounting-plate' && positions.length >= 4) {
    const [a, b, c, d] = positions;
    const round = positions.slice(0, 4).every(hole => hole.shape === 'round' && !hole.textCutout);
    if (round && a.dist === b.dist && c.dist === d.dist && a.offset === c.offset && b.offset === d.offset && a.dist !== c.dist && a.offset !== b.offset) {
      legacyCount = 4;
      const center = positions[4];
      if (center?.shape === 'round' && !center.textCutout && Math.abs(center.dist - (a.dist + c.dist) / 2) < .01 && Math.abs(center.offset - (a.offset + b.offset) / 2) < .01) legacyCount = 5;
    }
  }
  const holes = tagged ? positions.filter(hole => hole.templateOrigin !== state.blankShape) : positions.slice(legacyCount);
  return { ...state, legs: state.legs.map((item, index) => index ? item : {
    ...item, hasHole: holes.length > 0, holePositions: holes, holePattern: undefined,
  }) };
}

/** Templates use ordinary editable holes, not a second hidden cutting engine.
 * Viewer, STEP, PDF and shared projects consequently retain identical cutouts.
 * For the only (terminal) wing, dist is measured from the right-hand end.
 */
export function templateSettings(state: SheetMetalState) {
  const l = state.blankLength ?? state.legs[0].length, w = state.blankWidth ?? state.width;
  const holes = state.legs[0].hasHole ? state.legs[0].holePositions || [] : [];
  return { length: l, width: w,
    border: holes[0]?.shape === 'rect' ? (l - (holes[0].length || 0)) / 2 : Math.min(10, l / 5, w / 5),
    diameter: holes[0]?.diam || 5, margin: holes[0]?.dist || Math.min(10, l / 4, w / 4),
    centralDiameter: holes[4]?.diam || 0 };
}

export function configureBlankTemplate(state: SheetMetalState, settings: Partial<ReturnType<typeof templateSettings>> = {}): SheetMetalState {
  if (!['frame', 'mounting-plate'].includes(state.blankShape || '') || state.bendCount !== 0) return state;
  const s = { ...templateSettings(state), ...settings };
  if (![s.length, s.width, s.border, s.diameter, s.margin, s.centralDiameter].every(Number.isFinite)) throw new Error('Dimensions du gabarit invalides.');
  let holes: HolePosition[];
  if (state.blankShape === 'frame') {
    if (s.border < 2 || Math.min(s.length, s.width) - 2 * s.border < 1) throw new Error('Le cadre doit conserver au moins 2 mm de bord et une ouverture positive.');
    holes = [{ dist: s.length / 2, offset: s.width / 2, shape: 'rect', length: s.length - 2 * s.border, width: s.width - 2 * s.border, diam: 5, cornerRadius: 0 }];
  } else {
    if (s.diameter < 1 || s.margin < s.diameter / 2 + 2 ||
      Math.min(s.length, s.width) - 2 * s.margin < s.diameter + 2 || s.centralDiameter < 0)
      throw new Error('Les trous doivent laisser 2 mm de matière entre eux et avec les bords.');
    if (s.centralDiameter > 0 && (s.centralDiameter < 1 || s.centralDiameter > Math.min(s.length, s.width) - 4 ||
      Math.hypot(s.length / 2 - s.margin, s.width / 2 - s.margin) < (s.centralDiameter + s.diameter) / 2 + 2))
      throw new Error('Le trou central est trop proche des trous de fixation ou des bords.');
    holes = [s.margin, s.length - s.margin].flatMap(dist => [s.margin, s.width - s.margin].map(offset =>
      ({ dist, offset, shape: 'round' as const, diam: s.diameter })));
    if (s.centralDiameter) holes.push({ dist: s.length / 2, offset: s.width / 2, shape: 'round', diam: s.centralDiameter });
  }
  holes = holes.map(hole => ({ ...hole, templateOrigin: state.blankShape as 'frame' | 'mounting-plate' }));
  return { ...state, blankLength: s.length, blankWidth: s.width, width: s.width,
    legs: state.legs.map((leg, index) => index ? leg : { ...leg, length: s.length, hasHole: true, holePositions: holes, holePattern: undefined }) };
}
