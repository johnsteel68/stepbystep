import type { HolePosition, SheetMetalState } from './sheetGeometry.ts';
import { getHoleConstraints, getHoleRadii, getHoleBendClearance } from './sheetGeometry.ts';
import { explicitHoles } from './holeEditing.ts';
import { blankHoleAllowed, blankTextBlockAllowed } from './formedBlank.ts';
import { TENADA_GLYPHS } from './tenadaGlyphs.ts';
import { SUNFONTS_GLYPHS } from './sunfontsGlyphs.ts';
import { BUTLER_GLYPHS } from './butlerGlyphs.ts';
import { GOOGLE_STENCIL_FONTS } from './googleStencilFonts.ts';
import { GOOGLE_STENCIL_DATA } from './googleStencilGlyphs.ts';
import { getGoogleStencilGlyphs } from './googleStencilLoader.ts';
import { normalizeTextRotation, rotateTextPoint, rotateStencilCuts } from './textRotation.ts';
import { COMPACT_STENCIL_FONTS, compactMinimumHeight, isCompactStencil, styleCompactCuts } from './compactStencil.ts';

export const STENCIL_FONTS = [
  ...COMPACT_STENCIL_FONTS,
  ...GOOGLE_STENCIL_FONTS,
  { id: 'stencil-sunfonts', label: 'Sunfonts Stencil', description: 'Technique et géométrique · contours vectoriels' },
  { id: 'stencil-butler', label: 'Butler Stencil Black', description: 'Empattements élégants · Fabian De Smet · fabiandesmet.com' },
  { id: 'stencil-tenada', label: 'Tenada', description: 'Stencil moderne · vrais contours vectoriels' },
  { id: 'stencil-tenada-condensed', label: 'Tenada étroite', description: 'Variante condensée · vrais contours vectoriels' },
  { id: 'stencil-tenada-wide', label: 'Tenada large', description: 'Variante étendue · vrais contours vectoriels' },
  { id: 'stencil', label: 'Stencil atelier', description: 'Lettres continues à ponts' },
  { id: 'stencil-condensed', label: 'Stencil étroit', description: 'Lettres resserrées à ponts' },
  { id: 'stencil-wide', label: 'Stencil large', description: 'Lettres larges à ponts' },
  { id: 'stencil-sign', label: 'Stencil signalétique', description: 'Traits massifs · dessin compact' },
  { id: 'stencil-slab', label: 'Stencil sérif', description: 'Empattements · style atelier' },
  { id: 'pixel', label: 'Pixel', description: 'Compact · carrés' },
  { id: 'industrial', label: 'Industriel', description: 'Détaillé · carrés' },
  { id: 'dots', label: 'Points', description: 'Léger · ronds' },
] as const;
export type StencilFont = typeof STENCIL_FONTS[number]['id'];
// Keep old IDs readable for shared projects, without offering stretched clones.
export const SELECTABLE_STENCIL_FONTS = STENCIL_FONTS.filter(font => font.id.startsWith('stencil') && !['stencil-condensed', 'stencil-wide', 'stencil-tenada-condensed', 'stencil-tenada-wide'].includes(font.id));
export interface StencilText { id?: string; text: string; height: number; x: number; y: number; rotation: number; font?: StencilFont }
/** Normalize old projects to a stable one-block list without mutating their state. */
export function getStencilTexts(leg: { cutTexts?: StencilText[]; cutText?: StencilText }, legId = 'A'): StencilText[] {
  if (leg.cutTexts?.length) return leg.cutTexts;
  return leg.cutText ? [{ ...leg.cutText, id: leg.cutText.id ?? `legacy-${legId}` }] : [];
}
export const textSafetyMargin = (thickness: number) => Math.max(3, thickness);
/** A text edit is transactional: only return configurations accepted by the
 * same validator used for committing and exporting the cutouts. */
