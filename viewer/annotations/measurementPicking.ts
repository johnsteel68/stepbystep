import { Raycaster, Vector2, Vector3, Mesh, type Camera, type Object3D } from 'three';
import { closestOnEdge, meshFeatures, type MeasureFeature } from './measurementGeometry.ts';
import type { BendMeasurementReference } from './bendMeasurement.ts';

const EDGE_PICK_RADIUS_PX = 10;
const POINT_PICK_RADIUS_PX = 18;
const OCCLUSION_TOLERANCE_MM = 0.15;

// À distance comparable, privilégier un centre de trou, puis un coin.
const FEATURE_PRIORITY_PX = { hole: 0, corner: 2, bend: 4, edge: 8 } as const;

interface HoleReference {
  id: string;
  point: [number, number, number];
  label: string;
}
interface CachedMeshFeatures {
  geometry: Mesh['geometry'];
  features: MeasureFeature[];
}

/** Sélecteur propre à une session : cache de topologie locale, matrices à jour.
 * La sélection utilise des pixels ; les repères retournés sont en millimètres.
 * Ni le sol, ni les étiquettes ne sont des surfaces mesurables. */
export function createMeasurementPicker(
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>,
  camera: Camera,
  scene: Object3D,
): (event: Pick<MouseEvent, 'clientX' | 'clientY'>) => MeasureFeature | null {
  const raycaster = new Raycaster();
  const cache = new WeakMap<Mesh, CachedMeshFeatures>();

  function collectWorldFeatures() {
    const surfaces: Object3D[] = [];
    const features: MeasureFeature[] = [];
    scene.updateMatrixWorld(true);

    scene.traverse(object => {
      if (!object.visible) return;
      for (let parent = object.parent; parent; parent = parent.parent) {
        if (!parent.visible) return;
      }

      const holes = (object.userData.measureHoles || []) as HoleReference[];
      for (const hole of holes) {
        features.push({
          id: `${object.uuid}-${hole.id}`,
          kind: 'hole',
          a: new Vector3(...hole.point).applyMatrix4(object.matrixWorld),
          label: hole.label,
        });
      }

      for (const bend of (object.userData.measureBends || []) as BendMeasurementReference[]) {
        features.push({ id: `${object.uuid}-${bend.id}`, kind: 'bend', label: bend.label,
          a: new Vector3(...bend.a).applyMatrix4(object.matrixWorld),
          b: new Vector3(...bend.b).applyMatrix4(object.matrixWorld) });
      }

      if (!(object instanceof Mesh) || !object.userData.measureSurface) return;
      surfaces.push(object);
      let entry = cache.get(object);
      // Une nouvelle géométrie CSG remplace le cache ; un simple déplacement non.
      if (!entry || entry.geometry !== object.geometry) {
        entry = { geometry: object.geometry, features: meshFeatures(object.geometry) };
        cache.set(object, entry);
      }
      for (const feature of entry.features) {
        features.push({
          ...feature,
          id: `${object.uuid}-${feature.id}`,
          a: feature.a.clone().applyMatrix4(object.matrixWorld),
          b: feature.b?.clone().applyMatrix4(object.matrixWorld),
        });
      }
    });
    return { surfaces, features };
  }

  return event => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const cursor = new Vector3(event.clientX - bounds.left, event.clientY - bounds.top, 0);
    const { surfaces, features } = collectWorldFeatures();
    const project = (point: Vector3) => point.clone().project(camera);
    const toPixels = (point: Vector3) => {
      const projected = project(point);
      return new Vector3(
        (projected.x + 1) * bounds.width / 2,
        (1 - projected.y) * bounds.height / 2,
        0,
      );
    };

    let bestFeature: MeasureFeature | null = null;
    let bestScore = Infinity;
    for (const feature of features) {
      const start = toPixels(feature.a);
      const end = feature.b ? toPixels(feature.b) : start;
      const closest = closestOnEdge(cursor, start, end);
      const distancePx = closest.distanceTo(cursor);
      const pickRadius = feature.b ? EDGE_PICK_RADIUS_PX : POINT_PICK_RADIUS_PX;
      if (distancePx > pickRadius) continue;

      const screenLength = start.distanceTo(end);
      const fraction = screenLength > 0 ? start.distanceTo(closest) / screenLength : 0;
      const target = feature.b ? feature.a.clone().lerp(feature.b, fraction) : feature.a;
      const projected = project(target);
      if (projected.z < -1 || projected.z > 1) continue;

      // Tester la visibilité du repère, pas seulement sa proximité au curseur :
      // un trou de la face arrière ne doit pas être choisi à travers le métal.
      raycaster.setFromCamera(new Vector2(projected.x, projected.y), camera);
      const hit = raycaster.intersectObjects(surfaces, false)[0];
      const targetDepth = target.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction);
      if (hit && hit.distance < targetDepth - OCCLUSION_TOLERANCE_MM) continue;

      const score = distancePx + FEATURE_PRIORITY_PX[feature.kind];
      if (score < bestScore) {
        bestScore = score;
        bestFeature = feature;
      }
    }
    return bestFeature;
  };
}
