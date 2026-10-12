import { jsPDF } from 'jspdf';
import { isShapedBlank, flatBlankDefinition } from './flatBlank.ts';
import { sampleBlank, blankInnerContours } from './blankGeometry.ts';
import { blankBendPlan, blankHoleCenter } from './formedBlank.ts';
import { createProjectQr } from './projectQr.ts';
import { STENCIL_FONTS } from './stencilText.ts';
import {
  DEFAULT_FINISH, SHEET_FINISHES, calculateUnfoldedLength, generateSheetProfile,
  getFlatCornerEnds, getLegPatternPositions,
} from './sheetGeometry.ts';
import type { SheetMetalState, LegConfig } from './sheetGeometry.ts';

export type GrainDirection = 'length' | 'width';
export interface DrawingView {
  image: string;
  widthMm: number;
  heightMm: number;
  frame: { x: number; y: number; width: number; height: number };
  faceMarkers?: { face: 'F1' | 'F2'; wing: string; x: number; y: number; grainEnd: { x: number; y: number } }[];
}
export interface DrawingViews {
  front: DrawingView; top: DrawingView; right: DrawingView; isometric: DrawingView;
}
export interface DrawingOptions { grainDirection?: GrainDirection; date?: Date; views?: DrawingViews; projectLink?: string; }
type Point = { x: number; y: number };
const PINK = '#99294b';
const INK = '#202935';
const GREY = '#647080';
const mm = (n: number) => Number(n.toFixed(2)).toString().replace('.', ',');
const familyName = { Steel: 'Acier', Stainless: 'Inox', Aluminum: 'Aluminium' };

export function getExportBaseName(state: SheetMetalState): string {
  const finish = SHEET_FINISHES[state.finish || DEFAULT_FINISH[state.material]];
  const name = finish.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '');
  return `Tole_${state.bendCount}Plis_${state.material}_${name}_${calculateUnfoldedLength(state)}x${state.width}x${state.thickness}mm`;
}

/** Uses the same local origins and resolved hole instances as the STEP/viewer.
 * The final wing's X axis is reversed by generateSheetProfile, not guessed
 * from its position in the chain. No developed blank is used for drilling. */
export function createDrawingModel(state: SheetMetalState) {
  if (![state.width, state.thickness, ...state.legs.slice(0, state.bendCount + 1).map(l => l.length)]
    .every(n => Number.isFinite(n) && n > 0)) throw new Error('Dimensions du plan invalides.');
  const profile = generateSheetProfile(state);
  const cornerEnds = getFlatCornerEnds(state, profile.legTransforms);
  let number = 0;
  const wings = profile.legTransforms.map((transform, index) => {
    const leg = state.legs[index];
    const straightLength = Math.hypot(transform.tip.x - transform.bendStart.x, transform.tip.y - transform.bendStart.y);
    const corners = { nearLeft: 0, nearRight: 0, farLeft: 0, farRight: 0 };
    for (const end of cornerEnds.filter(e => e.legTransform.index === index)) {
      const near = Math.hypot(end.legTransform.tip.x - transform.tip.x, end.legTransform.tip.y - transform.tip.y) < 0.01;
      corners[near ? 'nearLeft' : 'farLeft'] = end.sideRadii.left;
      corners[near ? 'nearRight' : 'farRight'] = end.sideRadii.right;
    }
    const holes = leg.hasHole ? getLegPatternPositions(state, index, leg).map(position => {
      const definition: LegConfig = {
        ...leg, holeShape: position.shape || leg.holeShape || 'round',
        holeDiam: position.diam ?? leg.holeDiam,
        holeLength: position.length ?? leg.holeLength,
        holeWidth: position.width ?? leg.holeWidth,
        holeOrientation: position.orientation || leg.holeOrientation,
        holeCornerRadius: position.cornerRadius ?? leg.holeCornerRadius,
        holeContour: position.contour,
      };
      return { number: position.textCutout ? 0 : ++number, position, definition };
    }) : [];
    return { leg, transform, straightLength, corners, holes, reversed: index === state.bendCount };
  });
  return { profile, wings, holeCount: number };
}

