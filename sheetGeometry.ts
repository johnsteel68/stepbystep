import * as THREE from 'three';
import type { BlankShape } from './blankGeometry.ts';
import { blankArea } from './blankGeometry.ts';
import { blankFrame, blankHoleAllowed } from './formedBlank.ts';
import { stencilTextIssue } from './stencilText.ts';

export type MaterialType = 'Steel' | 'Stainless' | 'Aluminum';
export type SheetFinish = 'steel-raw' | 'steel-galvanized' | 'steel-larme' | 'steel-corten' | 'aluminum-raw' | 'aluminum-filmed' | 'aluminum-antitrace' | 'aluminum-anodized' | 'aluminum-perforated' | 'aluminum-larme' | 'stainless-brushed' | 'stainless-raw' | 'stainless-bright' | 'stainless-mirror' | 'stainless-antislip' | 'stainless-marine' | 'stainless-marine-raw' | 'stainless-leather' | 'stainless-magnetic';

export type HoleShape = 'round' | 'oblong' | 'square' | 'rect' | 'octagonal';
export type HolePattern = 'single' | 'corners' | 'line' | 'square';
export const MAX_HOLE_PATTERN_COLUMNS = 20;

/** Polygon resolution for bent sheet arcs: 96 segments per 90° keeps the silhouette smooth. */
export function getBendArcSegments(angleRadians: number): number {
  const angle = Number.isFinite(angleRadians) ? Math.min(Math.PI, Math.abs(angleRadians)) : 0;
  return Math.max(24, Math.min(192, Math.ceil(96 * angle / (Math.PI / 2))));
}

export interface HolePatternConfig {
  mode: HolePattern;
  count: number;
  margin: number;
  rows: number;
  columns: number;
}

export interface HolePosition {
  /** Centred vector outline for font cutouts, in millimetres. */
  contour?: { x: number; y: number }[];
  textCutout?: boolean;
  /** Identifie le bloc texte auquel appartient cette découpe. */
  textBlockId?: string;
  templateOrigin?: 'frame' | 'mounting-plate';
  dist: number;
  offset: number;
  /** Forme/dimensions propres à ce trou (les anciens projets utilisent les valeurs de l'aile). */
  shape?: HoleShape;
  diam?: number;
  length?: number;
  width?: number;
  orientation?: 'along_length' | 'along_width';
  cornerRadius?: number;
}

export interface LegConfig {
  holeContour?: { x: number; y: number }[];
  /** Tous les textes découpés de l'aile. cutText reste pour les anciens liens. */
  cutTexts?: import('./stencilText').StencilText[];
  cutText?: import('./stencilText').StencilText;
  id: string; // 'A' | 'B' | 'C' | 'D'
  label: string;
  length: number; // mm (côte extérieure)
  hasHole: boolean;
  holeShape?: HoleShape; // 'round' | 'oblong' | 'square' | 'rect' | 'octagonal'
  holeDiam: number; // mm (diamètre pour rond/octogonal ou côté pour carré)
  holeLength?: number; // mm pour oblong/rectangle (dimension longitudinale X)
  holeWidth?: number; // mm pour oblong/rectangle (dimension transversale Z)
  holeOrientation?: 'along_length' | 'along_width'; // pour oblong
  holeCornerRadius?: number; // mm pour carré/rectangle
  /** Répartition indépendante des perçages pour cette aile. */
  holePattern?: HolePatternConfig;
  /** Positions explicites lorsqu'un seul trou d'un motif est déplacé à la main. */
  holePositions?: HolePosition[];
  holeDist: number; // mm from outer tip along leg (center)
  holeOffset: number; // mm across width (Z) (center)
}

export interface BendConfig {
  id: string; // '1' | '2' | '3'
  angle: number; // standard 90°
  direction: 1 | -1; // +1 = up/interior (+90°), -1 = down/exterior (-90°)
}

export interface FlatCornerRadii {
  startLeft: number;
  startRight: number;
  endLeft: number;
  endRight: number;
}

export interface SheetMetalState {
  /** Developed contour; absent in older shared projects means rectangle. */
  blankShape?: BlankShape;
  /** Physical blank dimensions and fold-line normal, before rotating its datum. */
  blankLength?: number;
  blankWidth?: number;
  blankInnerDiameter?: number;
  blankToothCount?: number;
  blankToothHeight?: number;
  blankBranchCount?: number;
  blankBranchHeight?: number;
  blankOrientation?: number;
  blankBendPositions?: number[];
  bendCount: number; // 0 (flat sheet), 1, 2, 3, or 4
  legs: LegConfig[];
  bends: BendConfig[];
  width: number; // mm
  thickness: number; // mm
  material: MaterialType;
  finish?: SheetFinish;
  /** Rayon appliqué aux angles du profil 2D, en mm. 0 = angle vif. */
  cornerRadius?: number;
  /** Rayons indépendants des quatre coins du développé à plat. */
  cornerRadii?: FlatCornerRadii;
  holePattern?: HolePatternConfig;
}

export function getPatternPositions(leg: LegConfig, width: number, pattern?: HolePatternConfig, thickness = 3, hasAdjacentBend = true, hasBendAtStart = false) {
  const bounds = getHoleConstraints(leg, thickness, width, hasAdjacentBend, undefined, undefined, undefined, hasAdjacentBend, hasBendAtStart);
  if (!bounds.isFeasible) return [];

  const clampPosition = (position: HolePosition): HolePosition => {
    const positionLeg = {
      ...leg,
      holeShape: position.shape || leg.holeShape,
      holeDiam: position.diam ?? leg.holeDiam,
      holeLength: position.length ?? leg.holeLength,
      holeWidth: position.width ?? leg.holeWidth,
      holeOrientation: position.orientation || leg.holeOrientation,
      holeCornerRadius: position.cornerRadius ?? leg.holeCornerRadius,
    };
    return { ...position, ...constrainHolePosition(positionLeg, width, thickness, position.dist, position.offset, hasAdjacentBend, hasBendAtStart) };
  };
  if (leg.holePositions?.length) return leg.holePositions.map(clampPosition);
  const config = pattern || { mode: 'single' as HolePattern, count: 1, margin: 15, rows: 2, columns: 2 };
  const margin = Math.max(0, config.margin);
  if (config.mode === 'single') return [clampPosition({ dist: leg.holeDist, offset: leg.holeOffset })];
  if (config.mode === 'corners') {
    const startDist = Math.max(bounds.minDist, margin);
    const endDist = Math.min(bounds.maxDist, leg.length - margin);
    const nearOffset = Math.max(bounds.minOffset, margin);
    const farOffset = Math.min(bounds.maxOffset, width - margin);
    // Leave a small web between cuts; never clamp a tight pattern into overlap.
    if (endDist - startDist < 2 * bounds.rx + 2 || farOffset - nearOffset < 2 * bounds.rz + 2) return [];
    return [
      { dist: startDist, offset: nearOffset },
      { dist: endDist, offset: nearOffset },
      { dist: startDist, offset: farOffset },
      { dist: endDist, offset: farOffset },
    ];
  }
  if (config.mode === 'line') {
    const count = Math.max(2, Math.min(20, Math.round(config.count)));
    const startDist = Math.max(bounds.minDist, margin);
    const endDist = Math.min(bounds.maxDist, leg.length - margin);
    if (endDist - startDist < (count - 1) * (2 * bounds.rx + 2)) return [];
    return Array.from({ length: count }, (_, i) => ({
      dist: startDist + (endDist - startDist) * i / (count - 1),
      offset: leg.holeOffset,
    }));
  }
  const rows = Math.max(1, Math.min(10, Math.round(config.rows)));
  const columns = Math.max(1, Math.min(MAX_HOLE_PATTERN_COLUMNS, Math.round(config.columns)));
  const startDist = Math.max(bounds.minDist, margin);
  const endDist = Math.min(bounds.maxDist, leg.length - margin);
  const startOffset = Math.max(bounds.minOffset, margin);
  const endOffset = Math.min(bounds.maxOffset, width - margin);
  if (columns > 1 && endDist - startDist < (columns - 1) * (2 * bounds.rx + 2)) return [];
  if (rows > 1 && endOffset - startOffset < (rows - 1) * (2 * bounds.rz + 2)) return [];
  return Array.from({ length: rows * columns }, (_, i) => {
    const row = Math.floor(i / columns);
    const col = i % columns;
    return clampPosition({
      dist: columns === 1 ? (bounds.minDist + bounds.maxDist) / 2 : startDist + (endDist - startDist) * col / (columns - 1),
      offset: rows === 1 ? (bounds.minOffset + bounds.maxOffset) / 2 : startOffset + (endOffset - startOffset) * row / (rows - 1),
    });
  });
}

/** Resolve the same hole instances for the manufacturing drawing as the viewer. */
export function getLegPatternPositions(state: SheetMetalState, legIndex: number, leg = state.legs[legIndex]) {
  return getPatternPositions(leg, state.width, leg.holePattern || state.holePattern, state.thickness,
    state.bendCount > 0, state.bendCount > 1 && legIndex > 0 && legIndex < state.bendCount);
}

