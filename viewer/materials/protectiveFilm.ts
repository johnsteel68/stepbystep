import { BufferGeometry, Float32BufferAttribute, Vector3, type MeshPhysicalMaterial } from 'three';
import { getFlatCornerRadii, getHoleRadii, getPatternPositions, type LegTransform, type SheetMetalState } from '../../sheetGeometry.ts';
import { FINISH_TEXTURE_PROFILES } from './textureCatalog.ts';

export interface FilmPeel {
  origin: Vector3;
  along: Vector3;
  across: Vector3;
  normal: Vector3;
  size: number;
  maxSize?: number;
}

/** Pick an intact free corner. Never add plastic across a cutout or a bend.
 * Shaped blanks keep the film surface but not this rectangular-corner detail.
 */
export function filmPeelCorner(state: SheetMetalState, legs: LegTransform[]): FilmPeel | undefined {
  if (!state.finish || !FINISH_TEXTURE_PROFILES[state.finish].protectiveFilm || state.blankShape) return;
  const wing = legs[0], leg = state.legs[0];
  if (!wing || !leg) return;
  const radii = getFlatCornerRadii(state);
  const straightLength = Math.hypot(wing.bendStart.x - wing.tip.x, wing.bendStart.y - wing.tip.y);
  // Expose enough real metal to read its grain/relief, rather than a tiny
  // decorative sliver. Keep the peel inside the straight, uncut wing.
  const size = Math.min(120, straightLength * .4, state.width * .4);
  if (size < 6) return;
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
    // Dragging can uncover more of this same corner, but must stay short of
    // bends and openings. The visible film never becomes manufacturing data.
    const maxSize = cuts.reduce((limit, cut) => {
      const extent = getHoleRadii({ ...leg, holeShape: cut.shape || leg.holeShape, holeDiam: cut.diam ?? leg.holeDiam,
        holeLength: cut.length ?? leg.holeLength, holeWidth: cut.width ?? leg.holeWidth,
        holeOrientation: cut.orientation || leg.holeOrientation });
      return Math.min(limit, Math.max(cut.dist - extent.rx, (side ? state.width - cut.offset : cut.offset) - extent.rz) - 2);
    }, Math.min(280, straightLength * .85, state.width * .85));
    const normal = new Vector3(wing.normal.x, wing.normal.y, 0);
    return { origin: new Vector3(wing.tip.x, wing.tip.y, side ? state.width : 0).addScaledVector(normal, Math.max(1, state.thickness) / 2),
      along: new Vector3(wing.direction.x, wing.direction.y, 0), across: new Vector3(0, 0, side ? -1 : 1), normal, size, maxSize: Math.max(size, maxSize) };
  }
}

/** A thin curled triangle, independent of CAD/CSG, in the sheet's local datum. */
export function createFilmPeelGeometry(peel: FilmPeel, existing?: BufferGeometry): BufferGeometry {
  const segments = 24;
  const geometry = existing || new BufferGeometry();
  // Reuse the same GPU buffer during dragging: no React state, CSG rebuild,
  // geometry allocation or per-vertex Vector3 allocation on animation frames.
  if (!existing) geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(segments * segments * 9), 3));
  const positions = geometry.getAttribute('position');
  const vertices = positions.array;
  let cursor = 0;
  // Roll the flap back almost half a turn: its projection covers less of the
  // exposed triangle, while its raised silhouette remains visibly plastic.
  const curvature = 2.9 / (peel.size / Math.SQRT2);
  const point = (u: number, v: number) => {
    const distance = Math.max(0, (peel.size - u - v) / Math.SQRT2);
    const theta = distance * curvature;
    const inward = Math.sin(theta) / curvature / Math.SQRT2;
    const a = u + distance / Math.SQRT2 - inward;
    const b = v + distance / Math.SQRT2 - inward;
    const height = .06 + (1 - Math.cos(theta)) / curvature;
    for (const axis of ['x', 'y', 'z'] as const) {
      vertices[cursor++] = peel.origin[axis] + peel.along[axis] * a + peel.across[axis] * b + peel.normal[axis] * height;
    }
  };
  for (let i = 0; i < segments; i++) for (let j = 0; j < segments - i; j++) {
    const unit = peel.size / segments;
    point(i * unit, j * unit); point((i + 1) * unit, j * unit); point(i * unit, (j + 1) * unit);
    if (i + j < segments - 1) {
      point((i + 1) * unit, j * unit); point((i + 1) * unit, (j + 1) * unit); point(i * unit, (j + 1) * unit);
    }
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const filmSizeUniforms = new WeakMap<MeshPhysicalMaterial, { value: number }>();
const filmCoverageUniforms = new WeakMap<MeshPhysicalMaterial, { value: number }>();

export function setProtectiveFilmCoverage(material: MeshPhysicalMaterial, coverage: number) {
  const uniform = filmCoverageUniforms.get(material);
  if (uniform) uniform.value = Math.max(0, Math.min(1, coverage));
}

/** Update only the cosmetic shader mask, never the sheet/CAD geometry. */
export function setProtectiveFilmSize(material: MeshPhysicalMaterial, size: number) {
  const uniform = filmSizeUniforms.get(material);
  if (uniform) uniform.value = size;
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
      // Explicit opt-in by the workflow layer; other views/export stay bare.
      filmOpacity: { value: 0 },
    });
    filmSizeUniforms.set(material, shader.uniforms.filmSize);
    filmCoverageUniforms.set(material, shader.uniforms.filmOpacity);
    shader.vertexShader = 'varying vec3 vFilmPosition;\nvarying vec2 vFilmUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFilmPosition = position; vFilmUv = uv;');
    shader.fragmentShader = `varying vec3 vFilmPosition;
      varying vec2 vFilmUv;
      uniform vec3 filmOrigin, filmAlong, filmAcross;
      uniform float filmSize, filmOpacity;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec3 filmLocal = vFilmPosition - filmOrigin;
      float filmU = dot(filmLocal, filmAlong), filmV = dot(filmLocal, filmAcross);
      float filmCover = 1.0;
      if (filmSize > 0.0 && filmU >= -0.01 && filmV >= -0.01 && filmU + filmV < filmSize) filmCover = 0.0;
      filmCover *= filmOpacity;
      // The plate stays opaque; transparency belongs to the protective layer.
      // Retain the underlying metal map instead of replacing it with blue paint.
      vec3 filmTintedMetal = mix(diffuseColor.rgb, vec3(0.035,0.28,0.68), 0.3);
      diffuseColor.rgb = mix(diffuseColor.rgb, filmTintedMetal, filmCover);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.24, filmCover * 0.7);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, filmCover * 0.55);');
    // Screen derivatives perturb lighting without displacing the physical mesh.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `vec3 filmBaseNormal = normal;
      #include <normal_fragment_maps>
      // Preserve the actual metal relief where the film is peeled away.
      normal = normalize(mix(normal, filmBaseNormal, filmCover * 0.6));
    `);
  };
  material.customProgramCacheKey = () => 'protective-film-workflow-v4';
}