/** Unroll the actual straight faces and insert neutral-axis bend allowances.
 * Never concatenate exterior wing lengths: that would move the holes. The
 * terminal STEP datum runs backwards and must be reversed in this global frame.
 * K is indicative, not an atelier-specific bend calibration. */
export function createFlatDrawingModel(state: SheetMetalState) {
  const model = createDrawingModel(state);
  if (state.blankShape) {
    const plan = blankBendPlan(state);
    const wings = model.wings.map((wing, index) => {
      const segment = plan.wings[index];
      const holes = wing.holes.map(hole => {
        const center = blankHoleCenter(state, index, hole.position.dist, hole.position.offset);
        return { ...hole, wing: wing.leg.id, center, contour: getDrawingHoleContour(hole.definition).map(p => ({
          // Text contours already follow the developed drawing axis. Reverse
          // the terminal-wing datum, not the handedness of its letters.
          x: center.x + (wing.reversed && !hole.position.textCutout ? -p.x : p.x), y: center.y + p.y })) };
      });
      return { ...wing, straightLength: segment.length, start: segment.start, end: segment.end, holes };
    });
    return { wings, folds: plan.bands.map(band => ({ number: band.index + 1, start: band.start, end: band.end, center: band.position,
      angle: band.angle * 180 / Math.PI, toward: band.direction === 1 ? 'F1' as const : 'F2' as const })),
      holes: wings.flatMap(wing => wing.holes), length: plan.frame.length, width: plan.frame.width,
      radius: plan.thickness, kFactor: .5, corners: { startLeft: 0, startRight: 0, endLeft: 0, endRight: 0 }, outline: plan.frame.outline,
      innerContours: blankInnerContours(plan.frame.definition).map(points => points.map(plan.frame.project)) };
  }
  const radius = Math.max(1, state.thickness);
  const kFactor = 0.4;
  let cursor = 0;
  const folds: { number: number; start: number; end: number; center: number; angle: number; toward: 'F1' | 'F2' }[] = [];
  const wings = model.wings.map((wing, index) => {
    const start = cursor;
    const end = start + wing.straightLength;
    const holes = wing.holes.map(hole => ({
      ...hole, wing: wing.leg.id,
      center: { x: start + (wing.reversed ? wing.straightLength - hole.position.dist : hole.position.dist), y: hole.position.offset },
      contour: getDrawingHoleContour(hole.definition).map(p => ({
        x: start + (wing.reversed ? wing.straightLength - hole.position.dist : hole.position.dist)
          + (wing.reversed && !hole.position.textCutout ? -p.x : p.x),
        y: hole.position.offset + p.y,
      })),
    }));
    cursor = end;
    if (index < state.bendCount) {
      const bend = state.bends[index];
      const rawAngle = bend?.angle ?? 90;
      const angle = Math.max(15, Math.min(165, Number.isNaN(rawAngle) ? 90 : Math.abs(rawAngle)));
      const allowance = angle * Math.PI / 180 * radius * (1 + kFactor);
      folds.push({ number: index + 1, start: cursor, end: cursor + allowance, center: cursor + allowance / 2,
        angle, toward: rawAngle < 0 || bend?.direction === -1 ? 'F2' : 'F1' });
      cursor += allowance;
    }
    return { ...wing, start, end, holes };
  });
  const first = wings[0], last = wings[wings.length - 1];
  const corners = {
    startLeft: first.reversed ? first.corners.farLeft : first.corners.nearLeft,
    startRight: first.reversed ? first.corners.farRight : first.corners.nearRight,
    endLeft: last.reversed ? last.corners.nearLeft : last.corners.farLeft,
    endRight: last.reversed ? last.corners.nearRight : last.corners.farRight,
  };
  const outline = isShapedBlank(state) && state.bendCount === 0 ? sampleBlank(flatBlankDefinition(state))
    : roundedContour(cursor, state.width, [corners.endLeft, corners.endRight, corners.startRight, corners.startLeft])
      .map(p => ({ x: cursor / 2 + p.x, y: state.width / 2 + p.y }));
  return { wings, folds, holes: wings.flatMap(w => w.holes), length: cursor, width: state.width, radius, kFactor, corners, outline };
}

/** Actual cut contour in the wing frame. Octagon diameter is across flats,
 * oblong orientation swaps its axes; corner radii apply only to square/rect. */