export function getFlatCornerRadii(state: SheetMetalState): FlatCornerRadii {
  if (state.blankShape && !['rectangle', 'square', 'frame', 'mounting-plate'].includes(state.blankShape)) return { startLeft: 0, startRight: 0, endLeft: 0, endRight: 0 };
  const commonMax = getMaxFlatCornerRadius(state);
  const fallback = Math.max(0, Math.min(commonMax, state.cornerRadius || 0));
  const radii = state.cornerRadii;
  const clamp = (value: number | undefined, key: keyof FlatCornerRadii) =>
    Math.max(0, Math.min(getMaxFlatCornerRadius(state, key), value ?? fallback));
  return {
    startLeft: clamp(radii?.startLeft, 'startLeft'),
    startRight: clamp(radii?.startRight, 'startRight'),
    endLeft: clamp(radii?.endLeft, 'endLeft'),
    endRight: clamp(radii?.endRight, 'endRight'),
  };
}

/** Limite géométrique : deux arrondis voisins doivent tenir dans la largeur
 * de la tôle et dans la longueur de leur aile terminale. */
export function getMaxFlatCornerRadius(state: SheetMetalState, corner?: keyof FlatCornerRadii): number {
  if (state.blankShape) { const frame = blankFrame(state); return Math.min(frame.definition.length, frame.definition.width) / 2; }
  const maxForWing = (legIndex: number) => {
    const length = Math.max(0, state.legs[legIndex]?.length ?? 0);
    return Math.max(0, Math.min(state.width, length) / 2);
  };
  if (corner) return maxForWing(corner.startsWith('start') ? 0 : state.bendCount);
  return Math.min(maxForWing(0), maxForWing(state.bendCount));
}

export const MATERIAL_CONFIG: Record<MaterialType, { name: string; color: string; roughness: number; metalness: number; density: number }> = {
  Steel: { name: 'Acier (S235)', color: '#8d929a', roughness: 0.45, metalness: 0.85, density: 7.85 },
  Stainless: { name: 'Inox (304L)', color: '#c5c9ce', roughness: 0.25, metalness: 0.95, density: 8.0 },
  Aluminum: { name: 'Alu (5754)', color: '#d8dee4', roughness: 0.35, metalness: 0.7, density: 2.7 },
};

export const SHEET_FINISHES: Record<SheetFinish, { family: MaterialType; name: string; reference: string; thicknesses: readonly number[] }> = {
  'steel-raw': { family: 'Steel', name: 'Brut', reference: 'S355MC', thicknesses: [2, 3, 4, 5, 6, 8, 10, 15, 20] },
  'steel-galvanized': { family: 'Steel', name: 'Galvanisé', reference: 'S235JR', thicknesses: [1, 1.5, 2, 3] },
  'steel-larme': { family: 'Steel', name: 'Larmé', reference: 'S235JR', thicknesses: [5] },
  'steel-corten': { family: 'Steel', name: 'Corten', reference: 'S355J0WP', thicknesses: [1.5] },
  'aluminum-raw': { family: 'Aluminum', name: 'Brut', reference: '5754H111', thicknesses: [4, 5, 6, 8, 10] },
  'aluminum-filmed': { family: 'Aluminum', name: 'Brut filmé', reference: '5754H111', thicknesses: [1, 1.5, 2, 3] },
  'aluminum-antitrace': { family: 'Aluminum', name: 'Anti-traces', reference: '5005H14', thicknesses: [1.5] },
  'aluminum-anodized': { family: 'Aluminum', name: 'Anodisé', reference: '5005H14', thicknesses: [1.5, 2] },
  'aluminum-perforated': { family: 'Aluminum', name: 'Perforé', reference: '1050A', thicknesses: [1.5] },
  'aluminum-larme': { family: 'Aluminum', name: 'Larmé', reference: '5754H111', thicknesses: [4] },
  'stainless-brushed': { family: 'Stainless', name: 'Brossé', reference: '304L', thicknesses: [1, 1.5, 2, 3, 4] },
  'stainless-raw': { family: 'Stainless', name: 'Brut', reference: '304L', thicknesses: [4, 5, 6, 8, 10] },
  'stainless-bright': { family: 'Stainless', name: 'Brut et brillant', reference: '304L', thicknesses: [1, 1.5, 2, 2.5] },
  'stainless-mirror': { family: 'Stainless', name: 'Miroir', reference: '304', thicknesses: [1.5] },
  'stainless-antislip': { family: 'Stainless', name: 'Anti-dérapant', reference: '304L', thicknesses: [4] },
  'stainless-marine': { family: 'Stainless', name: 'Marin', reference: '316L', thicknesses: [2] },
  'stainless-marine-raw': { family: 'Stainless', name: 'Marin brut', reference: '316L', thicknesses: [4, 5] },
  'stainless-leather': { family: 'Stainless', name: 'Cuir', reference: '304', thicknesses: [1] },
  'stainless-magnetic': { family: 'Stainless', name: 'Magnétique', reference: '430', thicknesses: [1] },
};

export const DEFAULT_FINISH: Record<MaterialType, SheetFinish> = { Steel: 'steel-raw', Aluminum: 'aluminum-raw', Stainless: 'stainless-brushed' };
/** Workshop limits apply to bending only; thicker sheets remain available flat. */
export const MAX_BENDING_THICKNESS = 6;
export function getBendingRestriction(finish: SheetFinish, thickness: number): string | null {
  if (['stainless-mirror', 'aluminum-anodized', 'aluminum-antitrace', 'aluminum-perforated'].includes(finish)) {
    return `${SHEET_FINISHES[finish].name} : cette finition est disponible uniquement sans pli.`;
  }
  return thickness > MAX_BENDING_THICKNESS
    ? 'Le pliage est disponible jusqu’à 6 mm. Choisissez une épaisseur inférieure ou une pièce sans pli.'
    : null;
}

export function getAvailableSheetThicknesses(finish?: SheetFinish, bendCount = 0): readonly number[] {
  const selected = finish || DEFAULT_FINISH.Steel;
  const available = SHEET_FINISHES[selected]?.thicknesses || SHEET_FINISHES['steel-raw'].thicknesses;
  return bendCount > 0 ? available.filter(thickness => !getBendingRestriction(selected, thickness)) : available;
}

/** The same catalogue filter drives family, finish and thickness choices. */
export function getAvailableSheetFinishes(material: MaterialType, bendCount = 0): SheetFinish[] {
  return (Object.keys(SHEET_FINISHES) as SheetFinish[]).filter(finish =>
    SHEET_FINISHES[finish].family === material && getAvailableSheetThicknesses(finish, bendCount).length > 0);
}

export function normalizeBendingSelection(state: SheetMetalState, bendCount: number): SheetMetalState {
  const options = getAvailableSheetFinishes(state.material, bendCount);
  const selected = state.finish || DEFAULT_FINISH[state.material];
  const finish = options.includes(selected) ? selected : options[0];
  return { ...state, bendCount, finish, thickness: normalizeSheetThickness(state.thickness, finish, bendCount) };
}

// Standard Sheet formats in mm
export const SHEET_WIDTH = 1480;
export const SHEET_LENGTH = 2980;
/** The developed blank must fit the stock sheet, allowing a quarter turn. */
export function fitsSheetFormat(length: number, width: number): boolean {
  return Number.isFinite(length) && Number.isFinite(width) && length > 0 && width > 0
    && ((length <= SHEET_LENGTH && width <= SHEET_WIDTH) || (length <= SHEET_WIDTH && width <= SHEET_LENGTH));
}
/** Épaisseurs proposées dans l'abaque John Steel, communes inox / acier-alu. */
export const SHEET_THICKNESSES = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;
export const MAX_SHEET_THICKNESS = 20;

export function normalizeSheetThickness(value: number, finish?: SheetFinish, bendCount = 0): number {
  const available = getAvailableSheetThicknesses(finish, bendCount);
  if (!available.length) throw new Error('Cette finition ne permet pas le pliage.');
  const target = Number.isFinite(value) ? Math.max(available[0], Math.min(MAX_SHEET_THICKNESS, value)) : available[0];
  return available.reduce((closest, thickness) => (
    Math.abs(thickness - target) < Math.abs(closest - target) ? thickness : closest
  ), available[0]);
}

/**
 * Bord tombé minimum (longueur mini de l'aile pour permettre le pliage sur vé de presse plieuse)
 */
export function getMinLegLength(thickness: number): number {
  return Math.max(30, Math.ceil(thickness * 2.5));
}

/** Cote entre les faces intérieures, déduite de la cote extérieure saisie. */
export function getInnerLegLength(state: SheetMetalState, legIndex: number): number {
  const leg = state.legs[legIndex];
  if (!leg) return 0;
  const bendSetback = (bendIndex: number) => {
    if (bendIndex < 0 || bendIndex >= state.bendCount) return 0;
    const bend = state.bends[bendIndex];
    if (!bend) return 0;
    const angle = Math.max(15, Math.min(165, Math.abs(bend.angle)));
    return state.thickness * Math.tan((angle * Math.PI) / 360);
  };
  return Math.max(0, leg.length - bendSetback(legIndex - 1) - bendSetback(legIndex));
}