export function fitStencilText(state: SheetMetalState, legId: string, config: StencilText): StencilText {
  if (!config.text.trim()) return config;
  const leg = state.legs.find(item => item.id === legId);
  if (!leg) throw new Error('Aile introuvable.');
  const minimum = textMinimumHeight(state.thickness, config.font);
  const requested = Math.max(minimum, config.height);
  let lastError = 'Le texte ne tient pas sur cette surface avec les marges nécessaires.';
  // Try the current anchor first; then center and a bounded grid for curved
  // or concave blanks. Never clamp individual letters independently.
  const anchors = [{ x: config.x, y: config.y }, { x: leg.length / 2, y: state.width / 2 }];
  for (let ix = 1; ix < 8; ix++) for (let iy = 1; iy < 8; iy++)
    anchors.push({ x: leg.length * ix / 8, y: state.width * iy / 8 });
  for (let step = 0; step <= 12; step++) {
    const height = step === 12 ? minimum : Math.max(minimum, requested * Math.pow(.85, step));
    for (const anchor of anchors) {
      const candidate = { ...config, ...anchor, height: Math.round(height * 1000) / 1000 };
      // Rounding must not dip below the minimum manufacturing guardrail.
      candidate.height = Math.max(minimum, candidate.height);
      try { applyStencilText(state, legId, candidate); return candidate; }
      catch (error) { lastError = (error as Error).message; }
    }
    if (height === minimum) break;
  }
  throw new Error(`Modification refusée : ${lastError}`);
}
export function hasPendingStencilText(state: SheetMetalState, draft: { legId: string; config: StencilText } | null): boolean {
  if (!draft) return false;
  const leg = state.legs.find(item => item.id === draft.legId);
  const saved = leg && getStencilTexts(leg, leg.id).find(item => item.id === draft.config.id);
  if (!draft.config.text.trim()) return !!saved;
  return !saved || (['text', 'font', 'height', 'x', 'y', 'rotation'] as const).some(key => saved[key] !== draft.config[key]);
}
/** Conservative design screening, not a machine-specific cutting guarantee.
 * Xometry recommends retained tabs >= max(1.6 mm, sheet thickness).
 * We retain max(2 mm, thickness) and also check each selected glyph's cuts. */
