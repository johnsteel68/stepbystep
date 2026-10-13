import { normalizeTextRotation } from '../textRotation.ts';

/** Geste autour du centre. Le passage de -π à π est continu modulo 360°.
 * Maj active les crans à 45° ; sinon la poignée suit l'angle au degré près. */
export function cornerTextRotation(initial: number, startAngle: number, pointerAngle: number, snap = false): number {
  const delta = Math.atan2(Math.sin(pointerAngle - startAngle), Math.cos(pointerAngle - startAngle));
  const angle = initial + delta * 180 / Math.PI;
  return normalizeTextRotation(snap ? Math.round(angle / 45) * 45 : Math.round(angle));
}
