/** Developed-blank geometry, independent of the legacy constant-width profile.
 * Keep analytical curves here: a STEP exporter must not turn a round blank into
 * hundreds of planar faces merely because the viewer uses sampled vertices.
 * Shared by the viewer, analytical STEP export and technical drawing.
 */
export type BlankShape = 'rectangle' | 'square' | 'circle' | 'semicircle' | 'ellipse' | 'drop' | 'rounded-end' | 'hexagon' | 'octagon' | 'star' | 'washer' | 'gear' | 'frame' | 'mounting-plate';
export interface BlankPoint { x: number; y: number; }
export type BlankEdge =
  | { type: 'line'; from: BlankPoint; to: BlankPoint }
  | { type: 'ellipse'; center: BlankPoint; rx: number; ry: number; start: number; sweep: number };
export interface BlankDefinition { shape: BlankShape; length: number; width: number; innerDiameter?: number; toothCount?: number; toothHeight?: number; branchCount?: number; branchHeight?: number; cornerRadii?: readonly [number, number, number, number]; }
export interface ParallelFold { id: string; position: number; angle: number; direction: 1 | -1; }
export interface BlankFoldLayout {
  /** Direction of the lines, in degrees from the blank's horizontal axis. */
  orientation: number;
  /** Position is measured along the common normal from its minimum support. */
  folds: ParallelFold[];
}
export const BLANK_SHAPES: readonly { id: BlankShape; label: string }[] = [
  { id: 'rectangle', label: 'Rectangle' }, { id: 'square', label: 'Carré' },
  { id: 'frame', label: 'Cadre' }, { id: 'mounting-plate', label: 'Platine' },
  { id: 'circle', label: 'Rond' }, { id: 'semicircle', label: 'Demi-rond' },
  { id: 'ellipse', label: 'Ovale' }, { id: 'drop', label: 'Goutte' },
  { id: 'rounded-end', label: 'Rectangle à bout arrondi' },
  { id: 'hexagon', label: 'Hexagone' }, { id: 'octagon', label: 'Octogone' },
  { id: 'star', label: 'Étoile' }, { id: 'washer', label: 'Rondelle' }, { id: 'gear', label: 'Roue crantée' },
];
const TAU = 2 * Math.PI;
const EPS = 1e-7;
const dot = (a: BlankPoint, b: BlankPoint) => a.x * b.x + a.y * b.y;
const line = (from: BlankPoint, to: BlankPoint): BlankEdge => ({ type: 'line', from, to });
const arc = (center: BlankPoint, rx: number, ry: number, start = 0, sweep = TAU): BlankEdge =>
  ({ type: 'ellipse', center, rx, ry, start, sweep });

/** One driving dimension for regular shapes, rather than a distorted polygon.
 * Hexagon and octagon width is the distance between opposite parallel sides.
 * A half-disc uses its diameter as length and its radius as width.
 */
