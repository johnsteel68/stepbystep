import { normalizeTextRotation } from './textRotation.ts';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { DEFAULT_FINISH, SHEET_FINISHES } from './sheetGeometry.ts';
import { BLANK_SHAPES } from './blankGeometry.ts';
import { GOOGLE_STENCIL_FONTS } from './googleStencilFonts.ts';
import { normalizeFormedBlank } from './formedBlank.ts';
import type { SheetMetalState, HolePatternConfig, LegConfig, HolePosition } from './sheetGeometry.ts';
import type { GrainDirection } from './technicalDrawing.ts';

export const PROJECT_HASH = '#projet=v1.';
export const PROJECT_QUERY = 'projet';
export const PROJECT_SITE = 'https://stepbystep.john-steel.com/';
// Lire les anciens projets reste possible, mais tout nouveau partage utilise le domaine John Steel.
const LEGACY_PROJECT_ORIGIN = 'https://step-generator.yop39.chatgpt.site';
const MAX_JSON_BYTES = 256_000;
const MAX_LINK_BYTES = 32_000;
export interface SharedProject { state: SheetMetalState; grainDirection: GrainDirection }

// Tuples avoid long repeated JSON field names, keeping the QR readable at a small size.
function compact({ state: s, grainDirection }: SharedProject): unknown[] {
  return [s.bendCount, s.material, s.finish, s.width, s.thickness, s.cornerRadius ?? null,
    s.cornerRadii ? [s.cornerRadii.startLeft, s.cornerRadii.startRight, s.cornerRadii.endLeft, s.cornerRadii.endRight] : null,
    s.holePattern ?? null, grainDirection,
    s.legs.map(l => [l.length, l.hasHole, l.holeDiam, l.holeDist, l.holeOffset, l.holeShape ?? null,
      l.holeLength ?? null, l.holeWidth ?? null, l.holeOrientation ?? null, l.holeCornerRadius ?? null, l.holePattern ?? null, l.holePositions ?? null, l.cutText ?? null]),
    s.bends.map(b => [b.angle, b.direction]), s.blankShape ? {
      blankShape: s.blankShape, blankLength: s.blankLength, blankWidth: s.blankWidth,
      blankInnerDiameter: s.blankInnerDiameter,
blankToothCount: s.blankToothCount, blankToothHeight: s.blankToothHeight,
      blankBranchCount: s.blankBranchCount, blankBranchHeight: s.blankBranchHeight,
      blankOrientation: s.blankOrientation || 0, blankBendPositions: s.blankBendPositions,
    } : null];
}
function expand(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if ((value.length !== 11 && value.length !== 12) || !Array.isArray(value[9]) || !Array.isArray(value[10])) throw new Error('Projet invalide');
  const [bendCount, material, finish, width, thickness, radius, corners, holes, grainDirection, legs, bends] = value;
  const state: Record<string, unknown> = { bendCount, material, finish, width, thickness,
    legs: legs.map((l: unknown, i: number) => {
      if (!Array.isArray(l) || ![12, 13].includes(l.length)) throw new Error('Aile invalide');
      const result: Record<string, unknown> = { id: 'ABCDE'[i], label: `Aile ${'ABCDE'[i]}`, length: l[0], hasHole: l[1], holeDiam: l[2], holeDist: l[3], holeOffset: l[4] };
      ['holeShape', 'holeLength', 'holeWidth', 'holeOrientation', 'holeCornerRadius', 'holePattern', 'holePositions'].forEach((key, n) => { if (l[n + 5] !== null) result[key] = l[n + 5]; });
      if (l[12] != null) result.cutText = l[12];
      return result;
    }), bends: bends.map((b: unknown, i: number) => {
      if (!Array.isArray(b) || b.length !== 2) throw new Error('Pli invalide');
      return { id: String(i + 1), angle: b[0], direction: b[1] };
    }) };
  if (radius !== null) state.cornerRadius = radius;
  if (corners !== null) {
    if (!Array.isArray(corners) || corners.length !== 4) throw new Error('Coins invalides');
    state.cornerRadii = { startLeft: corners[0], startRight: corners[1], endLeft: corners[2], endRight: corners[3] };
  }
  if (holes !== null) state.holePattern = holes;
  if (value[11] != null) Object.assign(state, record(value[11]));
  return { state, grainDirection };
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Projet invalide');
  return value as Record<string, unknown>;
};
const number = (value: unknown, min = 0, max = 10_000): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Dimension invalide');
  return value;
};
const integer = (value: unknown, min: number, max: number) => {
  const n = number(value, min, max);
  if (!Number.isInteger(n)) throw new Error('Nombre invalide');
  return n;
};
const choice = <T extends string>(value: unknown, values: readonly T[]): T => {
  if (!values.includes(value as T)) throw new Error('Choix invalide');
  return value as T;
};
const shapes = ['round', 'oblong', 'square', 'rect', 'octagonal'] as const;
const orientations = ['along_length', 'along_width'] as const;
function pattern(value: unknown): HolePatternConfig {
  const p = record(value);
  return { mode: choice(p.mode, ['single', 'corners', 'line', 'square']), count: integer(p.count, 1, 200), margin: number(p.margin), rows: integer(p.rows, 1, 20), columns: integer(p.columns, 1, 20) };
}
function position(value: unknown): HolePosition {
  const p = record(value);
  const result: HolePosition = { dist: number(p.dist, -10_000), offset: number(p.offset, -10_000) };
  if (p.textCutout === true) result.textCutout = true;
  if (p.contour !== undefined) {
    if (!result.textCutout || !Array.isArray(p.contour) || p.contour.length < 3 || p.contour.length > 512) throw new Error('Contour de texte invalide');
    result.contour = p.contour.map(value => { const point = record(value); return { x: number(point.x, -10_000), y: number(point.y, -10_000) }; });
  }
  if (p.templateOrigin !== undefined) result.templateOrigin = choice(p.templateOrigin, ['frame', 'mounting-plate']);
  if (p.shape !== undefined) result.shape = choice(p.shape, shapes);
  if (p.orientation !== undefined) result.orientation = choice(p.orientation, orientations);
  for (const key of ['diam', 'length', 'width', 'cornerRadius'] as const) {
    if (p[key] !== undefined) result[key] = number(p[key]);
  }
  return result;
}
function leg(value: unknown, index: number): LegConfig {
  const p = record(value);
  const id = 'ABCDE'[index];
  if (p.id !== id || typeof p.hasHole !== 'boolean') throw new Error('Aile invalide');
  const result: LegConfig = { id, label: `Aile ${id}`, length: number(p.length, .01), hasHole: p.hasHole,
    holeDiam: number(p.holeDiam, .01), holeDist: number(p.holeDist, -10_000), holeOffset: number(p.holeOffset, -10_000) };
  if (p.holeShape !== undefined) result.holeShape = choice(p.holeShape, shapes);
  if (p.holeOrientation !== undefined) result.holeOrientation = choice(p.holeOrientation, orientations);
  for (const key of ['holeLength', 'holeWidth', 'holeCornerRadius'] as const) {
    if (p[key] !== undefined) result[key] = number(p[key]);
  }
  if (p.holePattern !== undefined) result.holePattern = pattern(p.holePattern);
  if (p.cutText !== undefined) {
    const t = record(p.cutText);
    if (typeof t.text !== 'string' || t.text.length > 16 || typeof t.rotation !== 'number' || !Number.isFinite(t.rotation)) throw new Error('Texte invalide');
    result.cutText = { text: t.text, height: number(t.height, 1, 1000), x: number(t.x), y: number(t.y), rotation: normalizeTextRotation(number(t.rotation, -360_000, 360_000)) };
    if (t.font !== undefined) {
      if (!['pixel', 'industrial', 'dots', 'stencil', 'stencil-condensed', 'stencil-wide', 'stencil-sign', 'stencil-slab', 'stencil-tenada', 'stencil-tenada-condensed', 'stencil-tenada-wide', 'stencil-sunfonts', 'stencil-butler', 'stencil-micro-block', 'stencil-micro-round', 'stencil-micro-tech', ...GOOGLE_STENCIL_FONTS.map(font => font.id)].includes(t.font as string)) throw new Error('Police invalide');
      result.cutText.font = t.font as import('./stencilText.ts').StencilFont;
    }
  }
  if (p.holePositions !== undefined) {
    if (!Array.isArray(p.holePositions) || p.holePositions.length > 400) throw new Error('Trop de trous');
    result.holePositions = p.holePositions.map(position);
  }
  return result;
}