/**
 * Longueur maximale réalisable pour une aile sans dépasser les capacités de la tôle d'atelier
 */
export function getMaxLegLength(state: SheetMetalState, legIndex: number): number {
  const { bendCount, legs, thickness, width } = state;
  const minLeg = getMinLegLength(thickness);
  const maxSheetDimension = width <= SHEET_WIDTH ? SHEET_LENGTH : SHEET_WIDTH;
  const activeCount = Math.min(legs.length, bendCount + 1);
  const targetIndex = Math.max(0, Math.min(activeCount - 1, legIndex));

  // Use the exact same developed-length function as the audit/export path.
  // The former closed-form estimate could drift from the real geometry after
  // several bends, allowing the sum of the wings to exceed the stock sheet.
  const candidate = (length: number): SheetMetalState => ({
    ...state,
    legs: state.legs.map((leg, index) => (
      index === targetIndex ? { ...leg, length } : leg
    )),
  });

  if (calculateUnfoldedLength(candidate(minLeg)) > maxSheetDimension) {
    return minLeg;
  }

  let low = minLeg;
  let high = maxSheetDimension;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (low + high) / 2;
    if (calculateUnfoldedLength(candidate(middle)) <= maxSheetDimension) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return Math.max(minLeg, Math.min(maxSheetDimension, Math.floor(low)));
}

/**
 * Largeur maximale réalisable selon le développé actuel
 */
export function getMaxWidth(unfoldedLength: number): number {
  if (unfoldedLength <= SHEET_WIDTH) {
    return SHEET_LENGTH; // 2980 mm
  }
  return SHEET_WIDTH; // 1480 mm
}

/**
 * Norme Métallurgique & Chaudronnerie (DIN 6935 / CETIM / Trumpf) :
 * Distance minimale du bord de découpe d'un perçage au début du pliage :
 * d_mini = 2.5 * e + Ri (avec Ri = e => 3.5 * e)
 * Empêche l'ovalisation du trou et la rupture lors de la frappe dans le vé de presse plieuse.
 */
export function getHoleBendClearance(thickness: number): number {
  // Also cover the complete pink zone (minimum displayed width: 8 mm).
  return Math.max(4, Math.round((2.5 * thickness + thickness) * 10) / 10);
}

/**
 * Calcule les rayons/demi-dimensions du trou selon son profil géométrique
 */
export function getHoleRadii(leg?: Partial<LegConfig>): { rx: number; rz: number } {
  const shape = leg?.holeShape || 'round';
  const diam = leg?.holeDiam || 5;
  const len = leg?.holeLength || 25;
  const wid = leg?.holeWidth || 12;
  const orient = leg?.holeOrientation || 'along_length';

  if (shape === 'round' || shape === 'square' || shape === 'octagonal') {
    return { rx: diam / 2, rz: diam / 2 };
  } else if (shape === 'rect') {
    return { rx: len / 2, rz: wid / 2 };
  } else if (shape === 'oblong') {
    return orient === 'along_length'
      ? { rx: len / 2, rz: wid / 2 }
      : { rx: wid / 2, rz: len / 2 };
  }
  return { rx: diam / 2, rz: diam / 2 };
}

/** Rayon maximal des coins pour un trou carré ou rectangulaire. */
export function getMaxHoleCornerRadius(leg: Partial<LegConfig>): number {
  const shape = leg.holeShape || 'round';
  if (shape === 'square') return Math.max(0, (leg.holeDiam || 5) / 2);
  if (shape === 'rect') {
    return Math.max(0, Math.min(leg.holeLength || 25, leg.holeWidth || 12) / 2);
  }
  return 0;
}

/**
 * Contraintes géométriques et atelier pour les perçages sur une aile
 */
export function getHoleConstraints(
  legOrLength: number | Partial<LegConfig>, 
  thickness: number, 
  width: number,
  optionalShape?: HoleShape | number | boolean,
  optionalLength?: number,
  optionalWidth?: number,
  optionalOrientation?: 'along_length' | 'along_width',
  hasAdjacentBend = true,
  hasBendAtStart = false,
) {
  let legLength = typeof legOrLength === 'number' ? legOrLength : (legOrLength.length || 100);
  let legObj: Partial<LegConfig> | undefined = typeof legOrLength === 'object' ? legOrLength : undefined;

  if (typeof optionalShape === 'boolean') {
    hasAdjacentBend = optionalShape;
  } else if (typeof optionalShape === 'number') {
    legLength = optionalShape;
  } else if (typeof optionalShape === 'string') {
    legObj = {
      ...(legObj || {}),
      holeShape: optionalShape,
      holeLength: optionalLength,
      holeWidth: optionalWidth,
      holeOrientation: optionalOrientation,
    };
  }

  const { rx, rz } = getHoleRadii(legObj);

  const minDiam = 2;
  const maxDiam = Math.max(minDiam, Math.min(Math.floor(legLength * 0.6), Math.floor(width * 0.6), 80));
  
  // Les découpes peuvent déboucher sur un bord extérieur. Le centre reste dans
  // la tôle, tandis que le bord côté pli conserve son dégagement de sécurité.
  const minDist = hasAdjacentBend && hasBendAtStart ? Math.ceil((getHoleBendClearance(thickness) + rx) * 10) / 10 : 0;

  // Distance minimale anti-déformation du pli (CETIM / DIN 6935)
  const bendClearance = hasAdjacentBend ? getHoleBendClearance(thickness) : 0;
  const maxDist = Math.floor(legLength - (hasAdjacentBend ? bendClearance + rx : 0));
  
  // Autoriser également une découpe ouverte sur les bords latéraux de l'aile.
  const minOffset = 0;
  const maxOffset = Math.floor(width);

  return { 
    minDiam, 
    maxDiam, 
    minDist, 
    maxDist, 
    minOffset, 
    maxOffset, 
    bendClearance,
    minClearanceBend: bendClearance,
    rx,
    rz,
    isFeasible: maxDist >= minDist && maxOffset >= minOffset,
  };
}

/** Clamp hole centres to the sheet while preserving bend clearance. Exterior
 * edges may be crossed intentionally to create open notches/cut-outs. */
export function constrainHolePosition(
  leg: Partial<LegConfig>,
  width: number,
  thickness: number,
  dist: number,
  offset: number,
  hasAdjacentBend = true,
  hasBendAtStart = false,
) {
  const bounds = getHoleConstraints(leg, thickness, width, hasAdjacentBend, undefined, undefined, undefined, hasAdjacentBend, hasBendAtStart);
  return {
    dist: Math.max(bounds.minDist, Math.min(bounds.maxDist, Number.isFinite(dist) ? dist : bounds.minDist)),
    offset: Math.max(bounds.minOffset, Math.min(bounds.maxOffset, Number.isFinite(offset) ? offset : bounds.minOffset)),
  };
}

export interface NearestEdgeDistances {
  distFreeEdge: number;
  distBend: number;
  distLeft: number;
  distRight: number;
  edgeFreeEdge: number;
  edgeBend: number;
  edgeLeft: number;
  edgeRight: number;
  nearestX: { name: string; distCenter: number; distEdge: number; edgeKey: 'free' | 'bend' };
  nearestZ: { name: string; distCenter: number; distEdge: number; edgeKey: 'left' | 'right' };
  minClearanceRequired: number;
  isBendSafe: boolean;
  edges: {
    free: { distCenter: number; distEdge: number };
    bend: { distCenter: number; distEdge: number };
    left: { distCenter: number; distEdge: number };
    right: { distCenter: number; distEdge: number };
  };
}

/**
 * Calcule les positions d'un trou par rapport aux 4 bords et identifie les bords les plus proches
 */
export function getNearestEdgeDistances(
  leg: LegConfig,
  legLength: number,
  sheetWidth: number,
  thickness: number,
  hasAdjacentBend = true,
): NearestEdgeDistances {
  const { rx, rz } = getHoleRadii(leg);
  const distFreeEdge = parseFloat(leg.holeDist.toFixed(1));
  const distBend = parseFloat(Math.max(0, legLength - leg.holeDist).toFixed(1));
  const distLeft = parseFloat(leg.holeOffset.toFixed(1));
  const distRight = parseFloat(Math.max(0, sheetWidth - leg.holeOffset).toFixed(1));

  const edgeFreeEdge = parseFloat(Math.max(0, distFreeEdge - rx).toFixed(1));
  const edgeBend = parseFloat(Math.max(0, distBend - rx).toFixed(1));
  const edgeLeft = parseFloat(Math.max(0, distLeft - rz).toFixed(1));
  const edgeRight = parseFloat(Math.max(0, distRight - rz).toFixed(1));

  const nearestX = distFreeEdge <= distBend
    ? { name: 'Bord libre', distCenter: distFreeEdge, distEdge: edgeFreeEdge, edgeKey: 'free' as const }
    : { name: hasAdjacentBend ? 'Ligne de pli' : 'Bord opposé', distCenter: distBend, distEdge: edgeBend, edgeKey: 'bend' as const };

  const nearestZ = distLeft <= distRight
    ? { name: 'Bord gauche', distCenter: distLeft, distEdge: edgeLeft, edgeKey: 'left' as const }
    : { name: 'Bord droit', distCenter: distRight, distEdge: edgeRight, edgeKey: 'right' as const };

  const minClearanceRequired = hasAdjacentBend ? getHoleBendClearance(thickness) : 0;
  const isBendSafe = !hasAdjacentBend || edgeBend >= minClearanceRequired - 0.1;

  const edges = {
    free: { distCenter: distFreeEdge, distEdge: edgeFreeEdge },
    bend: { distCenter: distBend, distEdge: edgeBend },
    left: { distCenter: distLeft, distEdge: edgeLeft },
    right: { distCenter: distRight, distEdge: edgeRight },
  };

  return {
    distFreeEdge,
    distBend,
    distLeft,
    distRight,
    edgeFreeEdge,
    edgeBend,
    edgeLeft,
    edgeRight,
    nearestX,
    nearestZ,
    minClearanceRequired,
    isBendSafe,
    edges,
  };
}