export function normalizeBlank(definition: BlankDefinition): BlankDefinition {
  const { shape, length, width } = definition;
  if (!BLANK_SHAPES.some(option => option.id === shape)) throw new Error('Forme inconnue.');
  if (![length, width].every(value => Number.isFinite(value) && value > 0 && value <= 10000)) {
    throw new Error('Dimensions de la forme invalides.');
  }
  if (shape === 'washer') {
    const innerDiameter = definition.innerDiameter ?? length / 2;
    if (!Number.isFinite(innerDiameter) || innerDiameter < 1 || innerDiameter > length - 2) {
      throw new Error('Le diamètre intérieur doit laisser au moins 1 mm de matière tout autour.');
    }
    return { ...definition, width: length, innerDiameter };
  }
  if (shape === 'gear') {
    const toothCount = definition.toothCount ?? 16;
    const toothHeight = definition.toothHeight ?? length * .08;
    const innerDiameter = definition.innerDiameter ?? 0;
    if (!Number.isInteger(toothCount) || toothCount < 6 || toothCount > 120) throw new Error('Choisissez de 6 à 120 dents entières.');
    if (!Number.isFinite(toothHeight) || toothHeight < .5 || toothHeight > length / 2 - 2) throw new Error('Hauteur des dents invalide.');
    // The bore must stay inside the polygonal tooth-root circle, with a
    // minimum 1 mm radial web. This is a geometric guard, not load certification.
    const maxBore = 2 * ((length / 2 - toothHeight) * Math.cos(.45 * TAU / toothCount) - 1);
    if (!Number.isFinite(innerDiameter) || innerDiameter < 0 || (innerDiameter > 0 && innerDiameter < 1) || innerDiameter > maxBore) throw new Error('Le trou central doit laisser au moins 1 mm de matière avant les dents.');
    return { ...definition, width: length, toothCount, toothHeight, innerDiameter };
  }
  if (shape === 'star') {
    const branchCount = definition.branchCount ?? 5;
    const branchHeight = definition.branchHeight ?? length * 11 / 40;
    if (!Number.isInteger(branchCount) || branchCount < 3 || branchCount > 30) throw new Error('Choisissez de 3 à 30 branches entières.');
    // Height is measured radially from a valley to a tip. Keep a nonzero
    // centre so the contour always describes one solid, not touching triangles.
    if (!Number.isFinite(branchHeight) || branchHeight < .5 || branchHeight > length / 2 - 1) throw new Error('Hauteur des branches invalide.');
    return { ...definition, width: length, branchCount, branchHeight };
  }
  if (['square', 'circle'].includes(shape)) return { ...definition, shape, length, width: length };
  if (shape === 'semicircle') return { shape, length, width: length / 2 };
  if (shape === 'hexagon') return { shape, length: 2 * width / Math.sqrt(3), width };
  if (shape === 'octagon') return { shape, length: width, width };
  if ((shape === 'drop' || shape === 'rounded-end') && length < width) {
    throw new Error('La longueur doit être au moins égale à la largeur.');
  }
  return definition;
}

