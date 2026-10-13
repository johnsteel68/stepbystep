import { useMemo, useEffect } from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SheetFinish } from '../../sheetGeometry';
import { TEXTURE_SETS, FINISH_TEXTURE_PROFILES, type TextureSet } from './textureCatalog';
import { ResilientTextureLoader } from './ResilientTextureLoader';
import { applyProtectiveFilm, type FilmPeel } from './protectiveFilm';

type SheetMaterialBundle = {
  material: THREE.MeshPhysicalMaterial | THREE.MeshPhysicalMaterial[];
  cutMaterial: THREE.MeshPhysicalMaterial;
  oneSidedRelief: boolean;
};

export function useImportedPbrMaterial(finish: SheetFinish, realistic: boolean, textureRotation = 0, filmPeel?: FilmPeel): SheetMaterialBundle {
  const profile = FINISH_TEXTURE_PROFILES[finish];
  const set: TextureSet = TEXTURE_SETS[profile.set];
  const maxAnisotropy = useThree(({ gl }) => gl.capabilities.getMaxAnisotropy());
  const useHighResolutionColor = useThree(({ gl, size }) => size.width >= 900 && gl.capabilities.maxTextureSize >= 4096);
  const colorUrl = useHighResolutionColor ? set.colorHighResolution || set.color : set.color;
  const entries = useMemo(() => ([
    ['color', colorUrl],
    ...(set.normal ? [['normal', set.normal] as const] : []),
    ...(set.roughness ? [['roughness', set.roughness] as const] : []),
    ...(set.height ? [['height', set.height] as const] : []),
    ...(set.metalness ? [['metalness', set.metalness] as const] : []),
    ...(set.alpha ? [['alpha', set.alpha] as const] : []),
  ] as const), [colorUrl, set]);
  const loadedMaps = useLoader(ResilientTextureLoader, entries.map(([, url]) => url));
  // Each scene owns its texture transforms, including the zero-degree case.
  // Exporting or changing grain must never rotate the shared loader cache.
  const ownedMaps = useMemo(() => loadedMaps.map(map => map.clone()), [loadedMaps]);
  useEffect(() => () => ownedMaps.forEach(map => map.dispose()), [ownedMaps]);
  const maps = new Map(entries.map(([name], index) => [name, ownedMaps[index]]));
  const colorMap = maps.get('color')!;
  const normalMap = maps.get('normal') ?? null;
  const roughnessMap = maps.get('roughness') ?? null;
  const heightMap = maps.get('height') ?? null;
  const metalnessMap = maps.get('metalness') ?? null;
  const alphaMap = maps.get('alpha') ?? null;

  useEffect(() => {
    maps.forEach((map, name) => {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1 / set.tileSize, 1 / set.tileSize);
      map.rotation = textureRotation;
      map.anisotropy = Math.min(maxAnisotropy, 8);
      if (name === 'color') map.colorSpace = THREE.SRGBColorSpace;
      map.needsUpdate = true;
    });
  }, [entries, maxAnisotropy, set.tileSize, textureRotation, ownedMaps]);

  const bundle = useMemo<SheetMaterialBundle>(() => {
    const common = {
      roughness: Math.min(1, profile.roughness + (profile.oneSidedRelief ? 0.08 : 0.2)),
      metalness: profile.metalness,
      envMapIntensity: realistic ? 0.55 : 0.4,
      // Metal already carries a strong specular response; keep the extra
      // clearcoat subtle and broad so studio lights don't read as hard glare.
      clearcoat: Math.min(profile.clearcoat * 0.2, 0.08),
      clearcoatRoughness: 0.8,
      side: THREE.DoubleSide,
    };
    const textured = new THREE.MeshPhysicalMaterial({
      ...common,
      // Inox cuir uses a lighting-free height map. The reference photograph
      // belongs in the swatch only: baked highlights must not tint the metal.
      map: profile.leatherRelief ? null : colorMap,
      normalMap,
      roughnessMap,
      bumpMap: heightMap,
      metalnessMap,
      alphaMap,
      alphaTest: alphaMap ? 0.48 : 0,
      transparent: false,
      bumpScale: profile.bumpScale,
      color: profile.tint || '#ffffff',
      normalScale: new THREE.Vector2(profile.normalScale, profile.normalScale),
    });
    if (profile.mirrorFace) {
      // A polished face must not inherit the broad-reflection preset or
      // relief maps: microscopic relief would blur the reflected studio.
      textured.roughness = profile.roughness;
      textured.metalness = 1;
      textured.envMapIntensity = 1;
      textured.map = colorMap;
      textured.normalMap = null;
      textured.bumpMap = null;
      textured.roughnessMap = null;
      textured.metalnessMap = null;
      textured.color.set('#ffffff');
    }
    if (roughnessMap && !profile.mirrorFace) {
      // Three.js multiplies roughness by the map's green channel. Preserve its
      // variation while lifting dark pixels that produce sharp studio glints.
      textured.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness;
           #ifdef USE_ROUGHNESSMAP
             vec4 texelRoughness = texture2D(roughnessMap, vRoughnessMapUv);
             roughnessFactor *= mix(0.72, 1.0, texelRoughness.g);
           #endif`,
        );
      };
    }

    if (profile.protectiveFilm) {
      // Retain metal relief under the peeled corner; the film shader masks
      // these normals only on the covered area.
      // The revealed area uses the finish's own roughness, not the plastic
      // preset. Only filmCover in the shader supplies the satin film response.
      textured.roughness = profile.roughness;
      applyProtectiveFilm(textured, filmPeel);
    }

    if (!profile.oneSidedRelief) {
      return { material: textured, cutMaterial: textured, oneSidedRelief: false };
    }

    // One-sided finishes use the same upper-face assignment as tread plate.
    // The reverse face, cut edges and hole walls never inherit that finish.
    const smooth = new THREE.MeshPhysicalMaterial({
      ...common,
      color: profile.smoothTint || profile.tint || '#aeb4bc',
      ...(profile.mirrorFace ? { roughness: 0.7, envMapIntensity: 0.45, clearcoat: 0 } : {}),
    });
    // CSG treats every brush material as a distinct material group. Reusing
    // the base face material for a subtraction makes three-bvh-csg resolve a
    // missing group when it builds the cut surface, leaving the whole plate
    // invisible (notably a flat tread plate with its first hole). Keep the
    // cut finish visually identical, but give the subtraction its own clone.
    return { material: [smooth, textured, smooth], cutMaterial: smooth.clone(), oneSidedRelief: true };
  }, [alphaMap, colorMap, finish, heightMap, metalnessMap, normalMap, profile, realistic, roughnessMap, filmPeel]);

  useEffect(() => () => {
    const materials = Array.isArray(bundle.material) ? bundle.material : [bundle.material];
    new Set([...materials, bundle.cutMaterial]).forEach((material) => material.dispose());
  }, [bundle]);

  return bundle;
}