/**
 * Calcul du développé (flat pattern length) avec perte au pli selon norme DIN 6935
 */
export function calculateUnfoldedLength(state: SheetMetalState): number {
  if (state.blankShape) return Number(blankFrame(state).length.toFixed(2));
  const { bendCount, legs, thickness, bends } = state;
  const activeLegs = legs.slice(0, bendCount + 1);
  const activeBends = bends.slice(0, bendCount);
  const rIn = thickness;
  const rOut = rIn + thickness;
  const kFactor = 0.4; // Facteur K standard tôlerie
  const rNeutral = rIn + (thickness * kFactor);
  
  let totalDeduction = 0;
  for (let i = 0; i < bendCount; i++) {
    const rawAngle = activeBends[i]?.angle ?? 90;
    const angleMag = Math.abs(isNaN(rawAngle) ? 90 : rawAngle);
    const clampedAngle = Math.max(15, Math.min(165, angleMag));
    const beta = (clampedAngle * Math.PI) / 180;
    const setback = rOut * Math.tan(beta / 2);
    const arcLength = beta * rNeutral;
    totalDeduction += (2 * setback) - arcLength;
  }
  
  // Somme des longueurs extérieures des ailes
  const sumLegs = activeLegs.reduce((acc, leg) => acc + Math.max(leg.length, rOut), 0);
  
  // Développé total = somme des ailes - total des pertes au pli
  const total = sumLegs - totalDeduction;
  return Math.max(0, parseFloat(total.toFixed(2)));
}

/**
 * Estimation de masse en kg
 */
export function calculateWeight(state: SheetMetalState, unfolded = calculateUnfoldedLength(state)): number {
  const { width, thickness, material } = state; // mm
  const density = MATERIAL_CONFIG[material]?.density || 7.85; // g/cm³
  const area = state.blankShape ? blankArea(blankFrame(state).definition) : unfolded * width;
  const volumeCm3 = (area * thickness) / 1000;
  const weightKg = (volumeCm3 * density) / 1000;
  return parseFloat(weightKg.toFixed(3));
}

export interface LegTransform {
  index: number;
  id: string;
  label: string;
  tip: { x: number; y: number };
  bendStart: { x: number; y: number };
  direction: { x: number; y: number }; // unit vector from tip to bend
  normal: { x: number; y: number }; // unit surface normal vector
  rotationAngle: number; // radians around Z for Three.js
  center: { x: number; y: number };
  length: number;
}

export interface ProfileEdge {
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  featureIndex: number; // 0: Leg 0, 1: Bend 0, 2: Leg 1, 3: Bend 1, 4: Leg 2, 5: Bend 2, 6: Leg 3
  featureName: string;
  featureId: string;
}

export interface CollisionCheckResult {
  hasCollision: boolean;
  featureA?: string;
  featureB?: string;
  featureIdA?: string;
  featureIdB?: string;
  message?: string;
  collisionPoint?: { x: number; y: number };
}

export interface ProfileGeometryData {
  shape: THREE.Shape;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  centerOffsetX: number;
  centerOffsetY: number;
  legTransforms: LegTransform[];
  pathPoints: { x: number; y: number }[];
  /** Contour edges on the raised/visible face of the sheet, never the reverse face or cut edges. */
  treadFaceEdges: Array<{ p1: { x: number; y: number }; p2: { x: number; y: number } }>;
  edges: ProfileEdge[];
  collision: CollisionCheckResult;
}

export interface FlatCornerEnd {
  legTransform: LegTransform;
  sideRadii: { left: number; right: number };
}

/** Returns both free ends that can carry rounded corners in the flat view. */
export function getFlatCornerEnds(state: SheetMetalState, legTransforms: LegTransform[]): FlatCornerEnd[] {
  const radii = getFlatCornerRadii(state);
  const first = legTransforms[0];
  if (!first) return [];

  if (state.bendCount === 0) {
    // A flat sheet has one profile leg, but two distinct length endpoints.
    // The profile transform points inward from its terminal end; reverse it
    // to cut the start end as well instead of applying both pairs at one end.
    const startTransform: LegTransform = {
      ...first,
      tip: first.bendStart,
      bendStart: first.tip,
      direction: { x: -first.direction.x, y: -first.direction.y },
    };
    return [
      { legTransform: startTransform, sideRadii: { left: radii.startLeft, right: radii.startRight } },
      { legTransform: first, sideRadii: { left: radii.endLeft, right: radii.endRight } },
    ];
  }

  const last = legTransforms[Math.min(state.bendCount, legTransforms.length - 1)];
  if (!last) return [];
  return [
    { legTransform: first, sideRadii: { left: radii.startLeft, right: radii.startRight } },
    { legTransform: last, sideRadii: { left: radii.endLeft, right: radii.endRight } },
  ];
}

function profileEdgeKey(a: { x: number; y: number }, b: { x: number; y: number }) {
  const pointKey = (point: { x: number; y: number }) => `${Math.round(point.x * 10000)},${Math.round(point.y * 10000)}`;
  return [pointKey(a), pointKey(b)].sort().join('|');
}

/** Déroule les UV des faces latérales sur tout le contour, sans repartir à zéro à chaque aile. */
export function applyContinuousSideUvs(geometry: THREE.ExtrudeGeometry, shape: THREE.Shape) {
  const sideGroup = geometry.groups.find(group => group.materialIndex === 1);
  if (!sideGroup) return geometry;
  const contour = shape.extractPoints(12).shape;
  if (contour.length < 2) return geometry;
  const points = contour.length > 2 && contour[0].distanceTo(contour[contour.length - 1]) < 1e-8
    ? contour.slice(0, -1) : contour;
  const distances = [0];
  for (let index = 1; index < points.length; index++) {
    distances.push(distances[index - 1] + points[index - 1].distanceTo(points[index]));
  }
  const perimeter = distances[distances.length - 1] + points[points.length - 1].distanceTo(points[0]);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uvs = geometry.getAttribute('uv') as THREE.BufferAttribute;
  // ExtrudeGeometry emits six non-indexed vertices per contour edge. Treat
  // the closing edge as the end of the perimeter, not a jump back to U=0:
  // CSG otherwise interpolates that jump across long triangles around holes.
  for (let edgeStart = sideGroup.start; edgeStart < sideGroup.start + sideGroup.count; edgeStart += 6) {
    const edgeEnd = Math.min(edgeStart + 6, sideGroup.start + sideGroup.count);
    const nearestIndices: number[] = [];
    for (let vertex = edgeStart; vertex < edgeEnd; vertex++) {
      const x = positions.getX(vertex);
      const y = positions.getY(vertex);
      let nearest = 0;
      let nearestSquared = Infinity;
      for (let index = 0; index < points.length; index++) {
        const squared = (points[index].x - x) ** 2 + (points[index].y - y) ** 2;
        if (squared < nearestSquared) {
          nearest = index;
          nearestSquared = squared;
        }
      }
      nearestIndices.push(nearest);
    }
    const closingEdge = nearestIndices.includes(0) && nearestIndices.includes(points.length - 1);
    for (let vertex = edgeStart; vertex < edgeEnd; vertex++) {
      const nearest = nearestIndices[vertex - edgeStart];
      const u = closingEdge && nearest === 0 ? perimeter : distances[nearest];
      uvs.setXY(vertex, u, positions.getZ(vertex));
    }
  }
  uvs.needsUpdate = true;
  return geometry;
}

