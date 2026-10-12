import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import { getNearestEdgeDistances, getMaxLegLength, getInnerLegLength, type LegTransform, type LegConfig, type SheetMetalState } from '../../sheetGeometry';
import { annotationOpenings, wingLabelPoint, holeLabelPoint } from './labelLayout';
import type { HolePosition } from '../../sheetGeometry';

// Badges follow the sheet normal and depth occlusion, not screen overlays.
export const HOLE_NUMBER_BADGE_COLOR = '#99294b';


/** Pastille de repérage, dessinée en 3D pour suivre naturellement le zoom caméra. */
export function WingBadge({ letter, fontSize, depthTest = true }: { letter: string; fontSize: number; depthTest?: boolean }) {
  const badgeRadius = fontSize * 0.78;
  const textSize = fontSize * 1.18;
  const outlineWidth = Math.max(0.08, fontSize * 0.012);

  return (
    <group>
      <mesh position={[0, 0, 0.02]} raycast={() => null} renderOrder={99}>
        <circleGeometry args={[badgeRadius, 48]} />
        <meshBasicMaterial color="#e83c69" side={THREE.FrontSide} depthTest={depthTest} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-4} toneMapped={false} />
      </mesh>
      {/* Keep the normal depth test so the sheet can hide labels on occluded wings. */}
      <Text
        position={[0, 0, 0.06]}
        fontSize={textSize}
        color="#fff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={outlineWidth}
        outlineColor="#17202b"
        renderOrder={101}
        raycast={() => null}
        material-depthTest={depthTest}
        material-depthWrite={false}
      >
        {letter}
      </Text>
    </group>
  );
}


/** Repère de trou affiché uniquement sur la face tournée vers la caméra. */
export function HoleNumberLabel({ legT, dist, offset, number, openingSize, thickness, holeDefinition, holes, width }: {
  legT: LegTransform;
  dist: number;
  offset: number;
  number: number;
  openingSize: number;
  thickness: number;
  holeDefinition: LegConfig;
  holes: HolePosition[];
  width: number;
}) {
  // Small marker beside the opening, even for very large cutouts.
  const badgeRadius = Math.max(0.7, Math.min(4.2, openingSize * 0.31));
  const fontSize = Math.max(0.8, Math.min(4.5, openingSize * 0.29));
  const openings = annotationOpenings(holeDefinition, holes);
  const own = annotationOpenings(holeDefinition, [{ dist, offset }])[0];
  const point = holeLabelPoint(own, badgeRadius, openings, legT.length, width);
  const labelZ = point.y;
  const x = legT.tip.x + legT.direction.x * point.x;
  const y = legT.tip.y + legT.direction.y * point.x;
  const normalOffset = Math.max(0.8, thickness * 0.5 + 0.3);
  const camera = useThree((state) => state.camera);
  const cameraPosition = useMemo(() => new THREE.Vector3(), []);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const worldNormal = useMemo(() => new THREE.Vector3(), []);
  const frontRef = useRef<THREE.Group>(null);
  const backRef = useRef<THREE.Group>(null);
  const frontRotation = useMemo(() => new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(legT.normal.x, legT.normal.y, 0).normalize(),
  ), [legT.normal.x, legT.normal.y]);
  const backRotation = useMemo(() => frontRotation.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
  ), [frontRotation]);

  useFrame(() => {
    camera.getWorldPosition(cameraPosition);
    if (!frontRef.current) return;
    frontRef.current.getWorldPosition(worldPosition);
    worldNormal.set(0, 0, 1).transformDirection(frontRef.current.matrixWorld);
    const frontDot = cameraPosition.sub(worldPosition).normalize().dot(worldNormal);
    const frontVisible = frontDot > .08;
    if (frontRef.current) frontRef.current.visible = frontVisible;
    if (backRef.current) backRef.current.visible = frontDot < -.08;
  });

  const badge = <>
    <mesh position={[0, 0, 0.02]} raycast={() => null} renderOrder={99}>
      <circleGeometry args={[badgeRadius, 32]} />
      <meshBasicMaterial color={HOLE_NUMBER_BADGE_COLOR} side={THREE.FrontSide} depthTest depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-4} toneMapped={false} />
    </mesh>
    <Text position={[0, 0, 0.06]} fontSize={fontSize} color="#fff" anchorX="center" anchorY="middle"
      outlineWidth={Math.max(0.04, fontSize * 0.012)} outlineColor="#17202b" renderOrder={101}
      raycast={() => null} material-depthTest material-depthWrite={false}>
      {String(number)}
    </Text>
  </>;

  return <>
    <group ref={frontRef} visible={false} position={[x + legT.normal.x * normalOffset, y + legT.normal.y * normalOffset, labelZ]} quaternion={frontRotation}>{badge}</group>
    <group ref={backRef} visible={false} position={[x - legT.normal.x * normalOffset, y - legT.normal.y * normalOffset, labelZ]} quaternion={backRotation}>{badge}</group>
  </>;
}


