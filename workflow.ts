import type { FeasibilityCheckItem, SheetMetalState } from './sheetGeometry';
import { textAvailabilityIssue } from './stencilText.ts';

export interface WorkflowPage {
  section: number;
  title: string;
  bendIndex?: number;
  legIndex?: number;
  legId?: string;
  width?: boolean;
}

export type WorkflowPageStatus = 'current' | 'complete' | 'problem' | 'upcoming';

/** Associe chaque contrôle atelier à la page où le problème peut être corrigé. */
export function workflowPageStatus(page: WorkflowPage, index: number, current: number, checks: FeasibilityCheckItem[]): WorkflowPageStatus {
  if (index === current - 1) return 'current';
  const hasProblem = checks.some(check => {
    if (check.status === 'pass') return false;
    if (check.id === 'thickness') return page.section === 3;
    if (check.id.startsWith('text_')) return page.section === 12;
    if (check.id.startsWith('min_leg_')) return page.section === 6 && page.legId === check.id.slice('min_leg_'.length);
    if (check.id.startsWith('angle_bend_')) return page.section === 5 && page.bendIndex === Number(check.id.slice('angle_bend_'.length)) - 1;
    if (check.id.startsWith('hole_')) return page.section === 8;
    if (check.id === 'sheet_format') return page.section === 11 || (page.section === 6 && page.width === true);
    if (check.id === 'collision') return page.section === 4;
    if (check.category === 'material') return page.section === 1;
    if (check.category === 'bending') return page.section === 4;
    if (check.category === 'punching') return page.section === 8;
    return page.section === 9;
  });
  if (hasProblem) return 'problem';
  return index < current - 1 ? 'complete' : 'upcoming';
}

/** One ordered source for guided progress, navigation and viewer focus. */
export function createWorkflow(state: SheetMetalState): WorkflowPage[] {
  return [
    { section: 4, title: 'Nombre de plis' },
    ...(state.bendCount === 0 ? [
      { section: 10, title: 'Forme de la plaque' },
      { section: 11, title: 'Paramètres de la forme' },
    ] : []),
    { section: 1, title: 'Matière' },
    { section: 2, title: 'Nuance / finition' },
    { section: 3, title: 'Épaisseur' },
    ...state.bends.slice(0, state.bendCount).map((bend, bendIndex) => ({ section: 5, title: `Angle du pli ${bend.id}`, bendIndex })),
    ...(state.blankShape || state.bendCount === 0 ? [] : state.legs.slice(0, state.bendCount + 1).map((leg, legIndex) => ({ section: 6, title: `Longueur aile ${leg.id}`, legIndex, legId: leg.id }))),
    ...(state.blankShape || state.bendCount === 0 ? [] : [{ section: 6, title: 'Largeur', width: true }]),
    ...(state.blankShape && !['rectangle', 'square', 'frame', 'mounting-plate'].includes(state.blankShape) ? [] : [{ section: 7, title: 'Arrondis des coins' }]),
    ...(!textAvailabilityIssue(state) || state.legs.some(leg => leg.cutText || leg.cutTexts?.length) ? [{ section: 12, title: 'Texte' }] : []),
    { section: 8, title: 'Trous' },
    { section: 9, title: 'Commander' },
  ];
}