/** Builds the formed sheet with tread relief on its raised face only. */
export function createOneSidedTreadGeometry(
  shape: THREE.Shape,
  depth: number,
  treadFaceEdges: ProfileGeometryData['treadFaceEdges'],
) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  applyContinuousSideUvs(geometry, shape);
  const sideGroup = geometry.groups.find((group) => group.materialIndex === 1);
  if (!sideGroup) {
    geometry.clearGroups();
    geometry.addGroup(0, geometry.getAttribute('position').count, 0);
    return geometry;
  }

  const contour = shape.extractPoints(12).shape.map((point) => point.clone());
  if (contour.length > 1 && contour[0].distanceTo(contour[contour.length - 1]) < 1e-8) contour.pop();
  // ExtrudeGeometry reverses CCW contours internally; mirror its ordering so
  // each material group stays aligned with the side-wall triangles it emits.
  if (!THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const expectedSideCount = contour.length * 6;
  geometry.clearGroups();
  geometry.addGroup(0, sideGroup.start, 0); // cut faces: smooth metal
  if (sideGroup.count !== expectedSideCount) {
    geometry.addGroup(sideGroup.start, sideGroup.count, 2);
    return geometry;
  }

  const texturedEdges = new Set(treadFaceEdges.map(({ p1, p2 }) => profileEdgeKey(p1, p2)));
  let offset = sideGroup.start;
  for (let i = contour.length - 1; i >= 0; i -= 1) {
    const a = contour[i];
    const b = contour[(i - 1 + contour.length) % contour.length];
    geometry.addGroup(offset, 6, texturedEdges.has(profileEdgeKey(a, b)) ? 1 : 2);
    offset += 6;
  }
  return geometry;
}

export interface FeasibilityCheckItem {
  id: string;
  name: string;
  category: 'geometry' | 'bending' | 'punching' | 'material' | 'collision';
  status: 'pass' | 'warning' | 'fail';
  value: string;
  criterion: string;
  message: string;
  recommendation?: string;
}

export interface SheetMetalFeasibilityReport {
  isFeasible: boolean; // false si au moins 1 échec bloquant ('fail')
  status: 'conform' | 'warning' | 'non_conform';
  score: number; // 0 à 100%
  checks: FeasibilityCheckItem[];
  unfoldedLength: number;
  width: number;
  thickness: number;
  weightKg: number;
  kFactor: number;
  materialName: string;
  bendsSummary: {
    bendIndex: number;
    angle: number;
    direction: 1 | -1;
    radiusIn: number;
    bendDeduction: number;
  }[];
}

/**
 * Moteur d'audit et de validation de fabricabilité métallerie & tôlerie industrielle (DIN 6935 / CETIM)
 */