export function blankEdges(definition: BlankDefinition): BlankEdge[] {
  const { shape, length: l, width: w } = normalizeBlank(definition);
  if (['rectangle', 'square', 'frame', 'mounting-plate'].includes(shape) && definition.cornerRadii?.some(r => r > 0)) {
    const [a, b, c, d] = definition.cornerRadii.map(r => Math.max(0, Math.min(r, l / 2, w / 2)));
    const edges: BlankEdge[] = [];
    const addLine = (from: BlankPoint, to: BlankPoint) => { if (Math.hypot(from.x - to.x, from.y - to.y) > EPS) edges.push(line(from, to)); };
    addLine({ x: a, y: 0 }, { x: l - b, y: 0 });
    if (b) edges.push(arc({ x: l - b, y: b }, b, b, -Math.PI / 2, Math.PI / 2));
    addLine({ x: l, y: b }, { x: l, y: w - c });
    if (c) edges.push(arc({ x: l - c, y: w - c }, c, c, 0, Math.PI / 2));
    addLine({ x: l - c, y: w }, { x: d, y: w });
    if (d) edges.push(arc({ x: d, y: w - d }, d, d, Math.PI / 2, Math.PI / 2));
    addLine({ x: 0, y: w - d }, { x: 0, y: a });
    if (a) edges.push(arc({ x: a, y: a }, a, a, Math.PI, Math.PI / 2));
    return edges;
  }
  if (shape === 'circle' || shape === 'ellipse' || shape === 'washer') return [arc({ x: l / 2, y: w / 2 }, l / 2, w / 2)];
  if (shape === 'semicircle') return [
    arc({ x: l / 2, y: 0 }, l / 2, w, 0, Math.PI),
    line({ x: 0, y: 0 }, { x: l, y: 0 }),
  ];
  if (shape === 'rounded-end') return [
    line({ x: 0, y: 0 }, { x: l - w / 2, y: 0 }),
    arc({ x: l - w / 2, y: w / 2 }, w / 2, w / 2, -Math.PI / 2, Math.PI),
    line({ x: l - w / 2, y: w }, { x: 0, y: w }),
    line({ x: 0, y: w }, { x: 0, y: 0 }),
  ];
  if (shape === 'drop') {
    // Convex hull of a broad circle and a small tip circle: both ends are
    // genuinely rounded, with exact common tangents and no fragile cusp.
    const r = w / 2, tip = w * .04, left = r, right = l - tip;
    const theta = Math.acos((r - tip) / (right - left));
    if (theta < EPS) return [arc({ x: left, y: r }, r, r)];
    const point = (cx: number, radius: number, angle: number) =>
      ({ x: cx + radius * Math.cos(angle), y: r + radius * Math.sin(angle) });
    return [
      arc({ x: left, y: r }, r, r, theta, TAU - 2 * theta),
      line(point(left, r, -theta), point(right, tip, -theta)),
      arc({ x: right, y: r }, tip, tip, -theta, 2 * theta),
      line(point(right, tip, theta), point(left, r, theta)),
    ];
  }
  let points: BlankPoint[];
  if (shape === 'star') {
    const star = normalizeBlank(definition);
    points = Array.from({ length: star.branchCount! * 2 }, (_, i) => {
      const angle = -Math.PI / 2 + i * TAU / (star.branchCount! * 2), radius = i % 2 ? l / 2 - star.branchHeight! : l / 2;
      return { x: l / 2 + radius * Math.cos(angle), y: w / 2 + radius * Math.sin(angle) };
    });
  } else if (shape === 'gear') {
    // Decorative teeth only: no involute, module or meshing claim.
    const gear = normalizeBlank(definition);
    const pitch = TAU / gear.toothCount!;
    points = Array.from({ length: gear.toothCount! }, (_, tooth) =>
      [-.45, -.22, .22, .45].map((phase, index) => {
        const angle = tooth * pitch + phase * pitch, radius = index === 0 || index === 3 ? l / 2 - gear.toothHeight! : l / 2;
        return { x: l / 2 + radius * Math.cos(angle), y: w / 2 + radius * Math.sin(angle) };
      })).flat();
  } else if (shape === 'hexagon' || shape === 'octagon') {
    const count = shape === 'hexagon' ? 6 : 8;
    const radius = w / (2 * Math.cos(Math.PI / count));
    const phase = shape === 'hexagon' ? 0 : Math.PI / 8;
    points = Array.from({ length: count }, (_, i) => ({
      x: l / 2 + radius * Math.cos(phase + i * TAU / count),
      y: w / 2 + radius * Math.sin(phase + i * TAU / count),
    }));
  } else points = [{ x: 0, y: 0 }, { x: l, y: 0 }, { x: l, y: w }, { x: 0, y: w }];
  return points.map((p, i) => line(p, points[(i + 1) % points.length]));
}

function edgePoint(edge: BlankEdge, t: number): BlankPoint {
  if (edge.type === 'line') return {
    x: edge.from.x + (edge.to.x - edge.from.x) * t,
    y: edge.from.y + (edge.to.y - edge.from.y) * t,
  };
  const a = edge.start + edge.sweep * t;
  return { x: edge.center.x + edge.rx * Math.cos(a), y: edge.center.y + edge.ry * Math.sin(a) };
}
function arcContains(edge: Extract<BlankEdge, { type: 'ellipse' }>, angle: number): boolean {
  const delta = ((angle - edge.start) % TAU + TAU) % TAU;
  return delta <= edge.sweep + EPS || Math.abs(delta - TAU) < EPS;
}

/** Sampling is for display/PDF only. Four quadrants use 384 segments, matching
 * the existing 96-segments-per-quarter convention without degrading STEP.
 */
