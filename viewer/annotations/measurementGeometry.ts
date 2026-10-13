import { EdgesGeometry, Vector3, type BufferGeometry } from 'three';

export type MeasureFeature = { id: string; kind: 'corner' | 'edge' | 'hole' | 'bend'; a: Vector3; b?: Vector3; label: string };
export function closestOnEdge(point: Vector3, a: Vector3, b: Vector3) {
  const delta = b.clone().sub(a);
  const t = delta.lengthSq() ? Math.max(0, Math.min(1, point.clone().sub(a).dot(delta) / delta.lengthSq())) : 0;
  return a.clone().addScaledVector(delta, t);
}
/** Minimum distance between finite segments, including skew/parallel edges. */
export function featureDistance(first: MeasureFeature, second: MeasureFeature): [Vector3, Vector3] {
  if (!first.b && !second.b) return [first.a.clone(), second.a.clone()];
  if (!first.b) return [first.a.clone(), closestOnEdge(first.a, second.a, second.b!)];
  if (!second.b) return [closestOnEdge(second.a, first.a, first.b), second.a.clone()];
  const pairs: [Vector3, Vector3][] = [
    [first.a.clone(), closestOnEdge(first.a, second.a, second.b)],
    [first.b.clone(), closestOnEdge(first.b, second.a, second.b)],
    [closestOnEdge(second.a, first.a, first.b), second.a.clone()],
    [closestOnEdge(second.b, first.a, first.b), second.b.clone()],
  ];
  const u = first.b.clone().sub(first.a), v = second.b.clone().sub(second.a), w = first.a.clone().sub(second.a);
  const a = u.dot(u), b = u.dot(v), c = v.dot(v), d = u.dot(w), e = v.dot(w), denominator = a * c - b * b;
  if (denominator > 1e-10 * a * c) {
    const s = (b * e - c * d) / denominator, t = (a * e - b * d) / denominator;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) pairs.push([first.a.clone().addScaledVector(u, s), second.a.clone().addScaledVector(v, t)]);
  }
  return pairs.reduce((best, pair) => pair[0].distanceToSquared(pair[1]) < best[0].distanceToSquared(best[1]) ? pair : best);
}
/** Physical sharp edges, not triangulation. Collinear CSG fragments are joined. */
export function meshFeatures(geometry: BufferGeometry): MeasureFeature[] {
  const edges = new EdgesGeometry(geometry, 25), positions = edges.getAttribute('position');
  const key = (v: Vector3) => [v.x, v.y, v.z].map(value => Math.round(value * 1000)).join(',');
  const segments: { a: Vector3; b: Vector3; used: boolean }[] = [];
  const adjacency = new Map<string, number[]>();
  for (let index = 0; index < positions.count; index += 2) {
    const a = new Vector3().fromBufferAttribute(positions, index), b = new Vector3().fromBufferAttribute(positions, index + 1);
    if (a.distanceToSquared(b) < 1e-8) continue;
    const id = segments.push({ a, b, used: false }) - 1;
    for (const point of [a, b]) adjacency.set(key(point), [...(adjacency.get(key(point)) || []), id]);
  }
  edges.dispose();
  const output: MeasureFeature[] = [], corners = new Map<string, Vector3>();
  for (const segment of segments) {
    if (segment.used) continue;
    segment.used = true;
    let a = segment.a.clone(), b = segment.b.clone();
    for (const end of ['a', 'b'] as const) {
      let growing = true;
      while (growing) {
        growing = false;
        const point = end === 'a' ? a : b, opposite = end === 'a' ? b : a;
        for (const index of adjacency.get(key(point)) || []) {
          const next = segments[index];
          if (next.used) continue;
          const other = key(next.a) === key(point) ? next.b : next.a;
          if (point.clone().sub(opposite).normalize().dot(other.clone().sub(point).normalize()) > .99999) {
            next.used = true;
            if (end === 'a') a = other.clone(); else b = other.clone();
            growing = true;
            break;
          }
        }
      }
    }
    // Do not expose smooth curve tessellation as individual corners.
    const sharp = (point: Vector3, other: Vector3) => (adjacency.get(key(point)) || []).some(index => {
      const next = segments[index], tip = key(next.a) === key(point) ? next.b : next.a;
      return Math.abs(other.clone().sub(point).normalize().dot(tip.clone().sub(point).normalize())) < Math.cos(Math.PI / 6);
    });
    if (!sharp(a, b) && !sharp(b, a)) continue;
    output.push({ id: `edge-${key(a)}-${key(b)}`, kind: 'edge', a, b, label: 'Arête' });
    if (sharp(a, b)) corners.set(key(a), a);
    if (sharp(b, a)) corners.set(key(b), b);
  }
  return [...output, ...Array.from(corners, ([id, a]) => ({ id: `corner-${id}`, kind: 'corner' as const, a, label: 'Coin' }))];
}