export function checkSheetMetalFeasibility(
  state: SheetMetalState,
  precomputedCollision?: CollisionCheckResult,
): SheetMetalFeasibilityReport {
  const { bendCount, legs, bends, width, thickness, material } = state;
  const activeLegs = legs.slice(0, bendCount + 1);
  const activeBends = bends.slice(0, bendCount);
  const unfoldedLength = calculateUnfoldedLength(state);
  const weightKg = calculateWeight(state);
  const kFactor = 0.4;
  const checks: FeasibilityCheckItem[] = [];
  for (const leg of activeLegs) {
    const issue = stencilTextIssue(state, leg.id);
    if (issue) checks.push({ id: `text_${leg.id}`, name: `Texte / aile ${leg.id}`, category: 'punching', status: 'fail', value: 'À corriger', criterion: 'Découpes et ponts compatibles avec la tôle', message: issue });
  }
  if (state.blankShape) for (const [legIndex, leg] of activeLegs.entries()) {
    if (!leg.hasHole) continue;
    for (const [index, position] of getLegPatternPositions(state, legIndex, leg).entries()) {
      const radii = getHoleRadii({ ...leg, holeShape: position.shape ?? leg.holeShape, holeDiam: position.diam ?? leg.holeDiam,
        holeLength: position.length ?? leg.holeLength, holeWidth: position.width ?? leg.holeWidth, holeOrientation: position.orientation ?? leg.holeOrientation });
      if (!blankHoleAllowed(state, legIndex, position.dist, position.offset, radii.rx, radii.rz)) checks.push({
        id: `hole_blank_${leg.id}_${index}`, name: `Trou ${index + 1} / aile ${leg.id}`, category: 'punching', status: 'fail',
        value: 'Position incompatible', criterion: 'Centre dans la forme et découpe hors zone de pli',
        message: 'Ce trou est hors de la forme ou empiète sur une zone protégée de pli.', recommendation: 'Déplacez ou supprimez ce trou.' });
    }
  }
  const bendingRestriction = getBendingRestriction(state.finish || DEFAULT_FINISH[material], thickness);
  if (bendCount > 0 && bendingRestriction) {
    checks.push({ id: 'bending-availability', name: 'Disponibilité du pliage', category: 'material', status: 'fail', value: `${thickness} mm`, criterion: 'Finition compatible et épaisseur maximale de 6 mm', message: bendingRestriction, recommendation: 'Choisissez Sans pli ou une finition et une épaisseur compatibles.' });
  }

  // 1. Contrôle Épaisseur de tôle
  const availableThicknesses = getAvailableSheetThicknesses(state.finish);
  if ((availableThicknesses as readonly number[]).includes(thickness)) {
    checks.push({
      id: 'thickness',
      name: 'Épaisseur nominale de tôle',
      category: 'material',
      status: 'pass',
      value: `${thickness} mm`,
      criterion: `Épaisseurs disponibles pour ${SHEET_FINISHES[state.finish || DEFAULT_FINISH[material]].name} : ${availableThicknesses.join(', ')} mm`,
      message: `Épaisseur standard conforme pour découpe laser et pliage CN.`,
    });
  } else {
    checks.push({
      id: 'thickness',
      name: 'Épaisseur de tôle',
      category: 'material',
      status: 'fail',
      value: `${thickness} mm`,
      criterion: `Valeurs disponibles pour ${SHEET_FINISHES[state.finish || DEFAULT_FINISH[material]].name} : ${availableThicknesses.join(', ')} mm`,
      message: 'Cette épaisseur ne figure pas dans les abaques disponibles.',
      recommendation: 'Sélectionnez une épaisseur proposée dans la liste.',
    });
  }

  // 2. Contrôle Bords tombés minimaux (hauteur mini d'aile selon vé de presse plieuse)
  const minLegAllowed = getMinLegLength(thickness);
  let allLegsValid = true;
  for (const leg of bendCount > 0 ? activeLegs : []) {
    if (leg.length < minLegAllowed) {
      allLegsValid = false;
      checks.push({
        id: `min_leg_${leg.id}`,
        name: `Bord tombé Aile ${leg.id}`,
        category: 'bending',
        status: 'fail',
        value: `${leg.length} mm`,
        criterion: `b_min ≥ ${minLegAllowed} mm (vé V ≈ 6e à 8e)`,
        message: `L'Aile ${leg.id} (${leg.length} mm) est trop courte : elle tombera dans l'ouverture du vé de pliage.`,
        recommendation: `Augmentez la longueur de l'Aile ${leg.id} à au moins ${minLegAllowed} mm.`,
      });
    }
  }
  if (bendCount > 0 && allLegsValid) {
    checks.push({
      id: 'min_legs',
      name: 'Bords tombés minimaux (Ailes)',
      category: 'bending',
      status: 'pass',
      value: `Toutes ≥ ${minLegAllowed} mm`,
      criterion: `b_min ≥ ${minLegAllowed} mm (repos sur 2 lèvres du vé)`,
      message: `Toutes les ailes sont suffisamment longues pour être pliées sur presse plieuse CN sans glisser dans le vé.`,
    });
  }

  // 3. Contrôle Rayon intérieur de pliage (DIN 6935)
  const rIn = thickness;
  if (bendCount > 0) checks.push({
    id: 'bend_radius',
    name: 'Rayon intérieur de pliage (Ri)',
    category: 'bending',
    status: 'pass',
    value: `Ri = ${rIn} mm (1.0 × e)`,
    criterion: 'Ri ≥ 1.0 × e (DIN 6935 / Pliage en l\'air)',
    message: `Rayon naturel conforme pour éviter la fissuration de la fibre extérieure du métal.`,
  });

  // 4. Contrôle Angles de pliage CN
  let allAnglesValid = true;
  const bendsSummary: SheetMetalFeasibilityReport['bendsSummary'] = [];
  for (let i = 0; i < bendCount; i++) {
    const rawAngle = activeBends[i]?.angle ?? 90;
    const dir = activeBends[i]?.direction ?? 1;
    const angleMag = Math.abs(rawAngle);
    const rOut = rIn + thickness;
    const rNeutral = rIn + (thickness * kFactor);
    const beta = (angleMag * Math.PI) / 180;
    const setback = rOut * Math.tan(beta / 2);
    const arcLength = beta * rNeutral;
    const bendDeduction = parseFloat(((2 * setback) - arcLength).toFixed(2));

    bendsSummary.push({
      bendIndex: i + 1,
      angle: angleMag,
      direction: dir,
      radiusIn: rIn,
      bendDeduction,
    });

    if (angleMag < 15) {
      allAnglesValid = false;
      checks.push({
        id: `angle_bend_${i + 1}`,
        name: `Pli ${i + 1} trop fermé`,
        category: 'bending',
        status: 'fail',
        value: `${angleMag}°`,
        criterion: 'Angle ≥ 15° (outillage presse standard)',
        message: `Angle de ${angleMag}° trop fermé pour un outillage standard (nécessiterait un écrasement/ourlet spécifique avec risque de crique).`,
        recommendation: `Réglez l'angle du Pli ${i + 1} à au moins 15°.`,
      });
    } else if (angleMag > 165) {
      allAnglesValid = false;
      checks.push({
        id: `angle_bend_${i + 1}`,
        name: `Pli ${i + 1} trop ouvert`,
        category: 'bending',
        status: 'fail',
        value: `${angleMag}°`,
        criterion: 'Angle ≤ 165°',
        message: `Angle de ${angleMag}° trop ouvert (incohérence géométrique pour une tôle pliée).`,
        recommendation: `Réglez l'angle du Pli ${i + 1} à 165° maximum.`,
      });
    }
  }
  if (bendCount > 0 && allAnglesValid) {
    checks.push({
      id: 'bend_angles',
      name: 'Angles de pliage CN',
      category: 'bending',
      status: 'pass',
      value: bendsSummary.map(b => `${b.direction === 1 ? '+' : '-'}${b.angle}°`).join(', '),
      criterion: '15° ≤ |Angle| ≤ 165°',
      message: `Tous les angles de pliage sont dans la plage de formage CN faisable en atelier.`,
    });
  }

  // 5. Contrôle Perçages & Découpes (Dégagement au pli DIN 6935 + Distance bord libre + Diamètre laser)
  const activeHoles = activeLegs.filter(l => l.hasHole);
  if (activeHoles.length === 0) {
    checks.push({
      id: 'holes_summary',
      name: 'Découpes & Perçages',
      category: 'punching',
      status: 'pass',
      value: 'Aucun perçage configuré',
      criterion: 'DIN 6935 / CETIM',
      message: 'Pièce pleine sans perçage : aucune contrainte de dégagement.',
    });
  } else {
    for (const leg of activeHoles) {
      const edgeData = getNearestEdgeDistances(leg, leg.length, width, thickness, bendCount > 0);
      const minClearanceRequired = getHoleBendClearance(thickness);
      // A. Dégagement au pli
      if (bendCount > 0 && !edgeData.isBendSafe) {
        checks.push({
          id: `hole_bend_${leg.id}`,
          name: `Dégagement pli - Aile ${leg.id}`,
          category: 'punching',
          status: 'warning',
          value: `Matière restante au pli : ${edgeData.edges.bend.distEdge} mm`,
          criterion: `≥ ${minClearanceRequired} mm (DIN 6935 / 3.5 × e)`,
          message: `Le perçage sur l'Aile ${leg.id} est dans la zone d'étirement plastique du pli. Risque élevé d'ovalisation du trou lors du passage sous le vé.`,
          recommendation: `Augmentez la distance au pli pour laisser au moins ${minClearanceRequired} mm de matière avant le rayon.`,
        });
      } else if (bendCount > 0) {
        checks.push({
          id: `hole_bend_${leg.id}`,
          name: `Dégagement pli - Aile ${leg.id}`,
          category: 'punching',
          status: 'pass',
          value: `Matière restante au pli : ${edgeData.edges.bend.distEdge} mm`,
          criterion: `≥ ${minClearanceRequired} mm (DIN 6935)`,
          message: `Distance au pli conforme : le trou ne subira aucune déformation lors du pliage.`,
        });
      }

      // B. Débordement sur bord extérieur : autorisé pour créer une découpe ouverte.
      const minFreeEdgeDist = Math.min(
        edgeData.edges.free.distEdge,
        ...(bendCount === 0 ? [edgeData.edges.bend.distEdge] : []),
        edgeData.edges.left.distEdge,
        edgeData.edges.right.distEdge
      );
      checks.push({
        id: `hole_edge_${leg.id}`,
        name: `Bord extérieur - Aile ${leg.id}`,
        category: 'punching',
        status: 'pass',
        value: minFreeEdgeDist > 0 ? `Matière restante : ${minFreeEdgeDist} mm` : 'Découpe ouverte sur le bord',
        criterion: 'Débordement extérieur autorisé',
        message: 'Le perçage peut déboucher sur un bord extérieur. Le dégagement de sécurité au pli reste contrôlé séparément.',
      });

      // C. Diamètre / dimension minimale pour découpe laser
      const { rx, rz } = getHoleRadii(leg);
      const minHoleDim = Math.min(rx * 2, rz * 2);
      if (minHoleDim < thickness) {
        checks.push({
          id: `hole_size_${leg.id}`,
          name: `Dimension perçage - Aile ${leg.id}`,
          category: 'punching',
          status: 'warning',
          value: `${minHoleDim} mm`,
          criterion: `≥ ${thickness} mm (Ø ≥ e pour découpe laser)`,
          message: `Dimension (${minHoleDim} mm) < épaisseur de tôle (${thickness} mm). Découpe laser difficile sans amorce ni scories, risque d'encrassement.`,
          recommendation: `Privilégiez un diamètre de perçage au moins égal à l'épaisseur (${thickness} mm).`,
        });
      }
    }
  }

  // 6. Contrôle Auto-collision physique de matière
  const collision = precomputedCollision ?? checkSheetCollision(state);
  if (collision.hasCollision) {
    checks.push({
      id: 'collision',
      name: 'Auto-collision de matière',
      category: 'collision',
      status: 'fail',
      value: 'Interpénétration détectée',
      criterion: 'Aucune auto-collision',
      message: `Collision physique entre l'${collision.featureA} et l'${collision.featureB} : le métal s'auto-traverse. Pièce infaisable.`,
      recommendation: `Modifiez les angles de pliage ou réduisez la longueur des ailes pour éliminer l'interférence.`,
    });
  } else {
    checks.push({
      id: 'collision',
      name: 'Auto-collision de matière',
      category: 'collision',
      status: 'pass',
      value: 'Aucune collision',
      criterion: 'Espace libre entre toutes les ailes',
      message: 'Aucun chevauchement : la cinématique de pliage est physiquement possible.',
    });
  }

  // 7. Contrôle Format brut de tôle d'atelier
  const fitsLandscape = unfoldedLength <= SHEET_LENGTH && width <= SHEET_WIDTH;
  const fitsPortrait = unfoldedLength <= SHEET_WIDTH && width <= SHEET_LENGTH;
  if (!fitsSheetFormat(unfoldedLength, width)) {
    checks.push({
      id: 'sheet_format',
      name: 'Format de tôle brute d\'atelier',
      category: 'geometry',
      status: 'fail',
      value: `Flan développé : ${unfoldedLength} × ${width} mm`,
      criterion: `Format standard max : ${SHEET_WIDTH} × ${SHEET_LENGTH} mm`,
      message: `Le flan déplié dépasse le format maximal autorisé : 2980 × 1480 mm, rotation possible.`,
      recommendation: `Réduisez la longueur des ailes ou la largeur de la tôle.`,
    });
  } else {
    const formatName = (unfoldedLength <= 1000 && width <= 2000) || (unfoldedLength <= 2000 && width <= 1000)
      ? 'Petit format (1000 × 2000 mm)'
      : (unfoldedLength <= 1250 && width <= 2500) || (unfoldedLength <= 2500 && width <= 1250)
      ? 'Moyen format (1250 × 2500 mm)'
      : 'Grand format (1500 × 3000 mm)';
    checks.push({
      id: 'sheet_format',
      name: 'Format de tôle brute (Flan déplié)',
      category: 'geometry',
      status: 'pass',
      value: `Flan : ${unfoldedLength} × ${width} mm (${formatName})`,
      criterion: `≤ ${SHEET_WIDTH} × ${SHEET_LENGTH} mm`,
      message: `Le flan déplié s'imbrique parfaitement dans un format standard de tôlerie.`,
    });
  }

  // 8. Contrôle Dégagement outillage pour profil en U / C
  if (bendCount >= 2) {
    const dir0 = activeBends[0]?.direction ?? 1;
    const dir1 = activeBends[1]?.direction ?? 1;
    if (dir0 === dir1) {
      // Profil en U
      const leg0 = activeLegs[0]?.length || 50;
      const leg1 = activeLegs[1]?.length || 50;
      const leg2 = activeLegs[2]?.length || 50;
      if (Math.max(leg0, leg2) > 2.5 * leg1) {
        checks.push({
          id: 'tooling_u_profile',
          name: 'Dégagement poinçon (Profil en U)',
          category: 'bending',
          status: 'warning',
          value: `Profondeur ailes (${Math.max(leg0, leg2)} mm) > 2.5 × base (${leg1} mm)`,
          criterion: 'Hauteur poinçon / col de cygne',
          message: `Profil en U profond : le pliage du 2ème pli nécessite un poinçon haut ou à col de cygne pour dégager la première aile sans collision avec le tablier.`,
        });
      }
    }
  }

  // Synthèse globale
  const failCount = checks.filter(c => c.status === 'fail').length;
  const warningCount = checks.filter(c => c.status === 'warning').length;
  const isFeasible = failCount === 0;
  const status = failCount > 0 ? 'non_conform' : warningCount > 0 ? 'warning' : 'conform';

  const score = failCount > 0 
    ? Math.max(0, Math.round(100 - failCount * 30 - warningCount * 10))
    : warningCount > 0
    ? Math.max(70, Math.round(100 - warningCount * 8))
    : 100;

  return {
    isFeasible,
    status,
    score,
    checks,
    unfoldedLength,
    width,
    thickness,
    weightKg,
    kFactor,
    materialName: `${MATERIAL_CONFIG[material]?.name || 'Acier'} · ${SHEET_FINISHES[state.finish || DEFAULT_FINISH[material]].name} (${SHEET_FINISHES[state.finish || DEFAULT_FINISH[material]].reference})`,
    bendsSummary,
  };
}

function segmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
  tolerance: number = 0.001
): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - tolerance) return false;
  if (Math.min(a.x, b.x) > Math.max(c.x, d.x) + tolerance) return false;
  if (Math.max(a.y, b.y) < Math.min(c.y, d.y) - tolerance) return false;
  if (Math.min(a.y, b.y) > Math.max(c.y, d.y) + tolerance) return false;

  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => {
    return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  };

  const cp1 = cross(a, b, c);
  const cp2 = cross(a, b, d);
  const cp3 = cross(c, d, a);
  const cp4 = cross(c, d, b);

  if (((cp1 > tolerance && cp2 < -tolerance) || (cp1 < -tolerance && cp2 > tolerance)) &&
      ((cp3 > tolerance && cp4 < -tolerance) || (cp3 < -tolerance && cp4 > tolerance))) {
    return true;
  }

  const onSegment = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => {
    return r.x >= Math.min(p.x, q.x) - tolerance &&
           r.x <= Math.max(p.x, q.x) + tolerance &&
           r.y >= Math.min(p.y, q.y) - tolerance &&
           r.y <= Math.max(p.y, q.y) + tolerance &&
           Math.abs(cross(p, q, r)) <= tolerance;
  };

  if (Math.abs(cp1) <= tolerance && onSegment(a, b, c)) return true;
  if (Math.abs(cp2) <= tolerance && onSegment(a, b, d)) return true;
  if (Math.abs(cp3) <= tolerance && onSegment(c, d, a)) return true;
  if (Math.abs(cp4) <= tolerance && onSegment(c, d, b)) return true;

  return false;
}

function getSegmentIntersectionPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number }
): { x: number; y: number } {
  const denom = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denom) < 1e-9) {
    return { x: (a.x + b.x + c.x + d.x) / 4, y: (a.y + b.y + c.y + d.y) / 4 };
  }
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denom;
  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
  };
}

function pointToSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentToSegmentDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number }
): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b)
  );
}

/**
 * Générateur géométrique paramétrique universel pour profil de tôle pliée (1 à 4 plis)
 * Conforme aux règles d'usinage et de pliage industriel (DIN 6935).
 * Calcule automatiquement la cinématique, les décalages de fibre neutre, les raccordements
 * tangents continus C1, et garantit l'absence totale d'auto-intersection ou de malformation.
 */
