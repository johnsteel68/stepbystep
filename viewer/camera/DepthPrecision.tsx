import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { perspectiveDepthRange } from './depthRange';

/** Runs after orbit/transition controllers and before rendering. */
export function DepthPrecision({ sceneSpan }: { sceneSpan: number }) {
  useFrame(({ camera, controls }) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
    if (!target) return;
    const { near, far } = perspectiveDepthRange(camera.position.distanceTo(target), sceneSpan);
    if (Math.abs(camera.near - near) < near * 0.001 && Math.abs(camera.far - far) < far * 0.001) return;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  });
  return null;
}