export function sampleBlank(definition: BlankDefinition, segmentsPerQuarter = 96): BlankPoint[] {
  if (!Number.isInteger(segmentsPerQuarter) || segmentsPerQuarter < 4 || segmentsPerQuarter > 512) {
    throw new Error('Résolution du contour invalide.');
  }
  return blankEdges(definition).flatMap(edge => {
    const count = edge.type === 'line' ? 1 : Math.max(1, Math.ceil(edge.sweep / (Math.PI / 2) * segmentsPerQuarter));
    return Array.from({ length: count }, (_, i) => edgePoint(edge, i / count));
  });
}

/** Exact area from Green's theorem, including elliptical/circular arcs. */
export function blankArea(definition: BlankDefinition): number {
  const area = Math.abs(blankEdges(definition).reduce((area, edge) => {
    if (edge.type === 'line') return area + (edge.from.x * edge.to.y - edge.to.x * edge.from.y) / 2;
    const a = edge.start, b = a + edge.sweep;
    return area + (edge.center.x * edge.ry * (Math.sin(b) - Math.sin(a))
      + edge.center.y * edge.rx * (Math.cos(a) - Math.cos(b)) + edge.rx * edge.ry * edge.sweep) / 2;
  }, 0));
  const normalized = normalizeBlank(definition);
  return area - (normalized.shape === 'washer' || normalized.shape === 'gear' ? Math.PI * ((normalized.innerDiameter || 0) / 2) ** 2 : 0);
}

/** Inner boundaries are not user holes: they belong to the blank itself. */
export function blankInnerContours(definition: BlankDefinition): BlankPoint[][] {
  const d = normalizeBlank(definition);
  if (!['washer', 'gear'].includes(d.shape) || !d.innerDiameter) return [];
  return [Array.from({ length: 384 }, (_, i) => {
    const a = i * TAU / 384, r = d.innerDiameter! / 2;
    return { x: d.length / 2 + r * Math.cos(a), y: d.width / 2 + r * Math.sin(a) };
  })];
}

/** Even/odd containment handles concave stars and tooth roots too. */
export function pointInBlank(definition: BlankDefinition, x: number, y: number): boolean {
  if (![x, y].every(Number.isFinite)) return false;
  const points = sampleBlank(definition);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx * (y - a.y) - dy * (x - a.x)) < 1e-6 &&
      x >= Math.min(a.x, b.x) - 1e-6 && x <= Math.max(a.x, b.x) + 1e-6 &&
      y >= Math.min(a.y, b.y) - 1e-6 && y <= Math.max(a.y, b.y) + 1e-6) { inside = true; break; }
    if ((a.y > y) !== (b.y > y) && x < dx * (y - a.y) / dy + a.x) inside = !inside;
  }
  if (!inside) return false;
  const d = normalizeBlank(definition);
  return !['washer', 'gear'].includes(d.shape) || Math.hypot(x - d.length / 2, y - d.width / 2) >= (d.innerDiameter || 0) / 2;
}

/** Exact support projection; fold positions must not depend on zoom or mesh
 * resolution, particularly when their line is tangent to a circular blank.
 */