export function generateSheetProfile(state: SheetMetalState): ProfileGeometryData {
  const { bendCount, legs, bends, thickness } = state;
  const M = Math.max(0, Math.min(4, bendCount));
  const activeLegs = legs.slice(0, M + 1);
  const activeBends = bends.slice(0, M);

  const T = Math.max(1, thickness);
  const rIn = T;
  const rOut = rIn + T;
  const rMid = 1.5 * T;

  // Directions et angles de chaque pli (+1 : pli vers la gauche / trigonométrique, -1 : pli vers la droite / horaire)
  const bendDirs: number[] = [];
  const bendAnglesDeg: number[] = [];
  const bendAnglesRad: number[] = [];
  for (let i = 0; i < M; i++) {
    const rawAngle = activeBends[i]?.angle ?? 90;
    const rawDir = activeBends[i]?.direction ?? 1;
    let angleMag = Math.abs(isNaN(rawAngle) ? 90 : rawAngle);
    let dir = rawDir;
    if (rawAngle < 0) {
      dir = -1;
    }
    const clampedAngle = Math.max(15, Math.min(165, angleMag));
    bendAnglesDeg.push(clampedAngle);
    bendAnglesRad.push((clampedAngle * Math.PI) / 180);
    bendDirs.push(dir === -1 ? -1 : 1);
  }

  // Calcul des angles cumulés de chaque aile le long de la chaîne cinématique
  // Aile 0 démarre à l'horizontale le long de l'axe +X (théta = 0)
  const thetas: number[] = [0];
  for (let i = 0; i < M; i++) {
    thetas.push(thetas[i] + bendDirs[i] * bendAnglesRad[i]);
  }

  // Vecteurs unitaires longitudinaux (u) et normaux gauches (n) pour chaque aile
  const uVectors: { x: number; y: number }[] = [];
  const nVectors: { x: number; y: number }[] = [];
  for (let i = 0; i <= M; i++) {
    const th = thetas[i];
    const ux = Math.round(Math.cos(th) * 1e6) / 1e6;
    const uy = Math.round(Math.sin(th) * 1e6) / 1e6;
    uVectors.push({ x: ux, y: uy });
    nVectors.push({ x: -uy, y: ux });
  }

  // Longueurs droites de chaque aile le long de la ligne moyenne (fibre neutre)
  // En déduisant les zones de raccordement selon les cotes extérieures saisies
  const sLengths: number[] = [];
  for (let i = 0; i <= M; i++) {
    const rawLen = Math.max(rOut, activeLegs[i]?.length || 50);
    if (M === 0) {
      // Tôle plane : aucune perte au pli, le développé est un rectangle.
      sLengths.push(rawLen);
    } else if (i === 0) {
      // Aile d'extrémité de départ (adjacent au pli 0)
      const s0 = rOut * Math.tan(bendAnglesRad[0] / 2);
      sLengths.push(Math.max(1, rawLen - s0));
    } else if (i === M) {
      // Aile d'extrémité de fin (adjacent au pli M-1)
      const sLast = rOut * Math.tan(bendAnglesRad[M - 1] / 2);
      sLengths.push(Math.max(1, rawLen - sLast));
    } else {
      // Aile intermédiaire (deux plis adjacents : i-1 et i)
      const sPrev = rOut * Math.tan(bendAnglesRad[i - 1] / 2);
      const sNext = rOut * Math.tan(bendAnglesRad[i] / 2);
      sLengths.push(Math.max(1, rawLen - sPrev - sNext));
    }
  }

  // Tracé des points de référence de la fibre médiane :
  // Aile i : segment [P_i -> Q_i] de longueur sLengths[i]
  // Pli i : arc de cercle de centre C_i et de rayon rMid reliant Q_i à P_{i+1}
  const P: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  const Q: { x: number; y: number }[] = [];
  const C: { x: number; y: number }[] = [];

  for (let i = 0; i <= M; i++) {
    const pStart = P[i];
    const qEnd = {
      x: pStart.x + sLengths[i] * uVectors[i].x,
      y: pStart.y + sLengths[i] * uVectors[i].y,
    };
    Q.push(qEnd);

    if (i < M) {
      const dir = bendDirs[i];
      // Le centre est décalé de rMid perpendiculairement à uVectors[i] selon le sens du pli
      const center = {
        x: qEnd.x + dir * rMid * nVectors[i].x,
        y: qEnd.y + dir * rMid * nVectors[i].y,
      };
      C.push(center);

      // Le début de l'aile suivante P_{i+1} est sur l'arc tourné de dir * bendAnglesRad[i]
      const nextP = {
        x: center.x - dir * rMid * nVectors[i + 1].x,
        y: center.y - dir * rMid * nVectors[i + 1].y,
      };
      P.push(nextP);
    }
  }

  // Échantillonnage d'arc circulaire régulier
  const sampleArcPoints = (
    center: { x: number; y: number },
    radius: number,
    startAngle: number,
    deltaAngle: number,
    steps: number = 8
  ): { x: number; y: number }[] => {
    const points: { x: number; y: number }[] = [];
    for (let s = 1; s <= steps; s++) {
      const ang = startAngle + deltaAngle * (s / steps);
      points.push({
        x: center.x + radius * Math.cos(ang),
        y: center.y + radius * Math.sin(ang),
      });
    }
    return points;
  };

  // Construction du contour fermé de la tôle (polygone 2D)
  const polyPoints: { x: number; y: number }[] = [];
  const edges: ProfileEdge[] = [];
  const treadFaceEdges: ProfileGeometryData['treadFaceEdges'] = [];
  const halfT = T / 2;

  const addEdge = (p1: { x: number; y: number }, p2: { x: number; y: number }, featureIndex: number, featureName: string, featureId: string, isTreadFace = false) => {
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) > 0.001) {
      edges.push({ p1, p2, featureIndex, featureName, featureId });
      if (isTreadFace) treadFaceEdges.push({ p1, p2 });
    }
  };

  const getLegName = (idx: number) => activeLegs[idx]?.label || `Aile ${String.fromCharCode(65 + idx)}`;
  const getLegId = (idx: number) => activeLegs[idx]?.id || String.fromCharCode(65 + idx);

  // 1. Côté GAUCHE (décalé de +halfT * n) de l'Aile 0 à l'Aile M
  // Aile 0 : départ
  const ptP0Left = {
    x: P[0].x + halfT * nVectors[0].x,
    y: P[0].y + halfT * nVectors[0].y,
  };
  const ptQ0Left = {
    x: Q[0].x + halfT * nVectors[0].x,
    y: Q[0].y + halfT * nVectors[0].y,
  };
  polyPoints.push(ptP0Left, ptQ0Left);
  addEdge(ptP0Left, ptQ0Left, 0, getLegName(0), getLegId(0), true);

  let lastLeftPt = ptQ0Left;

  // Raccordements et ailes suivantes côté gauche
  for (let i = 0; i < M; i++) {
    const dir = bendDirs[i];
    const center = C[i];
    const arcRadius = dir === 1 ? rIn : rOut;
    const startPt = {
      x: Q[i].x + halfT * nVectors[i].x,
      y: Q[i].y + halfT * nVectors[i].y,
    };
    const startAngle = Math.atan2(startPt.y - center.y, startPt.x - center.x);
    const deltaAngle = dir * bendAnglesRad[i];
    const steps = getBendArcSegments(bendAnglesRad[i]);

    const arcPts = sampleArcPoints(center, arcRadius, startAngle, deltaAngle, steps);
    let prevArcPt = lastLeftPt;
    for (const apt of arcPts) {
      polyPoints.push(apt);
      addEdge(prevArcPt, apt, 2 * i + 1, `Pli ${i + 1}`, String(i + 1), true);
      prevArcPt = apt;
    }

    const nextQLeft = {
      x: Q[i + 1].x + halfT * nVectors[i + 1].x,
      y: Q[i + 1].y + halfT * nVectors[i + 1].y,
    };
    polyPoints.push(nextQLeft);
    addEdge(prevArcPt, nextQLeft, 2 * (i + 1), getLegName(i + 1), getLegId(i + 1), true);
    lastLeftPt = nextQLeft;
  }

  // 2. Embout d'extrémité sur l'Aile M (plat de tranche)
  const tipMRight = {
    x: Q[M].x - halfT * nVectors[M].x,
    y: Q[M].y - halfT * nVectors[M].y,
  };
  polyPoints.push(tipMRight);
  addEdge(lastLeftPt, tipMRight, 2 * M, getLegName(M), getLegId(M));

  let lastRightPt = tipMRight;

  // 3. Côté DROIT (décalé de -halfT * n) en revenant de l'Aile M à l'Aile 0
  for (let i = M - 1; i >= 0; i--) {
    // Segment droit de l'aile i+1
    const pNextRight = {
      x: P[i + 1].x - halfT * nVectors[i + 1].x,
      y: P[i + 1].y - halfT * nVectors[i + 1].y,
    };
    polyPoints.push(pNextRight);
    addEdge(lastRightPt, pNextRight, 2 * (i + 1), getLegName(i + 1), getLegId(i + 1));

    const dir = bendDirs[i];
    const center = C[i];
    const arcRadius = dir === 1 ? rOut : rIn;
    const startPt = {
      x: P[i + 1].x - halfT * nVectors[i + 1].x,
      y: P[i + 1].y - halfT * nVectors[i + 1].y,
    };
    const startAngle = Math.atan2(startPt.y - center.y, startPt.x - center.x);
    const deltaAngle = -dir * bendAnglesRad[i];
    const steps = getBendArcSegments(bendAnglesRad[i]);

    const arcPts = sampleArcPoints(center, arcRadius, startAngle, deltaAngle, steps);
    let prevArcPt = pNextRight;
    for (const apt of arcPts) {
      polyPoints.push(apt);
      addEdge(prevArcPt, apt, 2 * i + 1, `Pli ${i + 1}`, String(i + 1));
      prevArcPt = apt;
    }

    const pLegIRight = {
      x: P[i].x - halfT * nVectors[i].x,
      y: P[i].y - halfT * nVectors[i].y,
    };
    polyPoints.push(pLegIRight);
    addEdge(prevArcPt, pLegIRight, 2 * i, getLegName(i), getLegId(i));
    lastRightPt = pLegIRight;
  }

  // Sans pli, ajouter le quatrième sommet pour obtenir une section plane
  // rectangulaire plutôt qu'un triangle dégénéré.
  if (M === 0) {
    const ptP0Right = {
      x: P[0].x - halfT * nVectors[0].x,
      y: P[0].y - halfT * nVectors[0].y,
    };
    polyPoints.push(ptP0Right);
    addEdge(lastRightPt, ptP0Right, 0, getLegName(0), getLegId(0));
    addEdge(ptP0Right, ptP0Left, 0, getLegName(0), getLegId(0));
  } else {
    // 4. Embout de départ sur l'Aile 0 (fermeture du polygone)
    addEdge(lastRightPt, ptP0Left, 0, getLegName(0), getLegId(0));
  }

  // Détection physique de collision / auto-croisement de matière (le métal ne peut pas se traverser)
  let collision: CollisionCheckResult = { hasCollision: false };

  for (let i = 0; i < edges.length; i++) {
    const e1 = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const e2 = edges[j];
      // Ignorer la même entité ou les entités immédiatement consécutives/conjointes
      // (Ex: Aile 0 et Aile 1 ne peuvent pas entrer en collision, elles sont reliées par le pli 1)
      if (Math.abs(e1.featureIndex - e2.featureIndex) <= 2) continue;

      const intersects = segmentsIntersect(e1.p1, e1.p2, e2.p1, e2.p2);
      const dist = segmentToSegmentDistance(e1.p1, e1.p2, e2.p1, e2.p2);

      if (intersects || dist < 0.1) {
        const pt = getSegmentIntersectionPoint(e1.p1, e1.p2, e2.p1, e2.p2);
        collision = {
          hasCollision: true,
          featureA: e1.featureName,
          featureB: e2.featureName,
          featureIdA: e1.featureId,
          featureIdB: e2.featureId,
          message: `Collision détectée entre l'${e1.featureName} et l'${e2.featureName} (le métal ne peut pas s'auto-traverser).`,
          collisionPoint: pt,
        };
        break;
      }
    }
    if (collision.hasCollision) break;
  }

  // Vérification de l'orientation (Winding order) : doit être Counter-Clockwise (CCW) pour Three.js
  let signedArea = 0;
  for (let i = 0; i < polyPoints.length; i++) {
    const j = (i + 1) % polyPoints.length;
    signedArea += polyPoints[i].x * polyPoints[j].y - polyPoints[j].x * polyPoints[i].y;
  }
  if (signedArea < 0) {
    polyPoints.reverse();
  }

  // Le rayon des coins appartient au développé à plat (les extrémités en
  // largeur), pas au profil de pliage. Le profil reste donc inchangé ici.
  const displayPoints = polyPoints;

  // Construction de l'objet THREE.Shape
  const shape = new THREE.Shape();
  shape.moveTo(displayPoints[0].x, displayPoints[0].y);
  for (let i = 1; i < displayPoints.length; i++) {
    shape.lineTo(displayPoints[i].x, displayPoints[i].y);
  }
  shape.closePath();

  // Définition des repères géométriques pour chaque aile (détection de clic & perçages)
  const legTransforms: LegTransform[] = [];
  for (let i = 0; i <= M; i++) {
    const legDef = activeLegs[i];
    const isLast = i === M;

    let tip = { x: P[i].x, y: P[i].y };
    let bendStart = { x: Q[i].x, y: Q[i].y };
    let dir = { x: uVectors[i].x, y: uVectors[i].y };

    if (isLast) {
      tip = { x: Q[i].x, y: Q[i].y };
      bendStart = { x: P[i].x, y: P[i].y };
      dir = { x: -uVectors[i].x, y: -uVectors[i].y };
    }

    legTransforms.push({
      index: i,
      id: legDef?.id || String.fromCharCode(65 + i),
      label: legDef?.label || `Aile ${String.fromCharCode(65 + i)}`,
      tip,
      bendStart,
      direction: dir,
      normal: { x: nVectors[i].x, y: nVectors[i].y },
      rotationAngle: thetas[i],
      center: {
        x: (P[i].x + Q[i].x) / 2,
        y: (P[i].y + Q[i].y) / 2,
      },
      length: activeLegs[i]?.length || 50,
    });
  }

  // Calcul du bounding box pour centrer la tôle dans le visualiseur
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of displayPoints) {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minY = Math.min(minY, pt.y);
    maxY = Math.max(maxY, pt.y);
  }

  const centerOffsetX = -(minX + maxX) / 2;
  const centerOffsetY = -(minY + maxY) / 2;

  return {
    shape,
    bounds: { minX, maxX, minY, maxY },
    centerOffsetX,
    centerOffsetY,
    legTransforms,
    pathPoints: displayPoints,
    treadFaceEdges,
    edges,
    collision,
  };
}

/**
 * Détection rapide de collision / auto-interférence pour n'importe quel état de tôle.
 * Retourne les entités en collision et le point d'impact exact.
 */
export function checkSheetCollision(state: SheetMetalState): CollisionCheckResult {
  return generateSheetProfile(state).collision;
}