/** Treat shared links as untrusted input: only bounded, known configuration fields survive. */
export function validateSharedProject(value: unknown): SharedProject {
  const project = record(value);
  const p = record(project.state);
  const material = choice(p.material, ['Steel', 'Stainless', 'Aluminum']);
  const finish = p.finish === undefined ? DEFAULT_FINISH[material] : choice(p.finish, Object.keys(SHEET_FINISHES) as (keyof typeof SHEET_FINISHES)[]);
  if (SHEET_FINISHES[finish].family !== material || !SHEET_FINISHES[finish].thicknesses.includes(number(p.thickness, .1, 100))) throw new Error('Matière invalide');
  // The configurator keeps all five wings / four bends, including inactive ones.
  if (!Array.isArray(p.legs) || p.legs.length !== 5 || !Array.isArray(p.bends) || p.bends.length !== 4) throw new Error('Profil invalide');
  const state: SheetMetalState = { material, finish, thickness: p.thickness as number, width: number(p.width, .01),
    bendCount: integer(p.bendCount, 0, 4), legs: p.legs.map(leg), bends: p.bends.map((value, i) => {
      const b = record(value);
      if (b.id !== String(i + 1) || (b.direction !== 1 && b.direction !== -1)) throw new Error('Pli invalide');
      return { id: String(i + 1), angle: number(b.angle, -165, 165), direction: b.direction };
    }) };
  if (p.cornerRadius !== undefined) state.cornerRadius = number(p.cornerRadius);
  if (p.cornerRadii !== undefined) {
    const corners = record(p.cornerRadii);
    state.cornerRadii = { startLeft: number(corners.startLeft), startRight: number(corners.startRight), endLeft: number(corners.endLeft), endRight: number(corners.endRight) };
  }
  if (p.holePattern !== undefined) state.holePattern = pattern(p.holePattern);
  if (p.blankShape !== undefined) {
    state.blankShape = choice(p.blankShape, BLANK_SHAPES.map(option => option.id));
    state.blankLength = number(p.blankLength, 10, 2980);
    state.blankWidth = number(p.blankWidth, 10, 2980);
    if (p.blankInnerDiameter !== undefined) state.blankInnerDiameter = number(p.blankInnerDiameter, state.blankShape === 'gear' ? 0 : 1, state.blankLength - 2);
    if (p.blankToothCount !== undefined) state.blankToothCount = integer(p.blankToothCount, 6, 120);
    if (p.blankToothHeight !== undefined) state.blankToothHeight = number(p.blankToothHeight, .5, state.blankLength / 2 - 2);
    if (p.blankBranchCount !== undefined) state.blankBranchCount = integer(p.blankBranchCount, 3, 30);
    if (p.blankBranchHeight !== undefined) state.blankBranchHeight = number(p.blankBranchHeight, .5, state.blankLength / 2 - 1);
    state.blankOrientation = number(p.blankOrientation ?? 0, -90, 90);
    if (p.blankBendPositions !== undefined) {
      if (!Array.isArray(p.blankBendPositions) || p.blankBendPositions.length !== state.bendCount) throw new Error('Plis invalides.');
      state.blankBendPositions = p.blankBendPositions.map(value => number(value, 0, 5000));
    }
  }
  return { state: normalizeFormedBlank(state), grainDirection: choice(project.grainDirection, ['length', 'width']) };
}

