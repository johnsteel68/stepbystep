// Deterministic, procedural STEP (ISO-10303-21 AP214) file generator for sheet metal parts.
// Uses the shared fabrication constraints; these checks are not certification.
// Exports analytical closed solids with through-cutouts for all supported holes.

import { SheetMetalState, generateSheetProfile, checkSheetMetalFeasibility, SheetMetalFeasibilityReport, getFlatCornerRadii, getHoleRadii, getPatternPositions, constrainHolePosition, normalizeSheetThickness } from './sheetGeometry';
import { draw, drawRoundedRectangle, makeCylinder, Plane, setOC } from 'replicad';
import initOpenCascade from 'replicad-opencascadejs';
import openCascadeWasmUrl from 'replicad-opencascadejs/wasm?url';
import { exportStepAp214 } from './stepExport';
import { createRetryableInitializer } from './lifecycle';
import { isShapedBlank } from './flatBlank';
import { createFlatBlankSolid } from './flatBlankCad';
import { createFormedBlankSolid } from './formedBlankCad';
import { normalizeFormedBlank } from './formedBlank';

// Explicit Vite asset URL prevents the dev pre-bundler fetching HTML as WASM.
// Successful initialization is cached; failures release the cache for retry.
const ensureOpenCascade = createRetryableInitializer(async () => {
  const oc = await initOpenCascade({ locateFile: () => openCascadeWasmUrl });
  setOC(oc);
});

function getHoleContour2D(
  shape: 'round' | 'oblong' | 'square' | 'rect' | 'octagonal',
  diam: number,
  len: number,
  wid: number,
  orientation: 'along_length' | 'along_width' = 'along_length',
  outline?: { x: number; y: number }[]
): { du: number; dw: number }[] {
  if (outline?.length) return outline.map(p => ({ du: p.x, dw: p.y }));
  const points: { du: number; dw: number }[] = [];

  if (shape === 'square') {
    const s = Math.max(1, diam) / 2;
    points.push({ du: s, dw: s }, { du: -s, dw: s }, { du: -s, dw: -s }, { du: s, dw: -s });
    return points;
  }

  if (shape === 'rect') {
    const hl = Math.max(1, len) / 2;
    const hw = Math.max(1, wid) / 2;
    points.push({ du: hl, dw: hw }, { du: -hl, dw: hw }, { du: -hl, dw: -hw }, { du: hl, dw: -hw });
    return points;
  }

  if (shape === 'octagonal') {
    const d = Math.max(1, diam);
    const R = (d / 2) / Math.cos(Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4 + Math.PI / 8;
      points.push({ du: R * Math.cos(angle), dw: R * Math.sin(angle) });
    }
    return points;
  }

  if (shape === 'oblong') {
    const L = Math.max(2, orientation === 'along_length' ? len : wid);
    const W = Math.max(1, orientation === 'along_length' ? wid : len);
    const r = Math.min(W / 2, L / 2);
    const hs = Math.max(0.01, L - 2 * r) / 2;
    const steps = 6;
    // Demi-cercle 1
    for (let i = 0; i <= steps; i++) {
      const ang = -Math.PI / 2 + (Math.PI * i) / steps;
      if (orientation === 'along_length') {
        points.push({ du: hs + r * Math.cos(ang), dw: r * Math.sin(ang) });
      } else {
        points.push({ du: r * Math.sin(ang), dw: hs + r * Math.cos(ang) });
      }
    }
    // Demi-cercle 2
    for (let i = 0; i <= steps; i++) {
      const ang = Math.PI / 2 + (Math.PI * i) / steps;
      if (orientation === 'along_length') {
        points.push({ du: -hs + r * Math.cos(ang), dw: r * Math.sin(ang) });
      } else {
        points.push({ du: r * Math.sin(ang), dw: -hs + r * Math.cos(ang) });
      }
    }
    return points;
  }

  // Cercle régulier standard (16 segments polygonaux pour compatibilité B-Rep universelle)
  const R = Math.max(0.5, diam / 2);
  const numSteps = 16;
  for (let i = 0; i < numSteps; i++) {
    const ang = (2 * Math.PI * i) / numSteps;
    points.push({ du: R * Math.cos(ang), dw: R * Math.sin(ang) });
  }
  return points;
}

/**
 * Construit le chemin OCC d'un trou oblong avec deux vrais demi-cercles.
 *
 * Le contour polygonal reste utile pour les formes volontairement carrées ou
 * octogonales, mais il ne doit jamais être utilisé pour un oblong : une suite
 * de petits segments devient visible dans l'analyseur STEP et peut perturber
 * la découpe booléenne. Les arcs sont ici des entités analytiques OCC.
 */
function drawOblongHolePath(
  length: number,
  width: number,
  orientation: 'along_length' | 'along_width' = 'along_length',
): any {
  const L = Math.max(2, orientation === 'along_length' ? length : width);
  const W = Math.max(1, orientation === 'along_length' ? width : length);
  const radius = Math.min(W / 2, L / 2);
  const halfStraight = Math.max(0, L - 2 * radius) / 2;

  if (orientation === 'along_length') {
    return draw([-halfStraight, -radius])
      .lineTo([halfStraight, -radius])
      .threePointsArcTo([halfStraight, radius], [halfStraight + radius, 0])
      .lineTo([-halfStraight, radius])
      .threePointsArcTo([-halfStraight, -radius], [-halfStraight - radius, 0])
      .close();
  }

  return draw([-radius, -halfStraight])
    .lineTo([-radius, halfStraight])
    .threePointsArcTo([radius, halfStraight], [0, halfStraight + radius])
    .lineTo([radius, -halfStraight])
    .threePointsArcTo([-radius, -halfStraight], [0, -halfStraight - radius])
    .close();
}

/**
 * Découpe analytique d'un coin arrondi de l'extrémité développée.
 * `threePointsArc` reçoit des déplacements relatifs au point courant (et non
 * des coordonnées absolues), contrairement à `lineTo`. Garder ce tracé commun
 * évite que les exports 1 pli et multi-plis divergent du contour du visualiseur.
 */
function drawFlatCornerCutterPath(radius: number, outside: number, sideSign: 1 | -1): any {
  const arcMid = radius - radius / Math.sqrt(2);
  if (sideSign === -1) {
    // Parcours inverse pour conserver une normale de contour cohérente avec
    // le coin +1. OCC est plus fiable en booléen lorsque les deux outils ont
    // la même orientation, même si leurs coordonnées sont en miroir.
    return draw([-outside, -radius])
      .lineTo([0, -radius])
      .threePointsArc(
        radius,
        radius,
        arcMid,
        radius - arcMid,
      )
      .lineTo([radius, outside])
      .lineTo([-outside, outside]);
  }

  return draw([-outside, -sideSign * outside])
    .lineTo([radius, -sideSign * outside])
    .lineTo([radius, 0])
    .threePointsArc(
      -radius,
      sideSign * radius,
      arcMid - radius,
      sideSign * arcMid,
    )
    .lineTo([-outside, sideSign * radius]);
}

/**
 * Une seule source de vérité pour les perçages exportés. Les positions sont
 * calculées par aile, puis contraintes exactement comme dans le visualiseur.
 * Le dédoublonnage évite qu'une petite aile transforme plusieurs positions
 * paramétriques contraintes au même bord en une opération OCC instable.
 */