export function textAvailabilityIssue(state: SheetMetalState): string | null {
  if (['steel-larme', 'aluminum-larme', 'stainless-antislip', 'aluminum-perforated'].includes(state.finish))
    return 'Texte découpé indisponible sur les surfaces larmées, antidérapantes ou perforées.';
  if (!Number.isFinite(state.thickness) || state.thickness <= 0) return 'Choisissez une épaisseur valide.';
  const edge = textSafetyMargin(state.thickness), height = compactMinimumHeight(state.thickness);
  const fits = state.legs.slice(0, state.bendCount + 1).some((leg, index) => {
    const ends = state.bendCount === 0 ? 0 : index > 0 && index < state.bendCount ? 2 : 1;
    const length = leg.length - ends * getHoleBendClearance(state.thickness) - (2 - ends) * edge;
    const width = state.width - 2 * edge;
    return (length >= height * .6 && width >= height) || (length >= height && width >= height * .6);
  });
  return fits ? null : 'Cette épaisseur impose des lettres et des ponts trop grands pour la surface disponible. Agrandissez la pièce ou réduisez son épaisseur.';
}
// A rectilinear stencil alphabet: each cell is an independent cutout. The
// continuous web between cells retains counters without floating islands.
const alphabet: Record<string, string> = {
  A:'010/101/111/101/101', B:'110/101/110/101/110', C:'111/100/100/100/111',
  D:'110/101/101/101/110', E:'111/100/110/100/111', F:'111/100/110/100/100',
  G:'111/100/101/101/111', H:'101/101/111/101/101', I:'111/010/010/010/111',
  J:'001/001/001/101/111', K:'101/101/110/101/101', L:'100/100/100/100/111',
  M:'101/111/111/101/101', N:'101/111/111/111/101', O:'111/101/101/101/111',
  P:'111/101/111/100/100', Q:'111/101/101/111/001', R:'110/101/110/101/101',
  S:'111/100/111/001/111', T:'111/010/010/010/010', U:'101/101/101/101/111',
  V:'101/101/101/101/010', W:'101/101/111/111/101', X:'101/101/010/101/101',
  Y:'101/101/010/010/010', Z:'111/001/010/100/111',
  '0':'111/101/101/101/111', '1':'010/110/010/010/111', '2':'111/001/111/100/111',
  '3':'111/001/111/001/111', '4':'101/101/111/001/001', '5':'111/100/111/001/111',
  '6':'111/100/111/101/111', '7':'111/001/010/010/010', '8':'111/101/111/101/111',
  '9':'111/101/111/001/111', '-':'000/000/111/000/000', '.':'000/000/000/000/010',
  ' ':'000/000/000/000/000',
};
// The finer 5×7 alphabet separates diagonals and counters more clearly. Each
// cell stays independent: switching fonts never creates unsupported islands.
const industrialAlphabet: Record<string, string> = {
  A:'01110/10001/10001/11111/10001/10001/10001', B:'11110/10001/10001/11110/10001/10001/11110',
  C:'01111/10000/10000/10000/10000/10000/01111', D:'11110/10001/10001/10001/10001/10001/11110',
  E:'11111/10000/10000/11110/10000/10000/11111', F:'11111/10000/10000/11110/10000/10000/10000',
  G:'01110/10001/10000/10111/10001/10001/01110', H:'10001/10001/10001/11111/10001/10001/10001',
  I:'11111/00100/00100/00100/00100/00100/11111', J:'00111/00010/00010/00010/10010/10010/01100',
  K:'10001/10010/10100/11000/10100/10010/10001', L:'10000/10000/10000/10000/10000/10000/11111',
  M:'10001/11011/10101/10101/10001/10001/10001', N:'10001/11001/11001/10101/10011/10011/10001',
  O:'01110/10001/10001/10001/10001/10001/01110', P:'11110/10001/10001/11110/10000/10000/10000',
  Q:'01110/10001/10001/10001/10101/10010/01101', R:'11110/10001/10001/11110/10100/10010/10001',
  S:'01111/10000/10000/01110/00001/00001/11110', T:'11111/00100/00100/00100/00100/00100/00100',
  U:'10001/10001/10001/10001/10001/10001/01110', V:'10001/10001/10001/10001/10001/01010/00100',
  W:'10001/10001/10001/10101/10101/10101/01010', X:'10001/10001/01010/00100/01010/10001/10001',
  Y:'10001/10001/01010/00100/00100/00100/00100', Z:'11111/00001/00010/00100/01000/10000/11111',
  '0':'01110/10001/10011/10101/11001/10001/01110', '1':'00100/01100/00100/00100/00100/00100/01110',
  '2':'01110/10001/00001/00010/00100/01000/11111', '3':'11110/00001/00001/01110/00001/00001/11110',
  '4':'00010/00110/01010/10010/11111/00010/00010', '5':'11111/10000/10000/11110/00001/00001/11110',
  '6':'01110/10000/10000/11110/10001/10001/01110', '7':'11111/00001/00010/00100/01000/01000/01000',
  '8':'01110/10001/10001/01110/10001/10001/01110', '9':'01110/10001/10001/01111/00001/00001/01110',
  '-':'00000/00000/00000/11111/00000/00000/00000', '.':'00000/00000/00000/00000/00000/00100/00100',
  ' ':'00000/00000/00000/00000/00000/00000/00000',
};
export function textMinimumHeight(thickness: number, font: StencilFont = 'pixel') {
  if (isCompactStencil(font)) return compactMinimumHeight(thickness);
  // Conservative provisional rules, not a John Steel manufacturing guarantee.
  // A bridge splits a row into two half-strokes: each remaining half must
  // still be at least as wide as the provisional minimum cutting feature.
  if (GOOGLE_STENCIL_DATA[font]) return GOOGLE_STENCIL_DATA[font].minimumFactor * Math.max(2, thickness);
  if (font === 'stencil-butler') return 48 * Math.max(2, thickness);
  if (font === 'stencil-sunfonts') return 32 * Math.max(2, thickness);
  if (font.startsWith('stencil-tenada')) return 24 * Math.max(2, thickness);
  if (font.startsWith('stencil')) return (font === 'stencil-sign' ? 15 : 21) * Math.max(2, thickness);
  const rows = font === 'pixel' ? 5 : 7;
  return (rows * 2 - 1) * Math.max(2, thickness);
}
/** Rectilinear stencil strokes, rather than perforated pixels. A horizontal
 * material bridges cross the upper and lower counters of every glyph.
 * Legacy dot/pixel projects deliberately keep their original geometry. */