export function createProjectLink(state: SheetMetalState, grainDirection: GrainDirection, currentUrl = PROJECT_SITE): string {
  const project = validateSharedProject({ state, grainDirection });
  const bytes = strToU8(JSON.stringify(compact(project)));
  if (bytes.length >= MAX_JSON_BYTES) throw new Error('Projet trop volumineux');
  const packed = deflateSync(bytes, { level: 9 });
  const token = btoa(Array.from(packed, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (token.length > MAX_LINK_BYTES) throw new Error('Projet trop volumineux');
  const url = new URL(currentUrl);
  // Never share localhost/file URLs, login callback codes, query tokens or other fragments.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const base = url.protocol === 'https:' && !local && url.origin !== LEGACY_PROJECT_ORIGIN ? `${url.origin}/` : PROJECT_SITE;
  // Query parameters survive the hosted site's sign-in return URL; fragments do not.
  return `${base}?${PROJECT_QUERY}=v1.${token}`;
}

export function readProjectFromUrl(currentUrl: string): SharedProject | null {
  try {
    const url = new URL(currentUrl);
    const token = url.searchParams.get(PROJECT_QUERY);
    return readSharedProject(token === null ? url.hash : `#projet=${token}`);
  } catch { return null; }
}

export function readSharedProject(hash: string): SharedProject | null {
  if (!hash.startsWith(PROJECT_HASH)) return null;
  try {
    const token = hash.slice(PROJECT_HASH.length);
    if (!token || token.length > MAX_LINK_BYTES || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    // Fixed output buffer bounds decompression memory, even for a malicious shared link.
    const json = inflateSync(bytes, { out: new Uint8Array(MAX_JSON_BYTES) });
    if (json.length >= MAX_JSON_BYTES) return null;
    return validateSharedProject(expand(JSON.parse(strFromU8(json))));
  } catch { return null; }
}
