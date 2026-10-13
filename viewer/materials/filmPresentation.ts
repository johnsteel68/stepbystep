export type FilmStage = 'hidden' | 'selection' | 'removed';

/** Workflow section IDs, not page numbers (flat and bent workflows differ).
 * Family/shape previews and shared projects must show the actual metal. */
export function filmStageForSection(section: number): FilmStage {
  if (section === 2 || section === 3) return 'selection';
  if ([5, 6, 7, 8, 9, 12].includes(section)) return 'removed';
  return 'hidden';
}

/** Smooth removal on validation; earlier/family steps hide it immediately. */
export function nextFilmCoverage(current: number, stage: FilmStage, delta: number, reducedMotion = false): number {
  if (stage === 'selection') return 1;
  if (stage === 'hidden' || reducedMotion) return 0;
  const next = current * Math.exp(-5 * Math.min(Math.max(delta, 0), .05));
  return next < .005 ? 0 : next;
}
