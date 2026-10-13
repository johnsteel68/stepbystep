import { useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import type { LegTransform, SheetMetalState } from '../../sheetGeometry';
import { getMaxLegLength } from '../../sheetGeometry';
import { wingDimensionLayout, type WingDimensionLayout } from './wingDimensionLayout';

/** Arrowheads and label retain a comfortable pixel size, while every point
 * and the text plane remain attached to the wing through orbit and zoom. */
export function PlanarAnnotation({ layout, name, onChange, onEditing, max, flat = false }: {
  layout: WingDimensionLayout; name: string; onChange?: (value: number) => void;
  onEditing?: (editing: boolean) => void; max?: number; flat?: boolean;
}) {
  const label = useRef<Group>(null), first = useRef<Group>(null), last = useRef<Group>(null);
  const { viewport, size } = useThree();
  const [editing, setEditing] = useState(false);
  const middle = useMemo(() => layout.start.clone().lerp(layout.end, .5), [layout]);
  const direction = useMemo(() => layout.end.clone().sub(layout.start).normalize(), [layout]);
  const scratch = useMemo(() => ({ world: new Vector3(), a: new Vector3(), b: new Vector3(), x: new Vector3(), y: new Vector3(), z: new Vector3(), worldNormal: new Vector3(), eye: new Vector3(), matrix: new Matrix4() }), []);
  const arrowBasis = useMemo(() => new Matrix4().makeBasis(direction, layout.outward, direction.clone().cross(layout.outward)), [direction, layout]);
  const arrowQuaternion = useMemo(() => new Quaternion().setFromRotationMatrix(arrowBasis), [arrowBasis]);
  useFrame(({ camera }) => {
    const group = label.current;
    if (!group?.parent) return;
    const parent = group.parent;
    parent.updateWorldMatrix(true, false);
    scratch.world.copy(middle).applyMatrix4(parent.matrixWorld);
    const units = viewport.getCurrentViewport(camera, scratch.world).width / Math.max(1, size.width);
    scratch.x.copy(direction); scratch.y.copy(layout.outward); scratch.z.crossVectors(scratch.x, scratch.y);
    scratch.eye.copy(camera.position).sub(scratch.world).normalize();
    const faceCosine = Math.abs(scratch.worldNormal.copy(layout.normal).transformDirection(parent.matrixWorld).dot(scratch.eye));
    // Cotations are annotations, not physical lettering: gently compensate
    // foreshortening without turning the text into a screen-facing billboard.
    const heightCorrection = 1 / Math.max(.4, faceCosine);
    group.position.copy(middle).addScaledVector(layout.outward, units * 18 * heightCorrection);
    group.scale.set(units, units * heightCorrection, units);
    if (scratch.worldNormal.copy(scratch.z).transformDirection(parent.matrixWorld).dot(scratch.eye) < 0) scratch.y.negate();
    scratch.a.copy(layout.start).applyMatrix4(parent.matrixWorld).project(camera);
    scratch.b.copy(layout.end).applyMatrix4(parent.matrixWorld).project(camera);
    if (scratch.b.x < scratch.a.x) { scratch.x.negate(); scratch.y.negate(); }
    scratch.z.crossVectors(scratch.x, scratch.y);
    group.quaternion.setFromRotationMatrix(scratch.matrix.makeBasis(scratch.x, scratch.y, scratch.z));
    for (const head of [first.current, last.current]) if (head) head.scale.setScalar(Math.min(units, layout.start.distanceTo(layout.end) / 28));
  });
  const begin = () => { setEditing(true); onEditing?.(true); };
  return <group>
    <Line points={[layout.baseStart, layout.start.clone().addScaledVector(layout.outward, 4)]} color="#5b616b" lineWidth={1} depthTest={false} />
    <Line points={[layout.baseEnd, layout.end.clone().addScaledVector(layout.outward, 4)]} color="#5b616b" lineWidth={1} depthTest={false} />
    <Line points={[layout.start, layout.end]} color="#323843" lineWidth={1.2} depthTest={false} />
    <group ref={first} position={layout.start} quaternion={arrowQuaternion}>
      <Line points={[[7, -3, 0], [0, 0, 0], [7, 3, 0]]} color="#323843" lineWidth={1.5} depthTest={false} />
    </group>
    <group ref={last} position={layout.end} quaternion={arrowQuaternion}>
      <Line points={[[-7, -3, 0], [0, 0, 0], [-7, 3, 0]]} color="#323843" lineWidth={1.5} depthTest={false} />
    </group>
    <group ref={label} position={middle}>
      <Html transform={!flat} distanceFactor={flat ? undefined : 400} center zIndexRange={[12, 0]} style={{ pointerEvents: onChange ? 'auto' : 'none' }}>
        {editing && onChange ? <input autoFocus type="number" aria-label={name} defaultValue={layout.value} min={1} max={max} step={.1}
          className="planar-dimension-input" onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          onBlur={event => { const value = Number(event.currentTarget.value); if (Number.isFinite(value) && value > 0) onChange(value); setEditing(false); onEditing?.(false); }} />
          : onChange ? <button type="button" className="planar-dimension-value" aria-label={`${name} : ${layout.value} millimètres. Modifier`}
            onPointerDown={event => event.stopPropagation()} onClick={begin}>{layout.value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mm</button>
          : <span className="planar-dimension-value" style={{ display: 'inline-block', transform: flat && Math.abs(direction.y) > .5 ? 'rotate(-90deg)' : undefined }}>{layout.value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mm</span>}
      </Html>
    </group>
  </group>;
}

export default function PlanarWingDimension({ leg, state, kind, onChange, onEditing }: {
  leg: LegTransform; state: SheetMetalState; kind: 'length' | 'width';
  onChange?: (value: number) => void; onEditing?: (editing: boolean) => void;
}) {
  const layout = useMemo(() => wingDimensionLayout(leg, state, kind), [leg, state, kind]);
  return <PlanarAnnotation layout={layout} name={kind === 'length' ? `Longueur ${leg.label}` : 'Largeur de la pièce'}
    onChange={onChange} onEditing={onEditing} max={kind === 'length' ? getMaxLegLength(state, leg.index) : undefined} />;
}