function continuousStencil(config: StencilText, thickness: number): HolePosition[] {
  const text = config.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (!text.trim() || text.length > 16 || [...text].some(c => !industrialAlphabet[c])) throw new Error('Utilisez 1 à 16 caractères : A–Z, chiffres, espace, point ou tiret.');
  if (![config.height, config.x, config.y].every(Number.isFinite) || !Number.isFinite(config.rotation)) throw new Error('Réglage de texte invalide.');
  const minimum = textMinimumHeight(thickness, config.font);
  if (config.height < minimum) throw new Error(`Hauteur minimale : ${minimum} mm pour cette police et cette épaisseur.`);
  const quarterTurn = normalizeTextRotation(config.rotation) === 90;
  const micro = isCompactStencil(config.font);
  const compact = micro || config.font === 'stencil-sign';
  const rowCount = compact ? 5 : 7, columnCount = compact ? 3 : 5;
  const bridge = Math.max(2, thickness), unit = config.height / rowCount;
  const aspect = config.font === 'stencil-condensed' ? .75 : config.font === 'stencil-wide' ? 1.25 : 1;
  const pitch = unit * (columnCount + 1) * aspect + bridge;
  const total = (text.length - 1) * pitch + columnCount * unit * aspect;
  const cuts: HolePosition[] = [];
  for (const [index, character] of [...text].entries()) {
    const rows = (compact ? alphabet[character] : industrialAlphabet[character]).split('/');
    // Serif bars are part of the actual cut geometry, not just the thumbnail.
    if (config.font === 'stencil-slab' && 'IHLMT'.includes(character)) {
      rows[0] = '11111'; rows[6] = '11111';
    }
    for (let row = 0; row < rowCount; row++) {
      for (let column = 0; column < columnCount;) {
        if (rows[row][column] !== '1') { column++; continue; }
        const start = column;
        while (column < columnCount && rows[row][column] === '1') column++;
        const left = index * pitch + start * unit * aspect - total / 2;
        const width = (column - start) * unit * aspect;
        const top = row * unit - config.height / 2;
        // Two bridge bands retain BOTH counters in B/8, not only the large
        // central counter in O. Adjacent rows meet to
        // form continuous cutouts; there is no grid of retained pixel gaps.
        const bandOffset = compact ? unit : 2 * unit;
        // Les nouveaux dessins gardent chaque portion de trait >= unit - bridge/2.
        // À H = 8 × bridge et 5 rangées, cette portion vaut au moins 1,1 × bridge.
        const bands = micro ? [-config.height / 2 + unit, -config.height / 2 + 4 * unit]
          : character === '4' ? [-bandOffset, 0, bandOffset] : [-bandOffset, bandOffset];
        let intervals: number[][] = [[top, top + unit]];
        for (const band of bands) intervals = intervals.flatMap(([low, high]) =>
          [[low, Math.min(high, band - bridge / 2)], [Math.max(low, band + bridge / 2), high]].filter(([a, b]) => b > a));
        for (const [low, high] of intervals) {
          if (high - low < 1e-8) continue;
          const dx = left + width / 2, dy = (low + high) / 2;
          cuts.push({ dist: config.x + (quarterTurn ? -dy : dx), offset: config.y + (quarterTurn ? dx : dy),
            shape: 'rect', length: quarterTurn ? high - low : width,
            width: quarterTurn ? width : high - low, cornerRadius: 0, textCutout: true });
        }
      }
    }
  }
  // Coalesce aligned strokes before CAD subtraction: adjacent rectangles
  // should be one cut, not coincident faces or visible raster seams.
  const merged: HolePosition[] = [];
  for (const cut of cuts) {
    const vertical = !quarterTurn;
    const previous = merged.find(other => vertical
      ? Math.abs(other.dist - cut.dist) < 1e-8 && Math.abs(other.length! - cut.length!) < 1e-8
        && Math.abs(other.offset + other.width! / 2 - (cut.offset - cut.width! / 2)) < 1e-8
      : Math.abs(other.offset - cut.offset) < 1e-8 && Math.abs(other.width! - cut.width!) < 1e-8
        && Math.abs(other.dist - other.length! / 2 - (cut.dist + cut.length! / 2)) < 1e-8);
    if (!previous) { merged.push({ ...cut }); continue; }
    if (vertical) {
      const low = previous.offset - previous.width! / 2, high = cut.offset + cut.width! / 2;
      previous.offset = (low + high) / 2; previous.width = high - low;
    } else {
      const low = cut.dist - cut.length! / 2, high = previous.dist + previous.length! / 2;
      previous.dist = (low + high) / 2; previous.length = high - low;
    }
  }
  const styled = micro ? styleCompactCuts(merged, config.font!, thickness) : merged;
  return rotateStencilCuts(styled, config.rotation - (quarterTurn ? 90 : 0), config.x, config.y);
}
export function stencilCells(config: StencilText, thickness: number): HolePosition[] {
  if (config.font && !STENCIL_FONTS.some(item => item.id === config.font)) throw new Error('Police stencil inconnue.');
  if (config.font?.startsWith('stencil-google-') || config.font?.startsWith('stencil-tenada') || config.font === 'stencil-sunfonts' || config.font === 'stencil-butler') {
    const glyphs = getGoogleStencilGlyphs(config.font!) ?? (config.font === 'stencil-sunfonts' ? SUNFONTS_GLYPHS : config.font === 'stencil-butler' ? BUTLER_GLYPHS : TENADA_GLYPHS);
    const text = config.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (!text.trim() || text.length > 16 || [...text].some(c => !glyphs[c])) throw new Error('Utilisez 1 à 16 caractères : A–Z, chiffres, espace, point ou tiret.');
    if (![config.height, config.x, config.y].every(Number.isFinite) || !Number.isFinite(config.rotation)) throw new Error('Réglage de texte invalide.');
    if (config.height < textMinimumHeight(thickness, config.font)) throw new Error(`Hauteur minimale : ${textMinimumHeight(thickness, config.font)} mm pour cette police et cette épaisseur.`);
    const aspect = config.font.endsWith('condensed') ? .8 : config.font.endsWith('wide') ? 1.2 : 1;
    let cursor = 0;
    const paths = [...text].flatMap(c => {
      const glyph = glyphs[c];
      const paths = glyph.contours.map(ps => ps.map(([x, y]) => ({ x: (x * config.height + cursor) * aspect, y: y * config.height })));
      cursor += glyph.advance * config.height + Math.max(2, thickness);
      return paths;
    });
    const all = paths.flat(), left = Math.min(...all.map(p => p.x)), right = Math.max(...all.map(p => p.x));
    const top = Math.min(...all.map(p => p.y)), bottom = Math.max(...all.map(p => p.y));
    return paths.map(ps => {
      const points = ps.map(p => { const x = p.x - (left + right) / 2, y = p.y - (top + bottom) / 2;
        return rotateTextPoint(x, y, config.rotation); });
      const lo = Math.min(...points.map(p => p.x)), hi = Math.max(...points.map(p => p.x));
      const min = Math.min(...points.map(p => p.y)), max = Math.max(...points.map(p => p.y));
      return { dist: config.x + (lo + hi) / 2, offset: config.y + (min + max) / 2, shape: 'rect', length: hi - lo, width: max - min, textCutout: true,
        contour: points.map(p => ({ x: p.x - (lo + hi) / 2, y: p.y - (min + max) / 2 })) };
    });
  }
  if (config.font?.startsWith('stencil')) return continuousStencil(config, thickness);
  const text = config.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const font = config.font ?? 'pixel';
  if (!STENCIL_FONTS.some(item => item.id === font)) throw new Error('Police stencil inconnue.');
  const glyphs = font === 'pixel' ? alphabet : industrialAlphabet;
  const rows = font === 'pixel' ? 5 : 7, columns = font === 'pixel' ? 3 : 5;
  if (!text.trim() || text.length > 16 || [...text].some(c => !alphabet[c])) throw new Error('Utilisez 1 à 16 caractères : A–Z, chiffres, espace, point ou tiret.');
  if (![config.height, config.x, config.y].every(Number.isFinite) || !Number.isFinite(config.rotation)) throw new Error('Réglage de texte invalide.');
  if (config.height < textMinimumHeight(thickness, font)) throw new Error(`Hauteur minimale : ${textMinimumHeight(thickness, font)} mm pour cette police et cette épaisseur.`);
  const bridge = Math.max(2, thickness);
  const cell = (config.height - (rows - 1) * bridge) / rows;
  const pitch = cell + bridge;
  const totalWidth = (text.length * (columns + 1) - 1) * pitch - bridge;
  const quarterTurn = normalizeTextRotation(config.rotation) === 90;
  const cuts = [...text].flatMap((character, index) => glyphs[character].split('/').flatMap((row, y) => [...row].flatMap((bit, x) => {
    if (bit !== '1') return [];
    const dx = (index * (columns + 1) + x) * pitch + cell / 2 - totalWidth / 2;
    const dy = y * pitch + cell / 2 - config.height / 2;
    return [{ dist: config.x + (quarterTurn ? -dy : dx), offset: config.y + (quarterTurn ? dx : dy),
      shape: font === 'dots' ? 'round' as const : 'square' as const, diam: cell, cornerRadius: 0, textCutout: true }];
  })));
  return rotateStencilCuts(cuts, config.rotation - (quarterTurn ? 90 : 0), config.x, config.y);
}