/** Lettre de repérage de l'aile, posée sur sa face dans le rendu 3D. */
export function WingLabel({ legT, width, thickness, leg, holes }: { legT: LegTransform; width: number; thickness: number; leg: LegConfig; holes: HolePosition[] }) {
  const fontSize = Math.max(.5, Math.min(24, width * .1, legT.length * .24));
  const point = wingLabelPoint(legT.length, width, fontSize * .78, annotationOpenings(leg, holes));
  const camera = useThree(s => s.camera);
  const frontRef = useRef<THREE.Group>(null), backRef = useRef<THREE.Group>(null);
  const cameraPosition = useMemo(() => new THREE.Vector3(), []);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const worldNormal = useMemo(() => new THREE.Vector3(), []);
  const position = useMemo(() => {
    const center = {
      x: legT.tip.x + legT.direction.x * (point?.x ?? legT.length / 2),
      y: legT.tip.y + legT.direction.y * (point?.x ?? legT.length / 2),
    };
    // Décalage selon la normale de l'aile, et non uniquement sur Z : le
    // texte reste réellement posé sur chaque surface, quelle que soit son
    // angle de pliage.
    // The sheet has two visible faces around the profile normal. Keep one
    // label just outside each face so the marker never disappears when the
    // camera orbits behind the part.
    const normalOffset = Math.max(0.8, thickness * 0.5 + 0.25);
    return [
      center.x,
      center.y,
      point?.y ?? width / 2,
      normalOffset,
    ] as [number, number, number, number];
  }, [legT.tip, legT.direction, point?.x, point?.y, width, thickness]);

  const quaternion = useMemo(() => {
    const normal = new THREE.Vector3(legT.normal.x, legT.normal.y, 0).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }, [legT.normal.x, legT.normal.y]);

  const backQuaternion = useMemo(() => {
    return quaternion.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
    );
  }, [quaternion]);

  const [centerX, centerY, centerZ, normalOffset] = position;
  const frontPosition: [number, number, number] = [
    centerX + legT.normal.x * normalOffset,
    centerY + legT.normal.y * normalOffset,
    centerZ,
  ];
  const backPosition: [number, number, number] = [
    centerX - legT.normal.x * normalOffset,
    centerY - legT.normal.y * normalOffset,
    centerZ,
  ];
  useFrame(() => {
    camera.getWorldPosition(cameraPosition);
    if (!frontRef.current) return;
    frontRef.current.getWorldPosition(worldPosition);
    worldNormal.set(0, 0, 1).transformDirection(frontRef.current.matrixWorld);
    const facing = cameraPosition.sub(worldPosition).normalize().dot(worldNormal);
    if (frontRef.current) frontRef.current.visible = !!point && facing > .08;
    if (backRef.current) backRef.current.visible = !!point && facing < -.08;
  });

  return (
    <>
      <group ref={frontRef} visible={false} position={frontPosition} quaternion={quaternion}>
        <WingBadge letter={legT.id} fontSize={fontSize} />
      </group>
      <group ref={backRef} visible={false} position={backPosition} quaternion={backQuaternion}>
        <WingBadge letter={legT.id} fontSize={fontSize} />
      </group>
    </>
  );
}
