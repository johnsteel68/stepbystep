import { BufferGeometry, Float32BufferAttribute, Vector3, type MeshPhysicalMaterial } from 'three';
import { getFlatCornerRadii, getHoleRadii, getPatternPositions, type LegTransform, type SheetMetalState } from '../../sheetGeometry.ts';

export interface FilmPeel {
  origin: Vector3;
  along: Vector3;
  across: Vector3;
  normal: Vector3;
  size: number;
}

/** Pick an intact free corner. Never add plastic across a cutout or a bend.
 * Shaped blanks keep the film surface but not this rectangular-corner detail.
 */
export function filmPeelCorner(state: SheetMetalState, legs: LegTransform[]): FilmPeel | undefined {
  if (state.finish !== 'aluminum-filmed' || state.blankShape) return;
  const wing = legs[0], leg = state.legs[0];
  if (!wing || !leg) return;
  const radii = getFlatCornerRadii(state);
  const straightLength = Math.hypot(wing.bendStart.x - wing.tip.x, wing.bendStart.y - wing.tip.y);
  const size = Math.min(32, straightLength * .22, state.width * .22);
  if (size < 4) return;
  const cuts = leg.hasHole ? getPatternPositions(leg, state.width, leg.holePattern || state.holePattern, state.thickness, state.bendCount > 0) : [];
  for (const side of [0, 1]) {
    const cornerRadius = state.bendCount === 0
      ? (side ? radii.endRight : radii.endLeft)
      : (side ? radii.startRight : radii.startLeft);
    if (cornerRadius > 0) continue;
    const intersects = cuts.some(cut => {
      const definition = { ...leg, holeShape: cut.shape || leg.holeShape, holeDiam: cut.diam ?? leg.holeDiam,
        holeLength: cut.length ?? leg.holeLength, holeWidth: cut.width ?? leg.holeWidth, holeContour: cut.contour,
        holeOrientation: cut.orientation || leg.holeOrientation };
      const extent = getHoleRadii(definition);
      // Conservative rectangle around each opening, including text contours.
      const nearWidth = side ? state.width - cut.offset : cut.offset;
      return cut.dist - extent.rx < size + 2 && nearWidth - extent.rz < size + 2;
    });
    if (intersects) continue;
    const normal = new Vector3(wing.normal.x, wing.normal.y, 0);
    return { origin: new Vector3(wing.tip.x, wing.tip.y, side ? state.width : 0).addScaledVector(normal, Math.max(1, state.thickness) / 2),
      along: new Vector3(wing.direction.x, wing.direction.y, 0), across: new Vector3(0, 0, side ? -1 : 1), normal, size };
  }
}

/** A thin curled triangle, independent of CAD/CSG, in the sheet's local datum. */
export function createFilmPeelGeometry(peel: FilmPeel): BufferGeometry {
  const vertices: number[] = [], segments = 24;
  const curvature = 2.45 / (peel.size / Math.SQRT2);
  const point = (u: number, v: number) => {
    const distance = Math.max(0, (peel.size - u - v) / Math.SQRT2);
    const theta = distance * curvature;
    const inward = Math.sin(theta) / curvature / Math.SQRT2;
    return peel.origin.clone()
      .addScaledVector(peel.along, u + distance / Math.SQRT2 - inward)
      .addScaledVector(peel.across, v + distance / Math.SQRT2 - inward)
      .addScaledVector(peel.normal, .06 + (1 - Math.cos(theta)) / curvature);
  };
  const triangle = (...points: Vector3[]) => points.forEach(p => vertices.push(p.x, p.y, p.z));
  for (let i = 0; i < segments; i++) for (let j = 0; j < segments - i; j++) {
    const unit = peel.size / segments;
    triangle(point(i * unit, j * unit), point((i + 1) * unit, j * unit), point(i * unit, (j + 1) * unit));
    if (i + j < segments - 1) triangle(point((i + 1) * unit, j * unit), point((i + 1) * unit, (j + 1) * unit), point(i * unit, (j + 1) * unit));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Finish-face shader only: holes stay empty because the existing CSG mesh
 * provides the mask. The reverse, edge and subtraction materials are untouched.
 */
export function applyProtectiveFilm(material: MeshPhysicalMaterial, peel?: FilmPeel) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      filmOrigin: { value: peel?.origin || new Vector3() },
      filmAlong: { value: peel?.along || new Vector3(1, 0, 0) },
      filmAcross: { value: peel?.across || new Vector3(0, 0, 1) },
      filmSize: { value: peel?.size || 0 },
    });
    shader.vertexShader = 'varying vec3 vFilmPosition;\nvarying vec2 vFilmUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFilmPosition = position; vFilmUv = uv;');
    shader.fragmentShader = `varying vec3 vFilmPosition;
      varying vec2 vFilmUv;
      uniform vec3 filmOrigin, filmAlong, filmAcross;
      uniform float filmSize;
      float filmBubble(vec2 p, vec2 center, float radius) {
        vec2 d = (p - center) / radius;
        return exp(-dot(d,d) * 2.0);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec3 filmLocal = vFilmPosition - filmOrigin;
      float filmU = dot(filmLocal, filmAlong), filmV = dot(filmLocal, filmAcross);
      float filmCover = 1.0;
      if (filmSize > 0.0 && filmU >= -0.01 && filmV >= -0.01 && filmU + filmV < filmSize) filmCover = 0.0;
      vec2 bubbleUv = mod(vFilmUv, 230.0);
      float filmHeight = filmCover * (0.22 * filmBubble(bubbleUv, vec2(25.0,40.0), 4.0)
        + 0.15 * filmBubble(bubbleUv, vec2(170.0,130.0), 3.0)
        + 0.09 * filmBubble(bubbleUv, vec2(90.0,195.0), 2.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.91,0.925,0.94), filmCover);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.48, filmCover);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, filmCover);');
    // Screen derivatives perturb lighting without displacing the physical mesh.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 filmDx = dFdx(-vViewPosition), filmDy = dFdy(-vViewPosition);
      vec3 filmR1 = cross(filmDy, normal), filmR2 = cross(normal, filmDx);
      float filmDet = dot(filmDx, filmR1);
      vec3 filmGradient = sign(filmDet) * (dFdx(filmHeight) * filmR1 + dFdy(filmHeight) * filmR2);
      if (abs(filmDet) > 0.00000001) normal = normalize(abs(filmDet) * normal - filmGradient);
    `);
  };
  material.customProgramCacheKey = () => 'protective-film-v1';
}