export function blankProjection(definition: BlankDefinition, axis: BlankPoint): { min: number; max: number } {
  if (Math.abs(Math.hypot(axis.x, axis.y) - 1) > EPS) throw new Error('Axe de projection invalide.');
  const values = blankEdges(definition).flatMap(edge => {
    const points = [edgePoint(edge, 0), edgePoint(edge, 1)];
    if (edge.type === 'ellipse') {
      const a = Math.atan2(axis.y * edge.ry, axis.x * edge.rx);
      for (const angle of [a, a + Math.PI]) if (arcContains(edge, angle)) {
        points.push({ x: edge.center.x + edge.rx * Math.cos(angle), y: edge.center.y + edge.ry * Math.sin(angle) });
      }
    }
    return points.map(point => dot(point, axis));
  });
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Intersect an infinite fold line with the convex analytical outline. A
 * tangent produces only one hit and is deliberately not a valid fold.
 */
export function intersectBlankLine(definition: BlankDefinition, normal: BlankPoint, offset: number): BlankPoint[] {
  const hits: BlankPoint[] = [];
  const add = (point: BlankPoint) => {
    if (!hits.some(hit => Math.hypot(hit.x - point.x, hit.y - point.y) < EPS)) hits.push(point);
  };
  for (const edge of blankEdges(definition)) {
    if (edge.type === 'line') {
      const a = dot(edge.from, normal) - offset, b = dot(edge.to, normal) - offset;
      if (Math.abs(a) < EPS) add(edge.from);
      if (Math.abs(b) < EPS) add(edge.to);
      if (a * b < 0) add(edgePoint(edge, a / (a - b)));
    } else {
      const A = normal.x * edge.rx, B = normal.y * edge.ry;
      const amplitude = Math.hypot(A, B), value = offset - dot(edge.center, normal);
      if (amplitude < EPS || Math.abs(value) > amplitude + EPS) continue;
      const phase = Math.atan2(B, A), delta = Math.acos(Math.max(-1, Math.min(1, value / amplitude)));
      for (const angle of [phase + delta, phase - delta]) if (arcContains(edge, angle)) {
        add({ x: edge.center.x + edge.rx * Math.cos(angle), y: edge.center.y + edge.ry * Math.sin(angle) });
      }
    }
  }
  const along = { x: -normal.y, y: normal.x };
  return hits.sort((a, b) => dot(a, along) - dot(b, along));
}

export function resolveParallelFolds(definition: BlankDefinition, layout: BlankFoldLayout, thickness: number) {
  if (!Number.isFinite(layout.orientation) || !Number.isFinite(thickness) || thickness <= 0 || layout.folds.length > 4) {
    throw new Error('Configuration des plis invalide.');
  }
  const angle = layout.orientation * Math.PI / 180;
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const extent = blankProjection(definition, normal);
  const clearance = Math.max(4, thickness * 3.5);
  const ids = new Set<string>();
  let previous = 0;
  return layout.folds.map(fold => {
    if (!fold.id || ids.has(fold.id) || !Number.isFinite(fold.position) || !Number.isFinite(fold.angle)
      || fold.angle < 15 || fold.angle > 165 || (fold.direction !== 1 && fold.direction !== -1)) {
      throw new Error('Pli invalide.');
    }
    ids.add(fold.id);
    // Preserve identities and order instead of silently sorting user's folds.
    if (fold.position - previous <= (previous === 0 ? clearance : 2 * clearance)
      || extent.max - extent.min - fold.position <= clearance) {
      throw new Error('Les plis sont trop proches entre eux ou du bord.');
    }
    previous = fold.position;
    const offset = extent.min + fold.position;
    const intersections = intersectBlankLine(definition, normal, offset);
    if (intersections.length !== 2 || Math.hypot(intersections[0].x - intersections[1].x, intersections[0].y - intersections[1].y) <= 2 * clearance) {
      throw new Error('Le pli doit traverser suffisamment de matière.');
    }
    return { ...fold, normal, offset, start: intersections[0], end: intersections[1], clearance };
  });
}

/** Exact hole-envelope projection on each fold normal. Call this for every
 * instance in a matrix and at the final save/export barrier, not only hover.
 * A positive gap is required: touching the protected zone is also rejected.
 */
export function holeClearsParallelFolds(center: BlankPoint, halfLength: number, halfWidth: number,
  folds: ReturnType<typeof resolveParallelFolds>): boolean {
  if (![center.x, center.y, halfLength, halfWidth].every(Number.isFinite) || halfLength <= 0 || halfWidth <= 0) return false;
  return folds.every(fold => Math.abs(dot(center, fold.normal) - fold.offset)
    > fold.clearance + Math.abs(fold.normal.x) * halfLength + Math.abs(fold.normal.y) * halfWidth + EPS);
}
