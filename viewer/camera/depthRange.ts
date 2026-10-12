/** Millimetre scenes need a near plane that follows viewing distance.
 * A fixed 0.1 mm near plane loses more than a thin sheet's thickness at
 * normal framing distances, making front/back CSG triangles fight. */
export function perspectiveDepthRange(distance: number, sceneSpan: number) {
  const safeDistance = Math.max(1, distance);
  return {
    near: Math.max(0.1, safeDistance * 0.01),
    far: Math.max(1000, safeDistance + Math.max(1, sceneSpan) * 4),
  };
}
