import { Vector3 } from 'three';
import type { LegTransform, SheetMetalState } from '../../sheetGeometry.ts';

export interface WingDimensionLayout {
  baseStart: Vector3;
  baseEnd: Vector3;
  start: Vector3;
  end: Vector3;
  outward: Vector3;
  normal: Vector3;
  value: number;
}

/** Cotations dans le plan de l'aile, pas dans le plan du profil XY.
 * Les longueurs extérieures conservent les reculs virtuels des plis ; la
 * largeur est portée par le bord libre de la dernière aile (au-dessus en L).
 */
export function wingDimensionLayout(leg: LegTransform, state: SheetMetalState, kind: 'length' | 'width'): WingDimensionLayout {
  const setback = (index: number) => index < 0 || index >= state.bendCount ? 0
    : state.thickness * 2 * Math.tan(Math.max(15, Math.min(165, Math.abs(state.bends[index]?.angle ?? 90))) * Math.PI / 360);
  const terminal = leg.index === state.bendCount;
  const along = new Vector3(leg.direction.x, leg.direction.y, 0);
  const normal = new Vector3(leg.normal.x, leg.normal.y, 0);
  const tip = new Vector3(leg.tip.x, leg.tip.y, 0).addScaledVector(along, terminal ? 0 : -setback(leg.index - 1)).addScaledVector(normal, state.thickness / 2);
  const bend = new Vector3(leg.bendStart.x, leg.bendStart.y, 0).addScaledVector(along, terminal ? setback(leg.index - 1) : setback(leg.index)).addScaledVector(normal, state.thickness / 2);
  const offset = Math.max(16, Math.min(80, Math.max(state.width, leg.length) * .1));
  const outward = kind === 'length' ? new Vector3(0, 0, leg.index % 2 ? 1 : -1) : along.clone().negate();
  const baseStart = tip.clone(), baseEnd = kind === 'length' ? bend.clone() : tip.clone();
  if (kind === 'length') baseStart.z = baseEnd.z = leg.index % 2 ? state.width : 0;
  else baseEnd.z = state.width;
  return { baseStart, baseEnd, start: baseStart.clone().addScaledVector(outward, offset),
    end: baseEnd.clone().addScaledVector(outward, offset), outward, normal,
    value: kind === 'length' ? leg.length : state.width };
}