/** Recheck after thickness/dimension edits; never silently move or resize text. */
export function stencilTextIssue(state: SheetMetalState, legId: string): string | null {
  const leg = state.legs.find(item => item.id === legId);
  if (!leg) return null;
  for (const config of getStencilTexts(leg, legId)) try {
    const next = applyStencilText(state, legId, config, config.id);
    const signature = (holes: HolePosition[]) => holes.filter(h => h.textCutout && (!config.id || h.textBlockId === config.id)).map(h => `${h.shape}:` + [h.dist, h.offset, h.diam ?? 0, h.length ?? 0, h.width ?? 0].map(v => v.toFixed(3)).join(':') + JSON.stringify(h.contour ?? [])).join('|');
    if (signature(leg.holePositions ?? []) !== signature(next.legs.find(item => item.id === legId)!.holePositions ?? [])) return 'Les dimensions ou l’épaisseur ont changé : mettez le texte à jour.';
  } catch (error) { return (error as Error).message; }
  return null;
}
export function applyStencilText(state: SheetMetalState, legId: string, config: StencilText | null, blockId = config?.id): SheetMetalState {
  return applyStencilCells(state, legId, config, config ? stencilCells(config, state.thickness) : [], blockId);
}

/** Prepare immutable local outlines once per gesture geometry. Translation
 * still runs every contour, edge, bend and existing-hole placement check. */
