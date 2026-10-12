import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import { getNearestEdgeDistances, getMaxLegLength, getInnerLegLength, type LegTransform, type LegConfig, type SheetMetalState } from '../../sheetGeometry';

import { getLegFaceEndpoints } from './Dimensions';

function SelectedLegFace({ legT, dimensions, side }: { legT: LegTransform; dimensions: SheetMetalState; side: -1 | 1 }) {
  // The sheet is extruded from z=0 to z=width, then centered by the parent
  // group. Place each highlight outside its actual metal face to avoid
  // depth fighting and let the camera reveal the underside when orbiting.
  const { tip, bend } = getLegFaceEndpoints(legT, dimensions, side);
  const offset = side * (dimensions.thickness / 2 + 0.35);
  const nx = legT.normal.x * offset;
  const ny = legT.normal.y * offset;
  const p0 = new THREE.Vector3(tip.x + nx, tip.y + ny, 0);
  const p1 = new THREE.Vector3(bend.x + nx, bend.y + ny, 0);
  const p2 = new THREE.Vector3(bend.x + nx, bend.y + ny, dimensions.width);
  const p3 = new THREE.Vector3(tip.x + nx, tip.y + ny, dimensions.width);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z,
      p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z,
    ], 3));
    g.computeVertexNormals();
    return g;
  }, [legT.id, p0.x, p0.y, p1.x, p1.y, p2.z, side]);
  const outline = useMemo(() => {
    const points = [p0, p1, p2, p3];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({
      color: '#e83c69',
      transparent: true,
      opacity: 0.98,
      depthTest: true,
      toneMapped: false,
    }));
    line.renderOrder = 31;
    return line;
  }, [legT.id, p0.x, p0.y, p1.x, p1.y, p2.z, side]);
  useEffect(() => () => {
    outline.geometry.dispose();
    (outline.material as THREE.Material).dispose();
  }, [outline]);
  return (
    <>
      <mesh geometry={geometry} renderOrder={30}>
        <meshBasicMaterial color="#e83c69" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <primitive object={outline} />
    </>
  );
}

export function SelectedLegSurface({ legT, dimensions }: { legT: LegTransform; dimensions: SheetMetalState }) {
  return (
    <>
      <SelectedLegFace legT={legT} dimensions={dimensions} side={1} />
      <SelectedLegFace legT={legT} dimensions={dimensions} side={-1} />
    </>
  );
}

export function PlacementDistancePreview({
  legT,
  dist,
  offset,
  dimensions,
  valid,
}: {
  legT: LegTransform;
  dist: number;
  offset: number;
  dimensions: SheetMetalState;
  valid: boolean;
}) {
  const x = legT.tip.x + legT.direction.x * dist + legT.normal.x * 0.9;
  const y = legT.tip.y + legT.direction.y * dist + legT.normal.y * 0.9;
  const leg = dimensions.legs.find(item => item.id === legT.id);
  const edgeData = getNearestEdgeDistances(
    { ...(leg || { id: legT.id, label: legT.label, length: legT.length, hasHole: true, holeDiam: 5, holeDist: dist, holeOffset: offset }), holeDist: dist, holeOffset: offset },
    legT.length,
    dimensions.width,
    dimensions.thickness,
    dimensions.bendCount > 0,
  );
  const centerPt = new THREE.Vector3(x, y, offset);
  const nearestLengthEdge = edgeData.nearestX.edgeKey === 'free'
    ? new THREE.Vector3(legT.tip.x + legT.normal.x * 0.9, legT.tip.y + legT.normal.y * 0.9, offset)
    : new THREE.Vector3(legT.bendStart.x + legT.normal.x * 0.9, legT.bendStart.y + legT.normal.y * 0.9, offset);
  const nearestWidthEdge = new THREE.Vector3(x, y, edgeData.nearestZ.edgeKey === 'left' ? 0 : dimensions.width);
  const lengthEndLocal = nearestLengthEdge.clone().sub(centerPt);
  const widthEndLocal = nearestWidthEdge.clone().sub(centerPt);
  const lengthLine = useMemo(() => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), lengthEndLocal]),
    new THREE.LineBasicMaterial({ color: '#e83c69', depthTest: false }),
  ), [x, y, offset, lengthEndLocal.x, lengthEndLocal.y, lengthEndLocal.z]);
  const widthLine = useMemo(() => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), widthEndLocal]),
    new THREE.LineBasicMaterial({ color: '#ffb400', depthTest: false }),
  ), [x, y, offset, widthEndLocal.x, widthEndLocal.y, widthEndLocal.z]);
  useEffect(() => () => {
    lengthLine.geometry.dispose();
    widthLine.geometry.dispose();
    (lengthLine.material as THREE.Material).dispose();
    (widthLine.material as THREE.Material).dispose();
  }, [lengthLine, widthLine]);
  return (
    <group position={[x, y, offset]} renderOrder={30}>
      <primitive object={lengthLine} />
      <primitive object={widthLine} />
      <mesh>
        <sphereGeometry args={[2, 16, 16]} />
        <meshBasicMaterial color={valid ? '#ec4899' : '#ef4444'} depthTest={false} />
      </mesh>
      <Html center distanceFactor={160}>
        <div className={`rounded-md border px-2 py-1.5 text-[10px] font-mono whitespace-nowrap shadow-xl pointer-events-none ${valid ? 'border-pink-500 bg-slate-950/95 text-white' : 'border-red-500 bg-red-950/95 text-red-100'}`}>
          <div>{edgeData.nearestX.name} <strong className="text-pink-300">{edgeData.nearestX.distEdge.toFixed(1)} mm</strong></div>
          <div className="mt-0.5">{edgeData.nearestZ.name} <strong className="text-amber-300">{edgeData.nearestZ.distEdge.toFixed(1)} mm</strong></div>
        </div>
      </Html>
    </group>
  );
}