function getExportHolePositions(leg: any, width: number, state: SheetMetalState) {
  const seen = new Set<string>();
  const legIndex = state.legs.findIndex(item => item.id === leg.id);
  const hasBendAtStart = legIndex > 0 && legIndex < state.bendCount;
  return getPatternPositions(leg, width, leg.holePattern || state.holePattern, state.thickness, state.bendCount > 0, hasBendAtStart)
    .map((position) => ({ ...position, ...constrainHolePosition({ ...leg, ...getHoleDefinitionForPosition(leg, position) }, width, state.thickness, position.dist, position.offset, state.bendCount > 0, hasBendAtStart) }))
    .filter((position) => {
      const key = `${position.dist.toFixed(4)}:${position.offset.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getHoleDefinitionForPosition(leg: any, position: { shape?: any; diam?: number; length?: number; width?: number; orientation?: any; contour?: { x: number; y: number }[] }) {
  return {
    ...leg,
    holeShape: position.shape || leg.holeShape,
    holeDiam: position.diam ?? leg.holeDiam,
    holeLength: position.length ?? leg.holeLength,
    holeWidth: position.width ?? leg.holeWidth,
    holeOrientation: position.orientation || leg.holeOrientation,
    holeContour: position.contour,
  };
}

/**
 * Construit le contour de la section pliée avec des arcs OCC analytiques.
 * `generateSheetProfile` expose les mêmes repères pour l'affichage, mais son
 * `pathPoints` est volontairement échantillonné pour Three.js. Il ne faut pas
 * réutiliser cette polyligne pour le STEP : chaque point deviendrait une face
 * et le pli apparaîtrait facetté dans un logiciel de CAO.
 */
function createAnalyticSheetDrawing(state: SheetMetalState): any {
  const M = Math.max(0, Math.min(4, state.bendCount));
  const activeLegs = state.legs.slice(0, M + 1);
  const activeBends = state.bends.slice(0, M);
  const T = Math.max(1, state.thickness);
  const rIn = T;
  const rOut = rIn + T;
  const rMid = 1.5 * T;

  const bendDirs: number[] = [];
  const bendAngles: number[] = [];
  const thetas: number[] = [0];
  for (let i = 0; i < M; i++) {
    const rawAngle = activeBends[i]?.angle ?? 90;
    const angle = Math.max(15, Math.min(165, Math.abs(Number.isNaN(rawAngle) ? 90 : rawAngle)));
    const dir = rawAngle < 0 || activeBends[i]?.direction === -1 ? -1 : 1;
    const beta = angle * Math.PI / 180;
    bendDirs.push(dir);
    bendAngles.push(beta);
    thetas.push(thetas[i] + dir * beta);
  }

  const uVectors = thetas.map(theta => ({ x: Math.cos(theta), y: Math.sin(theta) }));
  const nVectors = uVectors.map(u => ({ x: -u.y, y: u.x }));
  const sLengths: number[] = [];
  for (let i = 0; i <= M; i++) {
    const rawLength = Math.max(rOut, activeLegs[i]?.length || 50);
    if (M === 0) {
      // Une tôle plane ne comporte aucune perte au pli.
      sLengths.push(rawLength);
    } else if (i === 0) {
      sLengths.push(Math.max(1, rawLength - rOut * Math.tan(bendAngles[0] / 2)));
    } else if (i === M) {
      sLengths.push(Math.max(1, rawLength - rOut * Math.tan(bendAngles[M - 1] / 2)));
    } else {
      sLengths.push(Math.max(
        1,
        rawLength
          - rOut * Math.tan(bendAngles[i - 1] / 2)
          - rOut * Math.tan(bendAngles[i] / 2),
      ));
    }
  }

  const P: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  const Q: { x: number; y: number }[] = [];
  const C: { x: number; y: number }[] = [];
  for (let i = 0; i <= M; i++) {
    const q = {
      x: P[i].x + sLengths[i] * uVectors[i].x,
      y: P[i].y + sLengths[i] * uVectors[i].y,
    };
    Q.push(q);
    if (i < M) {
      const center = {
        x: q.x + bendDirs[i] * rMid * nVectors[i].x,
        y: q.y + bendDirs[i] * rMid * nVectors[i].y,
      };
      C.push(center);
      P.push({
        x: center.x - bendDirs[i] * rMid * nVectors[i + 1].x,
        y: center.y - bendDirs[i] * rMid * nVectors[i + 1].y,
      });
    }
  }

  const plus = (point: { x: number; y: number }, vector: { x: number; y: number }, scale: number) => ({
    x: point.x + vector.x * scale,
    y: point.y + vector.y * scale,
  });
  const minus = (point: { x: number; y: number }, vector: { x: number; y: number }, scale: number) => ({
    x: point.x - vector.x * scale,
    y: point.y - vector.y * scale,
  });
  const arcPoint = (
    center: { x: number; y: number },
    radius: number,
    start: { x: number; y: number },
    delta: number,
    fraction: number,
  ) => {
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const angle = startAngle + delta * fraction;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  };

  const first = plus(P[0], nVectors[0], T / 2);
  let path = draw([first.x, first.y]);
  if (M === 0) {
    const endTop = plus(Q[0], nVectors[0], T / 2);
    const endBottom = minus(Q[0], nVectors[0], T / 2);
    const startBottom = minus(P[0], nVectors[0], T / 2);
    return path
      .lineTo([endTop.x, endTop.y])
      .lineTo([endBottom.x, endBottom.y])
      .lineTo([startBottom.x, startBottom.y])
      .close();
  }
  for (let i = 0; i < M; i++) {
    const bendStart = plus(Q[i], nVectors[i], T / 2);
    if (i === 0) {
      path = path.lineTo([bendStart.x, bendStart.y]);
    }
    const radius = bendDirs[i] === 1 ? rIn : rOut;
    const arcEnd = plus(P[i + 1], nVectors[i + 1], T / 2);
    const arcMid = arcPoint(C[i], radius, bendStart, bendDirs[i] * bendAngles[i], 0.5);
    path = path.threePointsArcTo([arcEnd.x, arcEnd.y], [arcMid.x, arcMid.y]);
    const nextLegEnd = plus(Q[i + 1], nVectors[i + 1], T / 2);
    path = path.lineTo([nextLegEnd.x, nextLegEnd.y]);
  }

  const endTip = minus(Q[M], nVectors[M], T / 2);
  path = path.lineTo([endTip.x, endTip.y]);
  if (M === 0) {
    const startTip = minus(P[0], nVectors[0], T / 2);
    path = path.lineTo([startTip.x, startTip.y]);
  }
  for (let i = M - 1; i >= 0; i--) {
    const bendEnd = minus(P[i + 1], nVectors[i + 1], T / 2);
    if (i === M - 1) {
      path = path.lineTo([bendEnd.x, bendEnd.y]);
    }
    const radius = bendDirs[i] === 1 ? rOut : rIn;
    const arcStart = bendEnd;
    const arcEnd = minus(Q[i], nVectors[i], T / 2);
    const arcMid = arcPoint(C[i], radius, arcStart, -bendDirs[i] * bendAngles[i], 0.5);
    path = path.threePointsArcTo([arcEnd.x, arcEnd.y], [arcMid.x, arcMid.y]);
    const previousLegTip = minus(P[i], nVectors[i], T / 2);
    path = path.lineTo([previousLegTip.x, previousLegTip.y]);
  }
  // close() creates the final straight edge on the first terminal leg.
  return path.close();
}

export async function generateStepFile(input: any): Promise<string> {
  let state: SheetMetalState;

  if (input.bendCount !== undefined && Array.isArray(input.legs)) {
    state = input as SheetMetalState;
  } else {
    // Rétrocompatibilité L-Plate 1 pli
    state = {
      bendCount: 1,
      legs: [
        {
          id: 'A',
          label: 'Aile A',
          length: input.legA || 100,
          hasHole: !!input.holeA,
          holeDiam: input.holeADiam || 10,
          holeDist: input.holeADist || 20,
          holeOffset: input.holeAOffset || 25,
        },
        {
          id: 'B',
          label: 'Aile B',
          length: input.legB || 100,
          hasHole: !!input.holeB,
          holeDiam: input.holeBDiam || 10,
          holeDist: input.holeBDist || 20,
          holeOffset: input.holeBOffset || 25,
        },
      ],
      bends: [{ id: '1', angle: 90, direction: 1 }],
      width: input.width || 50,
      thickness: input.thickness || 5,
      material: input.material || 'Steel',
    };
  }

  state = { ...state, thickness: normalizeSheetThickness(Number(state.thickness) || 3, state.finish) };
  if (state.blankShape) {
    if (!checkSheetMetalFeasibility(state).isFeasible) throw new Error('Corrigez les contraintes de la forme et des trous avant l’export.');
    await ensureOpenCascade();
    state = normalizeFormedBlank(state);
    let solid = createFormedBlankSolid(state);
    const profile = generateSheetProfile(state);
    for (const [legIndex, leg] of state.legs.slice(0, state.bendCount + 1).entries()) {
    const transform = profile.legTransforms[legIndex];
    if (leg.hasHole) for (const position of getExportHolePositions(leg, state.width, state)) {
      const definition = getHoleDefinitionForPosition(leg, position);
      const center = [transform.tip.x + transform.direction.x * position.dist, transform.tip.y + transform.direction.y * position.dist, position.offset] as [number, number, number];
      const origin = [center[0] + transform.normal.x * state.thickness * 2, center[1] + transform.normal.y * state.thickness * 2, center[2]] as [number, number, number];
      const through = [-transform.normal.x, -transform.normal.y, 0] as [number, number, number];
      const plane = new Plane(origin, [Math.cos(transform.rotationAngle), Math.sin(transform.rotationAngle), 0], through);
      let cutter;
      if (definition.holeContour?.length) {
        const points = definition.holeContour;
        let path = draw([points[0].x, points[0].y]);
        for (const p of points.slice(1)) path = path.lineTo([p.x, p.y]);
        cutter = path.close().sketchOnPlane(plane).extrude(state.thickness * 4);
      } else if (definition.holeShape === 'round' || !definition.holeShape) {
        cutter = makeCylinder(definition.holeDiam / 2, state.thickness * 4, origin, through);
      } else if (definition.holeShape === 'oblong') {
        cutter = drawOblongHolePath(definition.holeLength || definition.holeDiam, definition.holeWidth || definition.holeDiam, definition.holeOrientation)
          .sketchOnPlane(plane).extrude(state.thickness * 4);
      } else if (definition.holeShape === 'square' || definition.holeShape === 'rect') {
        const length = definition.holeShape === 'square' ? definition.holeDiam : definition.holeLength || definition.holeDiam;
        const width = definition.holeShape === 'square' ? definition.holeDiam : definition.holeWidth || definition.holeDiam;
        const radius = Math.max(0, Math.min(position.cornerRadius ?? leg.holeCornerRadius ?? 0, length / 2, width / 2));
        cutter = drawRoundedRectangle(length, width, radius).sketchOnPlane(plane).extrude(state.thickness * 4);
      } else {
        const points = getHoleContour2D(definition.holeShape, definition.holeDiam, definition.holeLength || definition.holeDiam, definition.holeWidth || definition.holeDiam, definition.holeOrientation);
        let path = draw([points[0].du, points[0].dw]);
        for (const p of points.slice(1)) path = path.lineTo([p.du, p.dw]);
        cutter = path.close().sketchOnPlane(plane).extrude(state.thickness * 4);
      }
      const previous = solid;
      solid = solid.cut(cutter); previous.delete(); cutter.delete();
    }
    }
    try { return exportStepAp214(solid); } finally { solid.delete(); }
  }
  const { bendCount, legs, bends, width, thickness, material } = state;
  const activeLegs = legs.slice(0, bendCount + 1);

  // For the standard solid one-bend case, delegate STEP creation to the
  // Open Cascade kernel through Replicad. This produces native analytic
  // planes/cylinders and the SURFACE_CURVE/PCURVE topology used by the
  // working John Steel files, instead of hand-writing a B-Rep exchange file.
  const simpleHoleLegs = legs.slice(0, 2);
  const cornerRadii = getFlatCornerRadii(state);
  const hasCornerRounding = Object.values(cornerRadii).some(radius => radius > 0);
  // Le moteur OCC est également utilisé pour les formes de trou inattendues
  // ou ajoutées ultérieurement : aucune combinaison de paramètres ne doit
  // retomber sur l'ancien B-Rep écrit à la main.
  const canUseOpenCascade = bendCount === 1;

  if (canUseOpenCascade) {
    await ensureOpenCascade();
    const T = Math.max(0.5, thickness);
    const rIn = T;
    const rOut = rIn + T;
    const a = Math.max(2 * rOut + 1, legs[0]?.length || 100);
    const b = Math.max(2 * rOut + 1, legs[1]?.length || 100);
    const cx = a - rOut;
    const bend = bends[0] || { angle: 90, direction: 1 as const };
    const bendAngle = Math.max(15, Math.min(165, Math.abs(bend.angle || 90))) * Math.PI / 180;
    const bendSign = bend.direction === -1 ? -1 : 1;
    const sinA = Math.sin(bendAngle);
    const cosA = Math.cos(bendAngle);
    const sinHalfA = Math.sin(bendAngle / 2);
    const cosHalfA = Math.cos(bendAngle / 2);
    const straightB = Math.max(T, b - rOut);
    const tangent = [cosA, bendSign * sinA];
    const normal = [-bendSign * sinA, bendSign * cosA];

    const profile = draw([0, 0])
      .hLine(cx)
      .threePointsArc(
        rOut * sinA,
        bendSign * rOut * (1 - cosA),
        rOut * sinHalfA,
        bendSign * rOut * (1 - cosHalfA),
      )
      .line(tangent[0] * straightB, tangent[1] * straightB)
      .line(normal[0] * T, normal[1] * T)
      .line(-tangent[0] * straightB, -tangent[1] * straightB)
      .threePointsArc(
        -rIn * sinA,
        -bendSign * rIn * (1 - cosA),
        rIn * (sinHalfA - sinA),
        bendSign * rIn * (cosA - cosHalfA),
      )
      .hLine(-cx)
      .close();

    let solid: any = profile.sketchOnPlane('XY').extrude(width);

    // Les rayons demandés ici sont les rayons des coins du développé, donc
    // des extrémités de la tôle dans la largeur.  Ils ne doivent pas être
    // appliqués au profil du pli.  On les découpe directement dans le solide
    // analytique avec un outil dont le bord est un vrai arc de cercle : cela
    // conserve des CYLINDRICAL_SURFACE/CIRCLE dans le STEP au lieu d'une
    // approximation polygonale transformée en B-SPLINE.
    if (hasCornerRounding) {
      const profileData = generateSheetProfile(state);
      const terminalLegs = [profileData.legTransforms[0], profileData.legTransforms[1]];
      for (const [terminalIndex, legT] of terminalLegs.entries()) {
        if (!legT) continue;
        const sideRadii = terminalIndex === 0
          ? [cornerRadii.startLeft, cornerRadii.startRight]
          : [cornerRadii.endLeft, cornerRadii.endRight];

        for (const [sideIndex, side] of [1, -1].entries()) {
          const radius = Math.min(
            sideRadii[sideIndex],
            Math.max(0.5, legT.length / 2),
            Math.max(0.5, width / 2),
          );
          if (radius <= 0) continue;

          const planeYAxisZ = legT.normal.x * legT.direction.y - legT.normal.y * legT.direction.x;
          // The Plane local Y axis is `normal × direction`. Pick the local
          // sign that points into the sheet: +Z for the left edge and -Z for
          // the right edge. This keeps the analytic quarter-circle cutter on
          // the same corner as the Three.js preview.
          const sign = side * (planeYAxisZ >= 0 ? 1 : -1);
          const outside = Math.max(radius, thickness * 4);
          const cutterPath = drawFlatCornerCutterPath(radius, outside, sign as 1 | -1);
          const cutterPlane = new Plane(
            [
              legT.tip.x - legT.normal.x * thickness * 1.5,
              legT.tip.y - legT.normal.y * thickness * 1.5,
              side === 1 ? 0 : width,
            ],
            [legT.direction.x, legT.direction.y, 0],
            [legT.normal.x, legT.normal.y, 0],
          );
          const cutter = cutterPath.close().sketchOnPlane(cutterPlane).extrude(thickness * 3, {
            extrusionDirection: [legT.normal.x, legT.normal.y, 0],
          });
          solid = solid.cut(cutter);
        }
      }
    }

    // Round holes use native cylindrical cutting tools.  This keeps the
    // result in the same analytic OpenCascade topology as the hole-free part.
    const holeRadius = (leg: typeof simpleHoleLegs[number]) =>
      Math.max(1, Math.min(leg.holeDiam || 10, Math.min(a, b) / 2 - 0.5)) / 2;
    const holeSize = (leg: typeof simpleHoleLegs[number]) =>
      Math.max(2, Math.min(leg.holeDiam || 10, Math.min(a, b) / 2 - 0.5));
    const makeProfileCutter = (
      leg: typeof simpleHoleLegs[number],
      center: [number, number, number],
      plane: 'XZ' | 'YZ' | Plane,
      direction: [number, number, number],
    ): any => {
      const contour = getHoleContour2D(
        leg.holeShape || 'round',
        holeSize(leg),
        leg.holeLength || 25,
        leg.holeWidth || 12,
        leg.holeOrientation || 'along_length',
        leg.holeContour,
      );
      if (leg.holeShape === 'oblong') {
        return drawOblongHolePath(
          leg.holeLength || 25,
          leg.holeWidth || 12,
          leg.holeOrientation || 'along_length',
        ).sketchOnPlane(plane instanceof Plane ? plane : plane, center).extrude(T * 3, {
          extrusionDirection: direction,
        });
      }
      let cutterPath = draw([contour[0].du, contour[0].dw]);
      for (const point of contour.slice(1)) {
        cutterPath.lineTo([point.du, point.dw]);
      }
      const cutterDrawing = cutterPath.close();
      const cutterSketch = plane instanceof Plane
        ? cutterDrawing.sketchOnPlane(plane)
        : cutterDrawing.sketchOnPlane(plane, center);
      return cutterSketch.extrude(T * 3, {
        extrusionDirection: direction,
      });
    };

    const legA = simpleHoleLegs[0];
    if (legA?.hasHole) {
      for (const position of getExportHolePositions(legA, width, state)) {
        const hole = getHoleDefinitionForPosition(legA, position);
        const margin = (hole.holeShape || 'round') === 'square' ? holeSize(hole) / 2 : holeRadius(hole);
        const x = Math.max(margin + 0.5, Math.min(cx - margin - 0.5, position.dist));
        const z = Math.max(margin + 0.5, Math.min(width - margin - 0.5, position.offset));
        const shape = hole.holeShape || 'round';
        const cutter = shape === 'round'
          ? makeCylinder(holeRadius(hole), T * 3, [x, -T, z], [0, 1, 0])
          : makeProfileCutter(hole, [x, -T, z], 'XZ', [0, 1, 0]);
        solid = solid.cut(cutter);
      }
    }

    const legB = simpleHoleLegs[1];
    if (legB?.hasHole) {
      for (const position of getExportHolePositions(legB, width, state)) {
        const hole = getHoleDefinitionForPosition(legB, position);
        const margin = (hole.holeShape || 'round') === 'square' ? holeSize(hole) / 2 : holeRadius(hole);
        const z = Math.max(margin + 0.5, Math.min(width - margin - 0.5, position.offset));
        const tipX = cx + rOut * sinA + tangent[0] * straightB;
        const tipY = bendSign * rOut * (1 - cosA) + tangent[1] * straightB;
        const alongLeg = Math.max(margin + 0.5, Math.min(straightB - margin - 0.5, position.dist));
        const centerX = tipX - tangent[0] * alongLeg;
        const centerY = tipY - tangent[1] * alongLeg;
        const shape = hole.holeShape || 'round';
        const cutter = shape === 'round'
          ? makeCylinder(
            holeRadius(hole),
            T * 3,
            [centerX - normal[0] * 1.5 * T, centerY - normal[1] * 1.5 * T, z],
            [normal[0], normal[1], 0],
          )
          : makeProfileCutter(
            hole,
            [centerX, centerY, z],
            new Plane([centerX, centerY, z], [tangent[0], tangent[1], 0], [normal[0], normal[1], 0]),
            [normal[0], normal[1], 0],
          );
        solid = solid.cut(cutter);
      }
    }

    return exportStepAp214(solid);
  }

  // Multi-bend parts without holes also use an OpenCascade solid. The
  // existing profile generator already computes the complete closed section
  // (including the bend angles); reusing its sampled contour here avoids the
  // legacy hand-written B-Rep that was breaking on U/Z/C profiles.
  // Tous les profils multi-plis doivent rester dans le chemin OpenCascade.
  // L'ancien exporteur B-Rep manuel, utilisé auparavant pour une forme de
  // perçage non listée, produisait des corps incohérents dès le 3e pli.
  // Replicad/OCC sait déjà extruder le contour et découper tout contour 2D
  // fermé : il n'y a donc aucune raison de revenir à ce chemin legacy.
  const supportedMultiBendHoles = true;

  if (supportedMultiBendHoles) {
    await ensureOpenCascade();
    const profileData = generateSheetProfile(state);
    const multiBendDrawing = createAnalyticSheetDrawing(state);
    let multiBendSolid: any = multiBendDrawing.sketchOnPlane('XY').extrude(width);

    // Les arrondis concernent les deux extrémités de la tôle à plat, sur les
    // bords en largeur. Ils sont découpés dans les plans de chaque aile
    // terminale, sans modifier le rayon de la section de pliage.
    if (hasCornerRounding) {
      const firstLeg = profileData.legTransforms[0];
      const lastLeg = profileData.legTransforms[profileData.legTransforms.length - 1];
      const flatStartLeg = bendCount === 0 && firstLeg
        ? { ...firstLeg, tip: firstLeg.bendStart, direction: { x: -firstLeg.direction.x, y: -firstLeg.direction.y } }
        : firstLeg;
      const terminalLegs = bendCount === 0 ? [flatStartLeg, firstLeg] : [firstLeg, lastLeg];
      for (const [terminalIndex, legT] of terminalLegs.entries()) {
        if (!legT) continue;
        const sideRadii = terminalIndex === 0
          ? [cornerRadii.startLeft, cornerRadii.startRight]
          : [cornerRadii.endLeft, cornerRadii.endRight];
        for (const [sideIndex, side] of [1, -1].entries()) {
          const radius = Math.min(sideRadii[sideIndex], Math.max(0.5, legT.length / 2), Math.max(0.5, width / 2));
          if (radius <= 0) continue;
          // Plane calcule son axe Y par `normal × direction`. Son signe Z
          // varie selon le sens du pli ; le contour doit être inversé en
          // conséquence pour rester dans la matière, au bord demandé.
          const planeYAxisZ = legT.normal.x * legT.direction.y - legT.normal.y * legT.direction.x;
          // Select the local Plane-Y direction that points into the sheet;
          // using the opposite sign leaves the terminal corner square in the
          // exported STEP even though the viewer shows it rounded.
          const sign = side * (planeYAxisZ >= 0 ? 1 : -1);
          // Faire dépasser l'outil des deux bords extérieurs évite les faces
          // coplanaires OpenCascade et supprime tout reliquat carré au coin.
          const outside = Math.max(radius, thickness * 4);
          // Un arc analytique OCC (pas de facettes) avec des déplacements
          // relatifs correctement calculés depuis le dernier point du contour.
          const cutterPath = drawFlatCornerCutterPath(radius, outside, sign as 1 | -1);
          const cutterPlane = new Plane(
            [
              legT.tip.x - legT.normal.x * thickness * 1.5,
              legT.tip.y - legT.normal.y * thickness * 1.5,
              side === 1 ? 0 : width,
            ],
            [legT.direction.x, legT.direction.y, 0],
            [legT.normal.x, legT.normal.y, 0],
          );
          const cutter = cutterPath.close().sketchOnPlane(cutterPlane).extrude(thickness * 3, {
            extrusionDirection: [legT.normal.x, legT.normal.y, 0],
          });
          multiBendSolid = multiBendSolid.cut(cutter);
        }
      }
    }

    // Les trous des profils multi-plis passent eux aussi par OCC. Le plan de
    // chaque outil est (longueur de l'aile, largeur Z) et son extrusion suit
    // la normale de l'aile : le contour ne peut donc plus être interprété
    // comme un trou dans l'épaisseur ou dans le mauvais plan.
    const holeRadius = (leg: typeof activeLegs[number]) => {
      const { rx } = getHoleRadii(leg);
      return Math.max(1, Math.min(rx, Math.min(leg.length, width) / 2 - 0.5));
    };
    const holeContourSize = (leg: typeof activeLegs[number]) =>
      Math.max(2, Math.min(leg.holeDiam || 10, Math.min(leg.length, width) / 2 - 0.5));

    for (const legT of profileData.legTransforms) {
      const leg = activeLegs[legT.index];
      if (!leg?.hasHole) continue;

      for (const position of getExportHolePositions(leg, width, state)) {
        const hole = getHoleDefinitionForPosition(leg, position);
        const shape = hole.holeShape || 'round';
        const { rx, rz } = getHoleRadii(hole);
        const marginAlong = shape === 'square' ? holeContourSize(hole) / 2 : rx;
        const along = Math.max(
          marginAlong + 0.5,
          Math.min(legT.length - marginAlong - 0.5, position.dist),
        );
        const z = Math.max(
          rz + 0.5,
          Math.min(width - rz - 0.5, position.offset),
        );
        const centerX = legT.tip.x + legT.direction.x * along;
        const centerY = legT.tip.y + legT.direction.y * along;
        const extrusionDirection: [number, number, number] = [legT.normal.x, legT.normal.y, 0];
        const center: [number, number, number] = [centerX, centerY, z];

        if (shape === 'round') {
          multiBendSolid = multiBendSolid.cut(makeCylinder(
            holeRadius(hole),
            thickness * 3,
            [centerX - legT.normal.x * thickness * 1.5, centerY - legT.normal.y * thickness * 1.5, z],
            extrusionDirection,
          ));
          continue;
        }

        const contour = getHoleContour2D(
          shape,
          holeContourSize(hole),
          hole.holeLength || 25,
          hole.holeWidth || 12,
          hole.holeOrientation || 'along_length',
          hole.holeContour,
        );
        let cutterPath: any;
        if (shape === 'oblong') {
          cutterPath = drawOblongHolePath(
            hole.holeLength || 25,
            hole.holeWidth || 12,
            hole.holeOrientation || 'along_length',
          );
        } else {
          cutterPath = draw([contour[0].du, contour[0].dw]);
          for (const point of contour.slice(1)) {
            cutterPath = cutterPath.lineTo([point.du, point.dw]);
          }
        }
        const cutterPlane = new Plane(
          [
            center[0] - legT.normal.x * thickness * 1.5,
            center[1] - legT.normal.y * thickness * 1.5,
            center[2],
          ],
          [legT.direction.x, legT.direction.y, 0],
          extrusionDirection,
        );
        const cutter = cutterPath.sketchOnPlane(cutterPlane).extrude(thickness * 3, {
          extrusionDirection,
        });
        multiBendSolid = multiBendSolid.cut(cutter);
      }
    }

    return exportStepAp214(multiBendSolid);
  }

  // Vérification systématique de fabricabilité tôlerie & métallerie DIN 6935
  const report: SheetMetalFeasibilityReport = checkSheetMetalFeasibility(state);

  // Construction du cartouche de conformité métallerie pour le header STEP
  const reportLines: string[] = [
    `/* ====================================================================`,
    `   RAPPORT D'AUDIT DE FABRICABILITE METALLERIE & CHAUDRONNERIE (DIN 6935)`,
    `   Statut fabrication : ${report.status === 'conform' ? 'CONFORME (100% FAISABLE EN ATELIER)' : report.status === 'warning' ? 'TOLERANCE LIMITE ATELIER (Avertissements)' : 'NON CONFORME (Incompatible presse / laser)'}`,
    `   Score conformite   : ${report.score}%`,
    `   Nuance matiere     : ${report.materialName}`,
    `   Epaisseur tole (e) : ${thickness.toFixed(2)} mm`,
    `   Developpe brut (L) : ${report.unfoldedLength.toFixed(2)} mm x ${width.toFixed(2)} mm`,
    `   Poids estime       : ${report.weightKg.toFixed(3)} kg`,
    `   Facteur K          : ${report.kFactor.toFixed(3)} (DIN 6935 standard)`,
    `   Rayon interieur Ri : ${thickness.toFixed(2)} mm (Ri = 1.0 x e)`,
    `   Nombre de plis     : ${bendCount}`,
  ];

  for (const b of report.bendsSummary) {
    reportLines.push(`   - Pli ${b.bendIndex} : Angle = ${b.angle.toFixed(1)} deg, Sens = ${b.direction === 1 ? 'Exterieur (+)' : 'Interieur (-)'}, Perte au pli = ${b.bendDeduction.toFixed(2)} mm`);
  }

  reportLines.push(`   Controles atelier :`);
  for (const c of report.checks) {
    reportLines.push(`   [${c.status.toUpperCase()}] ${c.name} : ${c.value} -> ${c.message}`);
  }
  reportLines.push(`   ==================================================================== */`);
  const headerComment = reportLines.join('\n');

  // --- Moteur STEP Builder AP214 ---
  class StepBuilder {
    private idCounter = 1;
    private lines: string[] = [];
    private pointCache = new Map<string, number>();
    public repId: number;

    constructor() {
      const date = new Date().toISOString().replace(/\..+/, '');
      // A STEP file must start with the ISO-10303-21 marker.  The previous
      // version emitted the fabrication report before that marker, which is
      // tolerated by some viewers but rejected by stricter uploaders.
      this.lines.push(`ISO-10303-21;`);
      this.lines.push(`HEADER;`);
      this.lines.push(`FILE_DESCRIPTION(('Open CASCADE Model', 'Material: ${material}', 'Bends: ${bendCount}', 'Feasibility: ${report.status}'),'2;1');`);
      this.lines.push(`FILE_NAME('SheetMetal_${bendCount}Bends_${material}.step','${date}',('SheetMetal Studio'),('Open CASCADE STEP processor 6.9'),'Open CASCADE 6.9','Unknown','Unknown');`);
      this.lines.push(`FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`);
      this.lines.push(`ENDSEC;`);
      this.lines.push(`DATA;`);
      
      const idAppProto = this.reserveId();
      const idAppContext = this.reserveId();
      const idShpDefRep = this.reserveId();
      const idProdDefShape = this.reserveId();
      const idProdDef = this.reserveId();
      const idProdDefForm = this.reserveId();
      const idProd = this.reserveId();
      const idProdContext = this.reserveId();
      const idProdDefContext = this.reserveId();
      this.repId = this.reserveId(); 

      this.addExplicit(idAppProto, `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${idAppContext})`);
      this.addExplicit(idAppContext, `APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
      this.addExplicit(idShpDefRep, `SHAPE_DEFINITION_REPRESENTATION(#${idProdDefShape},#${this.repId})`);
      this.addExplicit(idProdDefShape, `PRODUCT_DEFINITION_SHAPE('','',#${idProdDef})`);
      this.addExplicit(idProdDef, `PRODUCT_DEFINITION('design','',#${idProdDefForm},#${idProdDefContext})`);
      this.addExplicit(idProdDefForm, `PRODUCT_DEFINITION_FORMATION('','',#${idProd})`);
      this.addExplicit(idProd, `PRODUCT('SheetMetalPart','SheetMetal [${bendCount} Plis, Material: ${material}, Status: ${report.status}]','',(#${idProdContext}))`);
      this.addExplicit(idProdContext, `PRODUCT_CONTEXT('',#${idAppContext},'mechanical')`);
      this.addExplicit(idProdDefContext, `PRODUCT_DEFINITION_CONTEXT('part definition',#${idAppContext},'design')`);
    }

    private reserveId(): number {
      return this.idCounter++;
    }

    addExplicit(id: number, content: string) {
      this.lines.push(`#${id} = ${content};`);
    }

    add(content: string): number {
      const id = this.reserveId();
      this.addExplicit(id, content);
      return id;
    }

    point(x: number, y: number, z: number): number {
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
      if (this.pointCache.has(key)) {
        return this.pointCache.get(key)!;
      }
      const id = this.add(`CARTESIAN_POINT('',(${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}))`);
      this.pointCache.set(key, id);
      return id;
    }

    direction(x: number, y: number, z: number): number {
      const len = Math.hypot(x, y, z) || 1;
      return this.add(`DIRECTION('',(${(x / len).toFixed(6)},${(y / len).toFixed(6)},${(z / len).toFixed(6)}))`);
    }

    vector(dirId: number, length: number): number {
      return this.add(`VECTOR('',#${dirId},${length.toFixed(6)})`);
    }

    axis2(originId: number, axisId: number, refId: number): number {
      return this.add(`AXIS2_PLACEMENT_3D('',#${originId},#${axisId},#${refId})`);
    }

    vertex(pointId: number): number {
      return this.add(`VERTEX_POINT('',#${pointId})`);
    }

    line(startPtId: number, vecId: number): number {
      return this.add(`LINE('',#${startPtId},#${vecId})`);
    }

    edgeCurve(vStart: number, vEnd: number, curveId: number): number {
      return this.add(`EDGE_CURVE('',#${vStart},#${vEnd},#${curveId},.T.)`);
    }

    orientedEdge(edgeId: number, orientation: boolean): number {
      return this.add(`ORIENTED_EDGE('',*,*,#${edgeId},.${orientation ? 'T' : 'F'}.)`);
    }

    edgeLoop(orientedEdgeIds: number[]): number {
      const list = orientedEdgeIds.map(id => `#${id}`).join(',');
      return this.add(`EDGE_LOOP('',(${list}))`);
    }

    faceBound(loopId: number, outer: boolean): number {
      return this.add(`FACE_BOUND('',#${loopId},.${outer ? 'T' : 'F'}.)`);
    }

    plane(axis2Id: number): number {
      return this.add(`PLANE('',#${axis2Id})`);
    }

    circle(axis2Id: number, radius: number): number {
      return this.add(`CIRCLE('',#${axis2Id},${radius.toFixed(6)})`);
    }

    trimmedCurve(curveId: number, start: number, end: number, senseAgreement = true): number {
      return this.add(`TRIMMED_CURVE('',#${curveId},.${senseAgreement ? 'T' : 'F'}.,(${start.toFixed(9)},${end.toFixed(9)}),.PARAMETER_VALUE.)`);
    }

    cylindricalSurface(axis2Id: number, radius: number): number {
      return this.add(`CYLINDRICAL_SURFACE('',#${axis2Id},${radius.toFixed(6)})`);
    }

    advancedFace(boundIds: number[], surfaceId: number, sameSense: boolean): number {
      const list = boundIds.map(id => `#${id}`).join(',');
      return this.add(`ADVANCED_FACE('',(${list}),#${surfaceId},.${sameSense ? 'T' : 'F'}.)`);
    }

    closedShell(faceIds: number[]): number {
      const list = faceIds.map(id => `#${id}`).join(',');
      return this.add(`CLOSED_SHELL('',(${list}))`);
    }

    solid(shellId: number): number {
      return this.add(`MANIFOLD_SOLID_BREP('',#${shellId})`);
    }

    finalize(solidId: number): string {
      const dirZ = this.direction(0, 0, 1);
      const dirX = this.direction(1, 0, 0);
      const origin = this.point(0, 0, 0);
      const axisWorld = this.axis2(origin, dirZ, dirX);

      const idUncertainty = this.reserveId();
      const idLengthUnit = this.reserveId();
      const idPlaneAngleUnit = this.reserveId();
      const idSolidAngleUnit = this.reserveId();

      this.addExplicit(idUncertainty, `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${idLengthUnit},'distance_accuracy_value','confusion accuracy')`);
      this.addExplicit(idLengthUnit, `(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
      this.addExplicit(idPlaneAngleUnit, `(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
      this.addExplicit(idSolidAngleUnit, `(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
      
      const idComplexRepCtx = this.add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${idUncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${idLengthUnit},#${idPlaneAngleUnit},#${idSolidAngleUnit}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);

      this.addExplicit(this.repId, `ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${solidId},#${axisWorld}),#${idComplexRepCtx})`);

      this.lines.push(`ENDSEC;`);
      this.lines.push(`END-ISO-10303-21;`);
      return this.lines.join('\n');
    }
  }

  const step = new StepBuilder();

  // John Steel/Analysis Situs recognises a folded sheet more reliably when
  // the bend is represented by one cylindrical face instead of a chain of
  // planar facets.  Use this exact topology for the common one-bend, solid
  // L-profile case.  The legacy path below remains available for holes and
  // multi-bend profiles until their cylindrical topology is implemented too.
  // Disabled until the cylindrical edges are emitted as Open Cascade
  // SURFACE_CURVE/PCURVE entities. Some importers silently drop the bend
  // face when it is bounded only by TRIMMED_CURVE entities. The legacy path
  // below uses a closed faceted approximation and displays the complete part.
  if (false && bendCount === 1 && !legs.slice(0, 2).some(leg => leg.hasHole)) {
    const T = Math.max(0.5, thickness);
    const rIn = T;
    const rOut = rIn + T;
    const a = Math.max(2 * rOut + 1, legs[0]?.length || 100);
    const b = Math.max(2 * rOut + 1, legs[1]?.length || 100);
    const cx = a - rOut;
    const cy = rOut;
    const angle = Math.abs(bends[0]?.angle || 90) * Math.PI / 180;

    const p = (x: number, y: number, z: number) => step.point(x, y, z);
    // A B-Rep must reuse the same VERTEX_POINT entity wherever two edges
    // meet. Creating a fresh vertex for every edge leaves a visually correct
    // shape but an open/non-manifold topology that strict importers reject.
    const vertexCache = new Map<string, number>();
    const sharedVertex = (x: number, y: number, z: number) => {
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
      const existing = vertexCache.get(key);
      if (existing !== undefined) return existing;
      const id = step.vertex(p(x, y, z));
      vertexCache.set(key, id);
      return id;
    };
    const zAxis = step.direction(0, 0, 1);
    const xAxis = step.direction(1, 0, 0);
    const yAxis = step.direction(0, 1, 0);
    const zVector = step.vector(zAxis, 1);

    const lineEdge = (p1: { x: number; y: number; z: number }, p2: { x: number; y: number; z: number }) => {
      const v1 = sharedVertex(p1.x, p1.y, p1.z);
      const v2 = sharedVertex(p2.x, p2.y, p2.z);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const length = Math.hypot(dx, dy, dz) || 1;
      const dir = step.direction(dx / length, dy / length, dz / length);
      return { edge: step.edgeCurve(v1, v2, step.line(step.point(p1.x, p1.y, p1.z), step.vector(dir, 1))), v1, v2 };
    };

    const arcEdge = (radius: number, z: number, start: number, end: number) => {
      const p1 = { x: cx + radius * Math.cos(start), y: cy + radius * Math.sin(start), z };
      const p2 = { x: cx + radius * Math.cos(end), y: cy + radius * Math.sin(end), z };
      const v1 = sharedVertex(p1.x, p1.y, p1.z);
      const v2 = sharedVertex(p2.x, p2.y, p2.z);
      const axis = step.axis2(step.point(cx, cy, z), zAxis, xAxis);
      const circle = step.circle(axis, radius);
      // STEP trimmed-curve parameters must be ascending. Reverse traversal
      // is expressed by sense_agreement, not by a descending parameter pair.
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      const curve = step.trimmedCurve(circle, lo, hi, start <= end);
      return { edge: step.edgeCurve(v1, v2, curve), v1, v2, p1, p2 };
    };

    const makeFace = (edgeIds: number[], surface: number, outer = true, sameSense = true) => {
      const loop = step.edgeLoop(edgeIds.map(id => step.orientedEdge(id, outer)));
      return step.advancedFace([step.faceBound(loop, true)], surface, sameSense);
    };

    const bottomEdges = [
      lineEdge({ x: 0, y: 0, z: 0 }, { x: cx, y: 0, z: 0 }),
      arcEdge(rOut, 0, -Math.PI / 2, 0),
      lineEdge({ x: a, y: cy, z: 0 }, { x: a, y: b, z: 0 }),
      lineEdge({ x: a, y: b, z: 0 }, { x: a - T, y: b, z: 0 }),
      lineEdge({ x: a - T, y: b, z: 0 }, { x: a - T, y: cy, z: 0 }),
      arcEdge(rIn, 0, 0, -Math.PI / 2),
      lineEdge({ x: cx, y: T, z: 0 }, { x: 0, y: T, z: 0 }),
      lineEdge({ x: 0, y: T, z: 0 }, { x: 0, y: 0, z: 0 }),
    ];
    const topEdges = bottomEdges.map(() => null);
    const sideFaces: number[] = [];

    const bottomPoints = [
      [{ x: 0, y: 0 }, { x: cx, y: 0 }],
      [{ x: cx, y: 0 }, { x: a, y: cy }],
      [{ x: a, y: cy }, { x: a, y: b }],
      [{ x: a, y: b }, { x: a - T, y: b }],
      [{ x: a - T, y: b }, { x: a - T, y: cy }],
      [{ x: a - T, y: cy }, { x: cx, y: T }],
      [{ x: cx, y: T }, { x: 0, y: T }],
      [{ x: 0, y: T }, { x: 0, y: 0 }],
    ];
    const topEdgesByIndex: number[] = [];
    const bottomEdgeIds = bottomEdges.map(item => item.edge);
    for (let i = 0; i < bottomPoints.length; i++) {
      const q1 = { ...bottomPoints[i][0], z: width };
      const q2 = { ...bottomPoints[i][1], z: width };
      if (i === 1) topEdgesByIndex.push(arcEdge(rOut, width, -Math.PI / 2, 0).edge);
      else if (i === 5) topEdgesByIndex.push(arcEdge(rIn, width, 0, -Math.PI / 2).edge);
      else topEdgesByIndex.push(lineEdge(q1, q2).edge);
    }

    const faces: number[] = [];
    const bottomPlane = step.plane(step.axis2(step.point(0, 0, 0), step.direction(0, 0, -1), xAxis));
    const bottomLoop = step.edgeLoop(bottomEdgeIds.map(id => step.orientedEdge(id, false)));
    faces.push(step.advancedFace([step.faceBound(bottomLoop, true)], bottomPlane, true));
    const topPlane = step.plane(step.axis2(step.point(0, 0, width), zAxis, xAxis));
    const topLoop = step.edgeLoop(topEdgesByIndex.map(id => step.orientedEdge(id, true)));
    faces.push(step.advancedFace([step.faceBound(topLoop, true)], topPlane, true));

    for (let i = 0; i < bottomPoints.length; i++) {
      const p1 = { ...bottomPoints[i][0], z: 0 };
      const p2 = { ...bottomPoints[i][1], z: 0 };
      const q1 = { ...bottomPoints[i][0], z: width };
      const q2 = { ...bottomPoints[i][1], z: width };
      const end1 = lineEdge(p1, q1);
      const end2 = lineEdge(p2, q2);
      const isOuterArc = i === 1;
      const isInnerArc = i === 5;
      if (isOuterArc || isInnerArc) {
        const radius = isOuterArc ? rOut : rIn;
        const surfaceAxis = step.axis2(step.point(cx, cy, 0), zAxis, xAxis);
        const surface = step.cylindricalSurface(surfaceAxis, radius);
        const loop = step.edgeLoop([
          step.orientedEdge(bottomEdgeIds[i], true),
          step.orientedEdge(end2.edge, true),
          step.orientedEdge(topEdgesByIndex[i], false),
          step.orientedEdge(end1.edge, false),
        ]);
        faces.push(step.advancedFace([step.faceBound(loop, true)], surface, isOuterArc));
      } else {
        const axis = step.axis2(step.point(p1.x, p1.y, p1.z), step.direction(-(p2.y - p1.y), p2.x - p1.x, 0), step.direction(p2.x - p1.x, p2.y - p1.y, 0));
        const surface = step.plane(axis);
        const loop = step.edgeLoop([
          step.orientedEdge(bottomEdgeIds[i], true),
          step.orientedEdge(end2.edge, true),
          step.orientedEdge(topEdgesByIndex[i], false),
          step.orientedEdge(end1.edge, false),
        ]);
        faces.push(step.advancedFace([step.faceBound(loop, true)], surface, true));
      }
    }

    const shell = step.closedShell(faces);
    const solid = step.solid(shell);
    return step.finalize(solid);
  }

  // Géométrie du profil 2D et découpes
  const profile = generateSheetProfile(state);
  const pts = profile.pathPoints;
  const N = pts.length;
  const edges = profile.edges;

  const dirZ = step.direction(0, 0, 1);
  const dirNegZ = step.direction(0, 0, -1);
  const dirX = step.direction(1, 0, 0);
  const vecZ = step.vector(dirZ, 1.0);

  // 1. Sommets de base et arêtes verticales
  const vBottom: number[] = [];
  const vTop: number[] = [];
  const evList: number[] = [];

  for (let i = 0; i < N; i++) {
    const ptB = step.point(pts[i].x, pts[i].y, 0);
    const ptT = step.point(pts[i].x, pts[i].y, width);
    const vb = step.vertex(ptB);
    const vt = step.vertex(ptT);
    vBottom.push(vb);
    vTop.push(vt);

    const geomV = step.line(ptB, vecZ);
    const ev = step.edgeCurve(vb, vt, geomV);
    evList.push(ev);
  }

  // 2. Arêtes inférieures (Z=0) et supérieures (Z=width)
  const eBottomList: number[] = [];
  const eTopList: number[] = [];

  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N;
    const pCurrent = pts[i];
    const pNext = pts[next];
    const dx = pNext.x - pCurrent.x;
    const dy = pNext.y - pCurrent.y;
    const len = Math.hypot(dx, dy);

    const dirSeg = step.direction(dx / (len || 1), dy / (len || 1), 0);
    const vecSeg = step.vector(dirSeg, 1.0);

    const ptB = step.point(pCurrent.x, pCurrent.y, 0);
    const geomLineB = step.line(ptB, vecSeg);
    const eB = step.edgeCurve(vBottom[i], vBottom[next], geomLineB);
    eBottomList.push(eB);

    const ptT = step.point(pCurrent.x, pCurrent.y, width);
    const geomLineT = step.line(ptT, vecSeg);
    const eT = step.edgeCurve(vTop[i], vTop[next], geomLineT);
    eTopList.push(eT);
  }

  const faces: number[] = [];

  // Face inférieure (Z=0)
  const planeBottom = step.plane(step.axis2(step.point(0, 0, 0), dirNegZ, dirX));
  const loopBottom = step.edgeLoop(eBottomList.map(e => step.orientedEdge(e, false)));
  faces.push(step.advancedFace([step.faceBound(loopBottom, true)], planeBottom, true));

  // Face supérieure (Z=width)
  const planeTop = step.plane(step.axis2(step.point(0, 0, width), dirZ, dirX));
  const loopTop = step.edgeLoop(eTopList.map(e => step.orientedEdge(e, true)));
  faces.push(step.advancedFace([step.faceBound(loopTop, true)], planeTop, true));

  // 3. Identification des faces des ailes pour usinage des perçages
  // Chaque aile possède 2 faces planes (gauche/extérieure et droite/intérieure)
  interface LegSurfaceInfo {
    segmentIdx: number;
    centerPt: { x: number; y: number; z: number };
    contourVertices: number[]; // Vertex IDs
    contourEdges: number[]; // EdgeCurve IDs
    contourPoints3D: { x: number; y: number; z: number }[];
  }

  const legSurfacesMap = new Map<number, LegSurfaceInfo[]>();

  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N;
    const pCurrent = pts[i];
    const pNext = pts[next];
    const dx = pNext.x - pCurrent.x;
    const dy = pNext.y - pCurrent.y;
    const len = Math.hypot(dx, dy);

    const edgeInfo = edges[i];
    const featureIdx = edgeInfo ? edgeInfo.featureIndex : -1;
    // Une face d'aile principale a un featureIndex pair (0, 2, 4, 6) et une longueur supérieure à l'épaisseur
    const isLegFlatFace = (featureIdx >= 0) && (featureIdx % 2 === 0) && (len > thickness * 1.05);

    if (isLegFlatFace) {
      const legIdx = featureIdx / 2;
      const legConfig = activeLegs[legIdx];
      const legT = profile.legTransforms[legIdx];

      if (legConfig && legConfig.hasHole && legT) {
        for (const holePosition of getPatternPositions(legConfig, width, legConfig.holePattern || state.holePattern, state.thickness, state.bendCount > 0, legIdx > 0 && legIdx < state.bendCount)) {
        const hole = getHoleDefinitionForPosition(legConfig, holePosition);
        // Point central du trou sur cette face
        // Position le long de l'aile depuis le tip
        const u = legT.direction;
        const norm = legT.normal;
        const centerMid = {
          x: legT.tip.x + (u.x * holePosition.dist),
          y: legT.tip.y + (u.y * holePosition.dist),
        };

        // Détection de l'offset vers cette face (+halfT ou -halfT selon la normale)
        const vMidSeg = {
          x: (pCurrent.x + pNext.x) / 2 - legT.tip.x,
          y: (pCurrent.y + pNext.y) / 2 - legT.tip.y,
        };
        const dotN = vMidSeg.x * norm.x + vMidSeg.y * norm.y;
        const offsetN = dotN >= 0 ? (thickness / 2) : (-thickness / 2);

        const centerHoleFace = {
          x: centerMid.x + offsetN * norm.x,
          y: centerMid.y + offsetN * norm.y,
          z: holePosition.offset,
        };

        // Calcul des points 2D du contour
        const holeShape = hole.holeShape || 'round';
        const holeContour2D = getHoleContour2D(
          holeShape,
          hole.holeDiam,
          hole.holeLength || 25,
          hole.holeWidth || 12,
          hole.holeOrientation || 'along_length',
          hole.holeContour
        );

        // Vecteurs dans le plan de la face
        const vecU = u; // Direction longitudinale
        const vecW = { x: 0, y: 0, z: 1 }; // Direction latérale Z

        // Génération des sommets 3D du contour du trou
        const contourVerts: number[] = [];
        const contourPoints3D: { x: number; y: number; z: number }[] = [];
        for (const pt2d of holeContour2D) {
          const px = centerHoleFace.x + pt2d.du * vecU.x;
          const py = centerHoleFace.y + pt2d.du * vecU.y;
          const pz = centerHoleFace.z + pt2d.dw * vecW.z;
          contourPoints3D.push({ x: px, y: py, z: pz });
          contourVerts.push(step.vertex(step.point(px, py, pz)));
        }

        // Génération des arêtes du contour du trou
        const contourEdges: number[] = [];
        const K = contourVerts.length;
        for (let j = 0; j < K; j++) {
          const jNext = (j + 1) % K;
          const p1_2d = holeContour2D[j];
          const p2_2d = holeContour2D[jNext];
          const segDx = (p2_2d.du - p1_2d.du) * vecU.x;
          const segDy = (p2_2d.du - p1_2d.du) * vecU.y;
          const segDz = (p2_2d.dw - p1_2d.dw) * vecW.z;
          const segLen = Math.hypot(segDx, segDy, segDz);

          const dirEdge = step.direction(segDx / (segLen || 1), segDy / (segLen || 1), segDz / (segLen || 1));
          const vecEdge = step.vector(dirEdge, 1.0);
          const ptStart = step.point(
            centerHoleFace.x + p1_2d.du * vecU.x,
            centerHoleFace.y + p1_2d.du * vecU.y,
            centerHoleFace.z + p1_2d.dw * vecW.z
          );
          const geomLine = step.line(ptStart, vecEdge);
          const edgeC = step.edgeCurve(contourVerts[j], contourVerts[jNext], geomLine);
          contourEdges.push(edgeC);
        }

        if (!legSurfacesMap.has(legIdx)) {
          legSurfacesMap.set(legIdx, []);
        }
        legSurfacesMap.get(legIdx)!.push({
          segmentIdx: i,
          centerPt: centerHoleFace,
          contourVertices: contourVerts,
          contourEdges: contourEdges,
          contourPoints3D: contourPoints3D,
        });
        }
      }
    }
  }

  // 4. Génération de toutes les faces latérales avec les boucles intérieures de perçage
  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N;
    const pCurrent = pts[i];
    const pNext = pts[next];
    const dx = pNext.x - pCurrent.x;
    const dy = pNext.y - pCurrent.y;
    const len = Math.hypot(dx, dy);

    const normX = dy / (len || 1);
    const normY = -dx / (len || 1);

    const ptB = step.point(pCurrent.x, pCurrent.y, 0);
    const dirNorm = step.direction(normX, normY, 0);
    const dirTan = step.direction(dx / (len || 1), dy / (len || 1), 0);
    const axisSide = step.axis2(ptB, dirNorm, dirTan);
    const planeSide = step.plane(axisSide);

    // Boucle extérieure du rectangle de flanc
    const loopOuter = step.edgeLoop([
      step.orientedEdge(eBottomList[i], true),
      step.orientedEdge(evList[next], true),
      step.orientedEdge(eTopList[i], false),
      step.orientedEdge(evList[i], false),
    ]);

    const bounds = [step.faceBound(loopOuter, true)];

    // Vérifier si cette face comporte un perçage
    for (const [_, surfList] of legSurfacesMap.entries()) {
      const matchSurf = surfList.find(s => s.segmentIdx === i);
      if (matchSurf) {
        // Boucle intérieure (perçage / découpe traversante)
        // Orientation inverse (.F.) pour soustraction dans le B-Rep
        const loopHole = step.edgeLoop(matchSurf.contourEdges.map(e => step.orientedEdge(e, false)));
        bounds.push(step.faceBound(loopHole, false));
      }
    }

    faces.push(step.advancedFace(bounds, planeSide, true));
  }

  // 5. Génération des parois intérieures des perçages (liaison entre la face gauche et la face droite)
  for (const [_, surfList] of legSurfacesMap.entries()) {
    if (surfList.length === 2) {
      const s1 = surfList[0];
      const s2 = surfList[1];
      const K = s1.contourVertices.length;

      // Arêtes transversales reliant les 2 contours à travers l'épaisseur
      const crossEdges: number[] = [];
      for (let j = 0; j < K; j++) {
        const pt1 = s1.contourPoints3D[j];
        const pt2 = s2.contourPoints3D[j];
        const dxC = pt2.x - pt1.x;
        const dyC = pt2.y - pt1.y;
        const dzC = pt2.z - pt1.z;
        const distC = Math.hypot(dxC, dyC, dzC);

        const dirCross = step.direction(dxC / (distC || 1), dyC / (distC || 1), dzC / (distC || 1));
        const vecCross = step.vector(dirCross, 1.0);
        const pt1Id = step.point(pt1.x, pt1.y, pt1.z);
        const geomLine = step.line(pt1Id, vecCross);
        const edgeCross = step.edgeCurve(s1.contourVertices[j], s2.contourVertices[j], geomLine);
        crossEdges.push(edgeCross);
      }

      // Pour chaque segment du trou, créer un panneau latéral intérieur (paroi du trou)
      for (let j = 0; j < K; j++) {
        const jNext = (j + 1) % K;
        const eFace1 = s1.contourEdges[j];
        const eFace2 = s2.contourEdges[j];
        const eCross1 = crossEdges[j];
        const eCross2 = crossEdges[jNext];

        // Boucle rectangulaire de la paroi intérieure
        const loopWall = step.edgeLoop([
          step.orientedEdge(eFace1, true),
          step.orientedEdge(eCross2, true),
          step.orientedEdge(eFace2, false),
          step.orientedEdge(eCross1, false),
        ]);

        // Calcul géométrique exact du plan de la paroi
        const pt1 = s1.contourPoints3D[j];
        const ptNext1 = s1.contourPoints3D[jNext];
        const pt2 = s2.contourPoints3D[j];

        const edgeVecX = ptNext1.x - pt1.x;
        const edgeVecY = ptNext1.y - pt1.y;
        const edgeVecZ = ptNext1.z - pt1.z;
        const edgeLen = Math.hypot(edgeVecX, edgeVecY, edgeVecZ) || 1;
        const eX = edgeVecX / edgeLen;
        const eY = edgeVecY / edgeLen;
        const eZ = edgeVecZ / edgeLen;

        const crossVecX = pt2.x - pt1.x;
        const crossVecY = pt2.y - pt1.y;
        const crossVecZ = pt2.z - pt1.z;
        const crossLen = Math.hypot(crossVecX, crossVecY, crossVecZ) || 1;
        const cX = crossVecX / crossLen;
        const cY = crossVecY / crossLen;
        const cZ = crossVecZ / crossLen;

        const normX = eY * cZ - eZ * cY;
        const normY = eZ * cX - eX * cZ;
        const normZ = eX * cY - eY * cX;

        const ptOrigin = step.point(pt1.x, pt1.y, pt1.z);
        const dirWallNorm = step.direction(normX, normY, normZ);
        const dirWallRef = step.direction(eX, eY, eZ);
        const axisWall = step.axis2(ptOrigin, dirWallNorm, dirWallRef);
        const planeWall = step.plane(axisWall);

        faces.push(step.advancedFace([step.faceBound(loopWall, true)], planeWall, true));
      }
    }
  }

  // 6. Assemblage en Manifold Solid B-Rep fermé et étanche
  const shell = step.closedShell(faces);
  const solid = step.solid(shell);
  return step.finalize(solid);
}