export function createStencilPlacementValidator(state: SheetMetalState, legId: string, config: StencilText) {
  const local = stencilCells({ ...config, x: 0, y: 0 }, state.thickness);
  return (next: StencilText): SheetMetalState => {
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) throw new Error('Réglage de texte invalide.');
    if (next.text !== config.text || next.font !== config.font || next.height !== config.height || next.rotation !== config.rotation)
      return applyStencilText(state, legId, next);
    return applyStencilCells(state, legId, next, local.map(cell => ({ ...cell, dist: cell.dist + next.x, offset: cell.offset + next.y })));
  };
}

function applyStencilCells(state: SheetMetalState, legId: string, config: StencilText | null, prepared: HolePosition[], requestedBlockId = config?.id): SheetMetalState {
  const index = state.legs.findIndex(leg => leg.id === legId);
  const leg = state.legs[index];
  if (!leg || index > state.bendCount) throw new Error('Choisissez une aile visible.');
  if (config) {
    const issue = textAvailabilityIssue(state);
    if (issue) throw new Error(issue);
  }
  const blockId = requestedBlockId ?? (leg.cutText ? `legacy-${legId}` : undefined);
  const allExisting = explicitHoles(leg, state);
  // A null id retains the historical "clear all text on this wing" behavior.
  const existing = allExisting.filter(hole => !hole.textCutout || (blockId ? hole.textBlockId !== blockId && !(hole.textBlockId == null && leg.cutText && blockId === `legacy-${legId}`) : false));
  const cells = config ? prepared.map(cell => ({ ...cell,
    textBlockId: blockId,
    // Terminal wing distances run opposite to the developed drawing X axis.
    dist: index === state.bendCount ? 2 * config.x - cell.dist : cell.dist,
    // Distances on the terminal wing are reversed, but local cutter X follows
    // rotationAngle (the developed axis), not the inward distance direction.
    // Mirroring the contour here reflected each letter after validation.
    contour: cell.contour,
  })) : [];
  if (cells.length + existing.length > 400) throw new Error('Trop de découpes : raccourcissez le texte.');
  if (cells.length) {
    const margin = textSafetyMargin(state.thickness);
    const radii = cells.map(c => ({ c, rx: (c.length ?? c.diam!) / 2, rz: (c.width ?? c.diam!) / 2 }));
    const low = Math.min(...radii.map(({ c, rx }) => c.dist - rx));
    const high = Math.max(...radii.map(({ c, rx }) => c.dist + rx));
    const bottom = Math.min(...radii.map(({ c, rz }) => c.offset - rz));
    const top = Math.max(...radii.map(({ c, rz }) => c.offset + rz));
    if (low < margin || high > leg.length - margin || bottom < margin || top > state.width - margin)
      throw new Error(`Le bloc texte doit rester entièrement dans la pièce avec une marge de ${margin} mm.`);
    if (state.blankShape && !blankTextBlockAllowed(state, index, (low + high) / 2, (bottom + top) / 2, (high - low) / 2 + margin, (top - bottom) / 2 + margin))
      throw new Error('Le bloc texte et sa marge dépassent le contour de cette forme.');
  }
  // Check the entire block as well as individual cuts: a bridge or a space
  // must not disguise letters spanning a bend's deformation zone.
  if (cells.length && state.bendCount > 0) {
    const start = index > 0 && index < state.bendCount ? getHoleBendClearance(state.thickness) : 0;
    const end = leg.length - getHoleBendClearance(state.thickness);
    const low = Math.min(...cells.map(c => c.dist - (c.length ?? c.diam!) / 2));
    const high = Math.max(...cells.map(c => c.dist + (c.length ?? c.diam!) / 2));
    if (low <= start + 1e-6 || high >= end - 1e-6)
      throw new Error('Le bloc de texte touche une zone de pli. Déplacez-le entièrement hors de cette zone.');
  }
  for (const cell of cells) {
    const cutLeg = { ...leg, holeShape: cell.shape, holeDiam: cell.diam, holeLength: cell.length, holeWidth: cell.width };
    const { rx, rz } = getHoleRadii(cutLeg);
    const b = getHoleConstraints(cutLeg, state.thickness, state.width, state.bendCount > 0, undefined, undefined, undefined, state.bendCount > 0, index > 0 && index < state.bendCount);
    const edge = Math.max(2, state.thickness);
    if (!b.isFeasible || cell.dist < Math.max(b.minDist, rx + edge) || cell.dist > Math.min(b.maxDist, leg.length - rx - edge)
      || cell.offset < rz + edge || cell.offset > state.width - rz - edge
      || (state.blankShape && !blankHoleAllowed(state, index, cell.dist, cell.offset, rx + edge, rz + edge)))
      throw new Error('Le texte dépasse la pièce ou empiète sur une zone de pli : réduisez-le ou déplacez-le.');
    if (existing.some(hole => {
      const r = getHoleRadii({ ...leg, holeShape: hole.shape, holeDiam: hole.diam, holeLength: hole.length, holeWidth: hole.width, holeOrientation: hole.orientation });
      return Math.abs(cell.dist - hole.dist) < r.rx + rx + edge && Math.abs(cell.offset - hole.offset) < r.rz + rz + edge;
    })) throw new Error('Le texte est trop proche d’une autre découpe.');
  }
  const holes = [...existing, ...cells];
  const prior = getStencilTexts(leg, legId).filter(item => item.id !== blockId && !(item.id?.startsWith('legacy-') && blockId === item.id));
  const nextTexts = config ? [...prior, { ...config, id: blockId }] : blockId ? prior : [];
  return { ...state, legs: state.legs.map((item, i) => i !== index ? item : { ...item, cutTexts: nextTexts.length ? nextTexts : undefined,
    // Keep the legacy field populated for old consumers and old shared links.
    cutText: nextTexts[0], hasHole: holes.length > 0, holePositions: holes, holePattern: undefined }) };
}
