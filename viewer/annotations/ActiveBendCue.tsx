import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { getBendArcSegments } from '../../sheetGeometry';
import { type LegTransform, type SheetMetalState } from '../../sheetGeometry';

const ARC_RADIUS_PX = 64;
const HIGHLIGHT_CLEARANCE_MM = 0.18;

interface ActiveBendCueProps {
  dimensions: SheetMetalState;
  legTransforms: LegTransform[];
  bendIndex: number;
}

/** La garde reste hors du composant à hooks : retirer un pli ne change pas
 * l'ordre des hooks et démonte proprement ses ressources géométriques. */
export function ActiveBendCue({
  dimensions,
  legTransforms,
  bendIndex,
}: ActiveBendCueProps) {
  const firstWing = legTransforms[bendIndex];
  if (!firstWing || !legTransforms[bendIndex + 1]) return null;

  return <BendAnnotation dimensions={dimensions} firstWing={firstWing} bendIndex={bendIndex} />;
}

function BendAnnotation({ dimensions, firstWing, bendIndex }: {
  dimensions: SheetMetalState;
  firstWing: LegTransform;
  bendIndex: number;
}) {
  const annotation = useRef<THREE.Group>(null);
  const { viewport, size } = useThree();
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    if (!annotation.current) return;
    // Convert a screen-space radius to model units at the actual bend depth.
    // Updating only the scene transform avoids React renders during zooming.
    annotation.current.getWorldPosition(worldPosition);
    const unitsPerPixel = viewport.getCurrentViewport(camera, worldPosition).width / Math.max(1, size.width);
    annotation.current.scale.setScalar(unitsPerPixel * ARC_RADIUS_PX);
  });

  const bend = dimensions.bends[bendIndex];
  const angle = Math.max(15, Math.min(165, Math.abs(bend?.angle ?? 90))) * Math.PI / 180;
  const direction = (bend?.angle ?? 90) < 0 ? -1 : (bend?.direction === -1 ? -1 : 1);
  const radiusMid = Math.max(1, dimensions.thickness) * 1.5;
  const center = {
    x: firstWing.bendStart.x + direction * radiusMid * firstWing.normal.x,
    y: firstWing.bendStart.y + direction * radiusMid * firstWing.normal.y,
  };
  const startAngle = Math.atan2(
    firstWing.bendStart.y - center.y,
    firstWing.bendStart.x - center.x,
  );
  // Écarter légèrement le surlignage du métal évite le scintillement de profondeur.
  const outerRadius = radiusMid + dimensions.thickness / 2 + HIGHLIGHT_CLEARANCE_MM;
  const innerRadius = Math.max(0.1, radiusMid - dimensions.thickness / 2 - HIGHLIGHT_CLEARANCE_MM);
  const highlightGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    const steps = getBendArcSegments(angle);
    for (let step = 0; step <= steps; step++) {
      const theta = startAngle + direction * angle * step / steps;
      const point = new THREE.Vector2(center.x + outerRadius * Math.cos(theta), center.y + outerRadius * Math.sin(theta));
      if (step === 0) shape.moveTo(point.x, point.y);
      else shape.lineTo(point.x, point.y);
    }
    for (let step = steps; step >= 0; step--) {
      const theta = startAngle + direction * angle * step / steps;
      shape.lineTo(center.x + innerRadius * Math.cos(theta), center.y + innerRadius * Math.sin(theta));
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: dimensions.width, bevelEnabled: false, curveSegments: steps });
  }, [angle, center.x, center.y, direction, dimensions.width, innerRadius, outerRadius, startAngle]);
  useEffect(() => () => highlightGeometry.dispose(), [highlightGeometry]);

  // The concave sector lies between the outgoing wing and the reverse of
  // the incoming wing. Its opening is supplementary to the configured bend
  // rotation; the label still reports that configured rotation, not its supplement.
  const insideStart = startAngle + direction * (Math.PI / 2 + angle);
  const insideSweep = direction * (Math.PI - angle);
  const arcPoints = useMemo(() => Array.from({ length: 65 }, (_, index) => {
    const theta = insideStart + insideSweep * index / 64;
    return new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0);
  }), [insideStart, insideSweep]);
  const middle = insideStart + insideSweep / 2;

  return (
    <>
      <mesh geometry={highlightGeometry} renderOrder={20}>
        <meshBasicMaterial color="#e83c69" transparent opacity={0.3} depthWrite={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <group ref={annotation} position={[center.x, center.y, dimensions.width / 2]}>
        <Line points={arcPoints} color="#e83c69" lineWidth={3} depthTest={false} renderOrder={30} />
        {[arcPoints[0], arcPoints[64]].map((point, index) => <Line key={index} points={[[0, 0, 0], [point.x * 1.12, point.y * 1.12, 0]]}
          color="#e83c69" lineWidth={1.5} dashed dashSize={.08} gapSize={.06} depthTest={false} renderOrder={30} />)}
        <Html center position={[Math.cos(middle) * 1.35, Math.sin(middle) * 1.35, 0]} zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
          <div className="bend-angle-value" aria-label={`Pli ${bend?.id ?? bendIndex + 1} : ${Math.round(angle * 180 / Math.PI)} degrés`}>{Math.round(angle * 180 / Math.PI)}°</div>
        </Html>
      </group>
    </>
  );
}