export function getDrawingHoleContour(leg: LegConfig): Point[] {
  const shape = leg.holeShape || 'round';
  if (leg.holeContour?.length) return leg.holeContour;
  const d = leg.holeDiam;
  if (shape === 'round' || shape === 'octagonal') {
    const count = shape === 'round' ? 64 : 8;
    const r = shape === 'round' ? d / 2 : d / 2 / Math.cos(Math.PI / 8);
    return Array.from({ length: count }, (_, i) => {
      const a = i * 2 * Math.PI / count + (shape === 'octagonal' ? Math.PI / 8 : 0);
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }
  let length = shape === 'square' ? d : leg.holeLength || d;
  let width = shape === 'square' ? d : leg.holeWidth || d;
  if (shape === 'oblong' && leg.holeOrientation === 'along_width') [length, width] = [width, length];
  const radius = shape === 'oblong' ? Math.min(length, width) / 2
    : Math.min(Math.max(0, leg.holeCornerRadius || 0), length / 2, width / 2);
  return roundedContour(length, width, [radius, radius, radius, radius]);
}

function roundedContour(width: number, height: number, radii: number[]): Point[] {
  const centers = [[width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2], [-width / 2, -height / 2]];
  return centers.flatMap(([x, y], corner) => {
    const radius = Math.min(radii[corner], width / 2, height / 2);
    const cx = x - Math.sign(x) * radius;
    const cy = y - Math.sign(y) * radius;
    return Array.from({ length: radius ? 17 : 1 }, (_, i) => {
      const angle = (-Math.PI / 2 + corner * Math.PI / 2) + (radius ? i / 16 * Math.PI / 2 : 0);
      return { x: radius ? cx + radius * Math.cos(angle) : x, y: radius ? cy + radius * Math.sin(angle) : y };
    });
  });
}

function holeDescription(leg: LegConfig) {
  switch (leg.holeShape || 'round') {
    case 'round': return `Rond Ø${mm(leg.holeDiam)}`;
    case 'octagonal': return `Octogone ${mm(leg.holeDiam)} sur plats`;
    case 'square': return `Carré ${mm(leg.holeDiam)} x ${mm(leg.holeDiam)} / R${mm(leg.holeCornerRadius || 0)}`;
    case 'rect': return `Rectangle ${mm(leg.holeLength || leg.holeDiam)} x ${mm(leg.holeWidth || leg.holeDiam)} / R${mm(leg.holeCornerRadius || 0)}`;
    case 'oblong': return `Oblong ${mm(leg.holeLength || leg.holeDiam)} x ${mm(leg.holeWidth || leg.holeDiam)} / axe ${leg.holeOrientation === 'along_width' ? 'Y' : 'X'}`;
  }
}

export function generateTechnicalDrawing(state: SheetMetalState, options: DrawingOptions = {}): Blob {
  const { profile, wings, holeCount } = createDrawingModel(state);
  const finishId = state.finish || DEFAULT_FINISH[state.material];
  const finish = SHEET_FINISHES[finishId];
  const material = `${familyName[state.material]} ${finish.name} - ${finish.reference}`;
  const tread = ['steel-larme', 'aluminum-larme', 'stainless-antislip'].includes(finishId);
  const brushed = finishId === 'stainless-brushed';
  const grain = options.grainDirection || 'length';
  const date = (options.date || new Date()).toLocaleDateString('fr-FR');
  const ref = getExportBaseName(state);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Plan technique - ${ref}`, subject: 'Repérage face de finition, dos, plis et perçages', author: 'STEPbySTEP / John Steel' });
  // Keep stable face identifiers in geometry; translate only workshop-facing labels.
  const faceLabels = (value: string) => value.replace(/\bF1\b/g, 'Face de finition').replace(/\bF2\b/g, 'Dos');
  const text = (value: string, x: number, y: number, size = 9, color = INK, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color); doc.text(faceLabels(value), x, y);
  };
  const paragraph = (value: string, x: number, y: number, width: number, size = 9, color = INK) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(color);
    const lines = doc.splitTextToSize(faceLabels(value), width) as string[];
    doc.text(lines, x, y, { lineHeightFactor: 1.35 });
    return y + lines.length * size * 0.3528 * 1.35;
  };
  const line = (a: Point, b: Point, color = INK, weight = 0.2) => {
    doc.setDrawColor(color); doc.setLineWidth(weight); doc.line(a.x, a.y, b.x, b.y);
  };
  const polygon = (points: Point[], fill?: string) => {
    if (!points.length) return;
    doc.setDrawColor(INK); doc.setLineWidth(0.22);
    if (fill) doc.setFillColor(fill);
    doc.lines(points.slice(1).map((p, i) => [p.x - points[i].x, p.y - points[i].y]), points[0].x, points[0].y, [1, 1], fill ? 'FD' : 'S', true);
  };
  const arrow = (a: Point, b: Point, color = PINK) => {
    line(a, b, color, 0.35);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    for (const sign of [-1, 1]) line(b, { x: b.x - 2 * Math.cos(angle + sign * 0.45), y: b.y - 2 * Math.sin(angle + sign * 0.45) }, color, 0.35);
  };
  const horizontalDimension = (x1: number, x2: number, fromY: number, y: number, label: string) => {
    line({ x: x1, y: fromY }, { x: x1, y: y + 2 }, GREY, 0.15);
    line({ x: x2, y: fromY }, { x: x2, y: y + 2 }, GREY, 0.15);
    line({ x: x1, y }, { x: x2, y }, GREY, 0.15);
    for (const x of [x1, x2]) line({ x: x - 1, y: y + 1 }, { x: x + 1, y: y - 1 }, GREY);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(INK); doc.text(label, (x1 + x2) / 2, y - 2, { align: 'center' });
  };
  const header = (subtitle: string) => {
    const shared = options.projectLink && doc.getCurrentPageInfo().pageNumber === 1;
    text('STEPbySTEP', 12, 16, 18, INK, true);
    text('PLAN TECHNIQUE / REPÉRAGE ATELIER', 80, 15, 12, INK, true);
    text(subtitle, 80, 22, 9, GREY);
    line({ x: 12, y: 27 }, { x: shared ? 240 : 285, y: 27 }, GREY);
    text(material, 12, 35, 11, INK, true);
    text(`Épaisseur ${mm(state.thickness)} mm   |   Largeur ${mm(state.width)} mm   |   ${state.bendCount} pli(s)   |   ${holeCount} trou(s)`, 12, 42, 9);
    if (shared) {
      const qr = createProjectQr(options.projectLink!);
      if (qr) {
        const scale = 38 / qr.size;
        doc.setFillColor('#ffffff'); doc.rect(247, 5, 38, 38, 'F');
        doc.setFillColor('#000000');
        for (const cell of qr.rectangles) {
          doc.rect(247 + cell.x * scale, 5 + cell.y * scale, cell.width * scale, scale, 'F');
        }
        doc.link(247, 5, 38, 38, { url: options.projectLink! });
      }
      doc.setTextColor(PINK); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      doc.textWithLink(qr ? 'Scanner pour ouvrir le projet' : 'Ouvrir le projet (lien)', 247, 47, { url: options.projectLink! });
    }
  };
  const tableHeader = (labels: string[], xs: number[], y: number) => {
    doc.setFillColor('#edf0f3'); doc.rect(12, y - 5, 273, 8, 'F');
    labels.forEach((label, index) => text(label, xs[index], y, 8, INK, true));
  };
  if (options.views) {
    header('Vues d’ensemble - géométrie finale et aspect de la matière');
    const view = (label: string, image: DrawingView, x: number, y: number, dimensioned: boolean) => {
      text(label, x, y, 9, INK, true);
      const ix = x + 3, iy = y + 3, iw = 108, ih = iw * 900 / 1600;
      doc.addImage(image.image, 'PNG', ix, iy, iw, ih, undefined, 'FAST');
      if (image.faceMarkers) for (const marker of image.faceMarkers) {
        const point = { x: ix + marker.x * iw, y: iy + marker.y * ih };
        const label = { x: Math.min(ix + iw - 38, point.x + 12), y: Math.max(iy + 5, point.y - 9) };
        line(point, label, PINK, 0.2);
        doc.setFillColor(PINK); doc.circle(point.x, point.y, 0.6, 'F');
        doc.setFillColor('#ffffff'); doc.rect(label.x + 0.5, label.y - 2.8, 38, 4, 'F');
        text(`${marker.face} / ${marker.wing}`, label.x + 1, label.y, 7, PINK, true);
        if (brushed && marker.face === 'F1') arrow(point, { x: ix + marker.grainEnd.x * iw, y: iy + marker.grainEnd.y * ih });
      }
      if (!dimensioned) return;
      const f = image.frame;
      const left = ix + f.x * iw, top = iy + f.y * ih;
      const right = left + f.width * iw, bottom = top + f.height * ih;
      horizontalDimension(left, right, bottom, iy + ih + 2, mm(image.widthMm));
      const dx = ix + iw + 5;
      line({ x: right, y: top }, { x: dx + 2, y: top }, GREY, 0.15);
      line({ x: right, y: bottom }, { x: dx + 2, y: bottom }, GREY, 0.15);
      line({ x: dx, y: top }, { x: dx, y: bottom }, GREY, 0.15);
      for (const sy of [top, bottom]) line({ x: dx - 1, y: sy + 1 }, { x: dx + 1, y: sy - 1 }, GREY);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(INK);
      doc.text(mm(image.heightMm), dx + 4, (top + bottom) / 2, { angle: 90, align: 'center' });
    };
    view('VUE DE FACE', options.views.front, 12, 53, true);
    view('VUE DE DESSUS', options.views.top, 152, 53, true);
    view('VUE DE CÔTÉ DROIT', options.views.right, 12, 125, true);
    view('VUE ISOMÉTRIQUE / MATIÈRE', options.views.isometric, 152, 125, false);
    text('Cotes d’encombrement en mm. Détails des plis et trous sur les pages suivantes.', 12, 195, 7, GREY);
    text('Face de finition / Dos. Aspect de la matière indicatif.', 152, 195, 7, GREY);
    // The four-view sheet is only an overview. Local drilling coordinates,
    // bend definitions and F1 markers remain on the vector detail pages.
    doc.addPage();
  }
  header('Vue de profil et face de finition');
  text(`${state.bendCount ? 'PROFIL PLIÉ' : 'SECTION DE LA PLAQUE'} - FINITION REPÉRÉE EN ROSE`, 12, 55, 9, PINK, true);
  const { minX, maxX, minY, maxY } = profile.bounds;
  const scale = Math.min(145 / Math.max(1, maxX - minX), 80 / Math.max(1, maxY - minY));
  const ox = 22 + (145 - (maxX - minX) * scale) / 2;
  const oy = 69 + (80 - (maxY - minY) * scale) / 2;
  const project = (p: Point) => ({ x: ox + (p.x - minX) * scale, y: oy + (maxY - p.y) * scale });
  polygon(profile.pathPoints.map(project), '#e8ecf0');
  profile.treadFaceEdges.forEach(edge => line(project(edge.p1), project(edge.p2), PINK, 0.7));
  wings.forEach(({ transform }) => {
    const anchor = project({ x: transform.center.x + transform.normal.x * state.thickness / 2, y: transform.center.y + transform.normal.y * state.thickness / 2 });
    const badge = { x: anchor.x + transform.normal.x * 8, y: anchor.y - transform.normal.y * 8 };
    line(anchor, badge, PINK);
    doc.setFillColor('#ffffff'); doc.setDrawColor(PINK); doc.circle(badge.x, badge.y, 3.5, 'FD');
    doc.setFontSize(9); doc.setTextColor(PINK); doc.text(transform.id, badge.x, badge.y + 1.1, { align: 'center' });
  });
  horizontalDimension(ox, ox + (maxX - minX) * scale, oy + (maxY - minY) * scale, 163, `${mm(maxX - minX)} mm - encombrement profil`);
  text(`Hauteur du profil : ${mm(maxY - minY)} mm`, 22, 173, 9, GREY);
  text('Section sans représentation des perçages ni des coins arrondis.', 12, 185, 8, GREY);

  text('Face de finition', 183, 55, 10, PINK, true);
  let ny = paragraph(tread ? 'Relief larmé / antidérapant uniquement sur la Face de finition. Dos et chants lisses.'
    : brushed ? 'Brossage sur la Face de finition. Préserver ce sens sur toutes les ailes.'
    : 'Face de finition : face de référence du visualisateur. Dos : face opposée. Pour une finition une face, appliquer sur la Face de finition.', 183, 63, 100, 8);
  if (brushed) ny = paragraph(`Brossage ${grain === 'length' ? 'longitudinal (chaîne des ailes)' : 'transversal (largeur)'}. Flèche sur la vue à plat.`, 183, ny + 3, 100, 8);
  ny = paragraph('Cotes en mm. Les cotes font foi. Ailes vues côté Face de finition.', 183, ny + 3, 100, 8, GREY);
  ny = paragraph(`Rayon intérieur : ${mm(Math.max(1, state.thickness))} mm. Angle = rotation du pli (0° = à plat).`, 183, ny + 3, 100, 8, GREY);
  text('COTES EXTÉRIEURES DES AILES', 183, ny + 8, 9, INK, true);
  wings.forEach(({ leg }, i) => text(`${leg.id} : ${mm(leg.length)} mm`, 183, ny + 16 + i * 6, 9));
  const bendY = ny + 21 + wings.length * 6;
  text('PLIS / FACE DE FINITION', 183, bendY, 9, INK, true);
  state.bends.slice(0, state.bendCount).forEach((bend, i) => {
    const toward = bend.angle < 0 || bend.direction === -1 ? 'vers F2' : 'vers F1';
    text(`${i + 1} : ${wings[i].leg.id}-${wings[i + 1].leg.id} / ${mm(Math.max(15, Math.min(165, Math.abs(bend.angle))))}° / ${toward}`, 183, bendY + 8 + i * 6, 8);
  });
  if (!state.bendCount) text('Aucun pli - plaque plane.', 183, bendY + 8, 9);

  const flat = createFlatDrawingModel(state);
  doc.addPage(); header('Pièce entière à plat - Face de finition / repère X-Y commun');
  text('VUE À PLAT / TOUTES LES AILES', 12, 55, 9, PINK, true);
  const s = Math.min(196 / flat.length, 66 / flat.width);
  const x0 = 25 + (196 - flat.length * s) / 2;
  const y0 = 68 + (66 - flat.width * s) / 2;
  const w = flat.length * s, h = flat.width * s;
  const flatPoint = (p: Point) => ({ x: x0 + p.x * s, y: y0 + p.y * s });
  const outline = flat.outline.map(flatPoint);
  polygon(outline, '#f7f8fa');
  if ('innerContours' in flat) for (const contour of flat.innerContours) polygon(contour.map(flatPoint), '#ffffff');
  if (state.blankShape === 'washer') text(`Rondelle : diamètre extérieur ${mm(state.blankLength!)} mm / intérieur ${mm(state.blankInnerDiameter ?? state.blankLength! / 2)} mm`, 12, 61, 8);
  if (state.blankShape === 'star') text(`Étoile : Ø ${mm(state.blankLength!)} mm / ${state.blankBranchCount ?? 5} branches / hauteur radiale ${mm(state.blankBranchHeight ?? state.blankLength! * .275)} mm`, 12, 61, 8);
  if (state.blankShape === 'gear') text(`Roue crantée : Ø ${mm(state.blankLength!)} / ${state.blankToothCount ?? 16} dents / hauteur ${mm(state.blankToothHeight ?? state.blankLength! * .08)} mm / ${state.blankInnerDiameter ? `trou Ø ${mm(state.blankInnerDiameter)} mm` : 'sans trou central'}`, 12, 61, 8);
  // Radius leaders point to the actual 45-degree point of each rounded corner.
  // Keep labels outside the blank, away from holes and bend-zone shading.
  for (const [key, radius] of Object.entries(flat.corners)) {
    if (radius <= 0) continue;
    const right = key.startsWith('end');
    const bottom = key.endsWith('Right');
    const inset = Math.min(radius, flat.length / 2, flat.width / 2) * (1 - Math.SQRT1_2) * s;
    const corner = { x: right ? x0 + w - inset : x0 + inset,
      y: bottom ? y0 + h - inset : y0 + inset };
    const label = { x: right ? Math.min(215, x0 + w + 2) : Math.max(12, x0 - 18),
      y: bottom ? y0 + h + 9 : y0 - 9 };
    line(corner, { x: label.x + 7, y: label.y + (bottom ? -2 : 2) }, GREY, 0.15);
    doc.setFillColor(INK); doc.circle(corner.x, corner.y, 0.4, 'F');
    text(`R ${mm(radius)} mm`, label.x, label.y, 8, INK, true);
  }
  // Clip to the rounded blank itself, including cuts crossing a free edge.
  doc.saveGraphicsState();
  doc.lines(outline.slice(1).map((p, i) => [p.x - outline[i].x, p.y - outline[i].y]), outline[0].x, outline[0].y, [1, 1], null, true);
  doc.clip(); doc.discardPath();
  for (const fold of flat.folds) {
    doc.setFillColor('#f3dce4');
    doc.rect(x0 + fold.start * s, y0, (fold.end - fold.start) * s, h, 'F');
    doc.setLineDashPattern([1.5, 1], 0);
    line(flatPoint({ x: fold.center, y: 0 }), flatPoint({ x: fold.center, y: flat.width }), PINK, 0.22);
    doc.setLineDashPattern([], 0);
  }
  for (const hole of flat.holes) {
    polygon(hole.contour.map(flatPoint), '#ffffff');
    if (hole.position.textCutout) continue;
    const center = flatPoint(hole.center);
    line({ x: center.x - 1.2, y: center.y }, { x: center.x + 1.2, y: center.y }, GREY, 0.1);
    line({ x: center.x, y: center.y - 1.2 }, { x: center.x, y: center.y + 1.2 }, GREY, 0.1);
  }
  doc.restoreGraphicsState();
  // Number leaders sit outside their cutouts. Dense matrices use the table
  // rather than hundreds of illegible, overlapping numbers on the drawing.
  const ordinaryHoles = flat.holes.filter(hole => !hole.position.textCutout);
  if (ordinaryHoles.length <= 40) for (const hole of ordinaryHoles) {
    const center = flatPoint(hole.center);
    const radiusX = Math.max(...hole.contour.map(p => Math.abs(p.x - hole.center.x))) * s;
    const label = { x: Math.min(x0 + w + 4, center.x + radiusX + 2), y: center.y - 2 };
    line(center, label, GREY, 0.1);
    text(String(hole.number), label.x + 0.6, label.y, 7, PINK, true);
  }
  flat.wings.forEach(wing => text(wing.leg.id, x0 + (wing.start + wing.end) / 2 * s, y0 + h + 5, 8, PINK, true));
  let previousFoldX = -Infinity;
  for (const fold of flat.folds) {
    const fx = x0 + fold.center * s;
    if (fx - previousFoldX >= 6) {
      text(String(fold.number), fx, y0 - 3, 7, PINK, true);
      previousFoldX = fx;
    }
  }
  // The datum is the intersection of the theoretical start/width edges,
  // even when that corner is rounded and no metal exists at the origin.
  const origin = flatPoint({ x: 0, y: 0 });
  arrow(origin, { x: origin.x + 11, y: origin.y });
  arrow(origin, { x: origin.x, y: origin.y + 11 });
  text('O', origin.x - 4, origin.y - 2, 8, PINK);
  text('X', origin.x + 12, origin.y - 2, 8, PINK);
  text('Y', origin.x - 4, origin.y + 12, 8, PINK);
  horizontalDimension(x0, x0 + w, y0 + h + 6, 145, `${mm(flat.length)} mm - développé${state.bendCount ? ' indicatif' : ''}`);
  const dx = x0 - 7;
  for (const sy of [y0, y0 + h]) {
    line({ x: dx - 2, y: sy }, { x: x0 - 1, y: sy }, GREY, 0.15);
    line({ x: dx - 1, y: sy + 1 }, { x: dx + 1, y: sy - 1 }, GREY, 0.15);
  }
  line({ x: dx, y: y0 }, { x: dx, y: y0 + h }, GREY, 0.15);
  doc.setFontSize(8); doc.setTextColor(INK); doc.text(`${mm(flat.width)} mm`, dx - 2, y0 + h / 2, { angle: 90, align: 'center' });
  text('Face de finition', 233, 55, 10, PINK, true);
  let flatNoteY = paragraph(tread ? 'Face visible : relief larmé / antidérapant. F2 et chants lisses.'
    : brushed ? 'Face visible : brossage. Dos : face opposée.' : 'Face visible : Face de finition. Dos : face opposée.', 233, 64, 52, 8);
  if (brushed) {
    flatNoteY = paragraph(`Sens du brossage : ${grain === 'length' ? 'longueur (X)' : 'largeur (Y)'}.`, 233, flatNoteY + 4, 52, 8, PINK);
    const a = { x: 239, y: flatNoteY + 5 };
    arrow(a, { x: a.x + (grain === 'length' ? 26 : 0), y: a.y + (grain === 'width' ? 15 : 0) });
    flatNoteY += grain === 'width' ? 24 : 13;
  }
  if (flat.folds.length) {
    flatNoteY = paragraph('Rose : zone de pli. Pointillé : axe du pli.', 233, flatNoteY + 4, 52, 8, PINK);
    text('AXES / X DEPUIS O', 233, flatNoteY + 7, 8, INK, true);
    flat.folds.forEach((fold, index) => {
      const y = flatNoteY + 14 + index * 9;
      text(`${fold.number} : ${mm(fold.center)} / ${fold.angle}°`, 233, y, 8);
      text(`Vers ${faceLabels(fold.toward)}`, 233, y + 3.5, 7, GREY);
    });
  } else paragraph('Plaque plane : aucun pli.', 233, flatNoteY + 4, 52, 8, GREY);
  const radii = Object.entries(flat.corners).map(([key, radius]) => `${{ startLeft: 'X0/Y0', startRight: 'X0/Ymax', endLeft: 'Xmax/Y0', endRight: 'Xmax/Ymax' }[key]} : R${mm(radius)}`);
  text(`Coins : ${radii.join(' ; ')}`, 12, 155, 8, GREY);
  text('Centres des trous : X et Y depuis O, intersection théorique des bords. Repère unique pour toute la pièce.', 12, 162, 8, GREY);
  text(state.bendCount ? `Développé indicatif : Ri ${mm(flat.radius)} mm / K ${flat.kFactor}. À valider selon l’outillage atelier avant découpe.`
    : 'Plaque plane : aucune perte au pli. Les coordonnées se rapportent directement à la plaque.', 12, 169, 8, PINK);
  const xs = [15, 31, 158, 192, 229];
  const labels = ['N°', 'Découpe traversante / dimensions (mm)', 'X depuis O', 'Y depuis O', 'Aile'];
  tableHeader(labels, xs, 178);
  // Describe lettering once; its stencil cells remain drawn, but are not drill holes.
  const rows = ordinaryHoles.map(hole => [String(hole.number), holeDescription(hole.definition), mm(hole.center.x), mm(hole.center.y), hole.wing]);
  for (const wing of flat.wings) {
    const config = wing.leg.cutText;
    if (config) rows.push(['—', `${config.text} / ${STENCIL_FONTS.find(font => font.id === (config.font ?? 'pixel'))?.label} / H ${mm(config.height)} / ${config.rotation} deg.`, 'Voir dessin', 'Voir dessin', wing.leg.id]);
  }
  if (!rows.length) text('Aucun perçage sur la pièce.', 15, 189, 9, GREY);
  rows.forEach((row, i) => {
    if (i === 2 || (i > 2 && (i - 2) % 21 === 0)) {
      doc.addPage(); header('Perçages de la pièce entière - repère X-Y de la vue à plat');
      tableHeader(labels, xs, 58);
    }
    const rowY = i < 2 ? 187 + i * 7 : 68 + (i - 2) % 21 * 6;
    row.forEach((cell, index) => text(cell, xs[index], rowY, 8));
  });
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    line({ x: 12, y: 199 }, { x: 285, y: 199 }, GREY, 0.15);
    text(`${ref} | ${date}`, 12, 204, 7, GREY);
    doc.setFontSize(7); doc.text(`Cotes en mm - échelles adaptées - ${page} / ${pageCount}`, 285, 204, { align: 'right' });
  }
  return doc.output('blob');
}
