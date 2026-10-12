import { Vector3 } from 'three';

/** Rotate around the orbit target without changing elevation or distance. */
export function orbitPositionAtAngle(position: Vector3, target: Vector3, degrees: number): Vector3 {
  const offset = position.clone().sub(target);
  const radius = Math.hypot(offset.x, offset.z);
  const angle = degrees * Math.PI / 180;
  return new Vector3(radius * Math.sin(angle), offset.y, radius * Math.cos(angle)).add(target);
}

export function orbitAngle(position: Vector3, target: Vector3): number {
  return Math.round(Math.atan2(position.x - target.x, position.z - target.z) * 180 / Math.PI);
}
