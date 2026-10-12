import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import { getNearestEdgeDistances, getMaxLegLength, getInnerLegLength, type LegTransform, type LegConfig, type SheetMetalState } from '../../sheetGeometry';



// Annotation resources are owned here; configuration remains in the editor.
export function FlatCornerRadiusMarker({
  legT,
  radius,
  displayRadius,
  side,
  dimensions,
}: {
  legT: LegTransform;
  radius: number;
  displayRadius: number;
  side: 'left' | 'right';
  dimensions: SheetMetalState;
}) {
  const sign = side === 'left' ? 1 : -1;
  const points = useMemo(() => {
    const result: THREE.Vector3[] = [];
    const markerSegments = 32;
    for (let i = 0; i <= markerSegments; i++) {
      const angle = -Math.PI / 2 - (Math.PI / 2) * (i / markerSegments);
      const along = displayRadius * (1 + Math.cos(angle));
      const across = sign * displayRadius * (1 + Math.sin(angle));
      result.push(new THREE.Vector3(
        legT.tip.x + legT.direction.x * along + legT.normal.x * (dimensions.thickness * 0.7),
        legT.tip.y + legT.direction.y * along + legT.normal.y * (dimensions.thickness * 0.7),
        side === 'left' ? across : dimensions.width + across,
      ));
    }
    return result;
  }, [legT.tip.x, legT.tip.y, legT.direction.x, legT.direction.y, legT.normal.x, legT.normal.y, displayRadius, sign, side, dimensions.thickness, dimensions.width]);
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xf97316, depthTest: false });
    return new THREE.Line(geometry, material);
  }, [points]);
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  const labelPoint = points[Math.floor(points.length / 2)];

  return (
    <group>
      <primitive object={line} />
      <group position={[labelPoint.x, labelPoint.y, labelPoint.z]}>
        <Html center distanceFactor={180}>
          <div className="rounded border border-orange-400/80 bg-slate-950/90 px-1.5 py-0.5 text-[9px] font-mono font-bold text-orange-300 shadow-md whitespace-nowrap pointer-events-none select-none">
            R{radius.toFixed(1)}
          </div>
        </Html>
      </group>
    </group>
  );
}


function DimensionArrows({
  start,
  end,
  color,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: number;
}) {
  const direction = end.clone().sub(start).normalize();
  const arrowStart = useRef<THREE.Mesh>(null);
  const arrowEnd = useRef<THREE.Mesh>(null);
  const { viewport, size } = useThree();
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const worldScale = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    for (const arrow of [arrowStart.current, arrowEnd.current]) {
      if (!arrow) continue;
      arrow.getWorldPosition(worldPosition);
      arrow.parent?.getWorldScale(worldScale);
      const unitsPerPixel = viewport.getCurrentViewport(camera, worldPosition).width / Math.max(1, size.width);
      // Small technical arrowheads, sized in pixels rather than millimetres.
      const scale = unitsPerPixel * 6 / arrowSize / Math.max(.0001, worldScale.x);
      arrow.scale.setScalar(scale);
    }
  });
  const reverseDirection = direction.clone().multiplyScalar(-1);
  const arrowSize = 2.8;
  const arrowRadius = 0.9;
  const startQuaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
    [direction.x, direction.y, direction.z],
  );
  const endQuaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), reverseDirection),
    [reverseDirection.x, reverseDirection.y, reverseDirection.z],
  );
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(geometry, material);
  }, [start.x, start.y, start.z, end.x, end.y, end.z, color]);
  // R3F does not dispose objects attached through <primitive> automatically.
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);

  return (
    <group>
      <primitive object={line} />
      <mesh
        ref={arrowStart}
        position={start}
        quaternion={startQuaternion}
        renderOrder={20}
      >
        <coneGeometry args={[arrowRadius, arrowSize, 4]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh
        ref={arrowEnd}
        position={end}
        quaternion={endQuaternion}
        renderOrder={20}
      >
        <coneGeometry args={[arrowRadius, arrowSize, 4]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}


function DimensionWitnessLine({
  start,
  end,
  color,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: number;
}) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 });
    return new THREE.Line(geometry, material);
  }, [start.x, start.y, start.z, end.x, end.y, end.z, color]);
  // R3F does not dispose objects attached through <primitive> automatically.
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  return <primitive object={line} />;
}


/** Keeps a dimension label parallel to its measured edge in the current camera view. */
function AlignedDimensionLabel({
  position,
  start,
  end,
  children,
}: {
  position: THREE.Vector3;
  start: THREE.Vector3;
  end: THREE.Vector3;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const projectedPoints = useMemo(() => [new THREE.Vector3(), new THREE.Vector3()], []);
  const lastAngle = useRef<number | null>(null);

  useFrame(() => {
    const group = groupRef.current;
    const label = labelRef.current;
    if (!group || !label) return;
    group.updateWorldMatrix(true, false);
    const projectedStart = group.localToWorld(projectedPoints[0].copy(start).sub(position)).project(camera);
    const projectedEnd = group.localToWorld(projectedPoints[1].copy(end).sub(position)).project(camera);
    // NDC is not square on a wide viewport: use pixel deltas for alignment.
    const dx = (projectedEnd.x - projectedStart.x) * size.width;
    const dy = (projectedStart.y - projectedEnd.y) * size.height;
    if (Math.hypot(dx, dy) < 1e-5) return;

    let angle = THREE.MathUtils.radToDeg(Math.atan2(dy, dx));
    // Keep the text upright while preserving alignment with the dimension line.
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    if (lastAngle.current === null || Math.abs(lastAngle.current - angle) > 0.1) {
      label.style.transform = `rotate(${angle}deg)`;
      lastAngle.current = angle;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <Html center>
        <div ref={labelRef} className="technical-dimension-label">
          {children}
        </div>
      </Html>
    </group>
  );
}


function getExteriorLegEndpoints(legT: LegTransform, dimensions: SheetMetalState) {
  const outerRadius = dimensions.thickness * 2;
  const setback = (bendIndex: number) => {
    const angle = Math.max(15, Math.min(165, Math.abs(dimensions.bends[bendIndex]?.angle ?? 90)));
    return outerRadius * Math.tan((angle * Math.PI) / 360);
  };
  const previousSetback = legT.index > 0 ? setback(legT.index - 1) : 0;
  const nextSetback = legT.index < dimensions.bendCount ? setback(legT.index) : 0;
  const isTerminalWing = legT.index === dimensions.bendCount;
  return {
    tip: {
      x: legT.tip.x - legT.direction.x * (isTerminalWing ? 0 : previousSetback),
      y: legT.tip.y - legT.direction.y * (isTerminalWing ? 0 : previousSetback),
    },
    bend: {
      x: legT.bendStart.x + legT.direction.x * (isTerminalWing ? previousSetback : nextSetback),
      y: legT.bendStart.y + legT.direction.y * (isTerminalWing ? previousSetback : nextSetback),
    },
  };
}


export function getLegFaceEndpoints(legT: LegTransform, dimensions: SheetMetalState, faceSide: -1 | 1) {
  const bendSetback = (bendIndex: number) => {
    if (bendIndex < 0 || bendIndex >= dimensions.bendCount) return 0;
    const bend = dimensions.bends[bendIndex];
    const angle = Math.max(15, Math.min(165, Math.abs(bend?.angle ?? 90)));
    const direction = (bend?.angle ?? 90) < 0 ? -1 : (bend?.direction === -1 ? -1 : 1);
    // The face toward the bend centre follows the inner radius (e); the
    // opposite face follows the outer radius (2e), so their highlighted
    // exterior lengths need different tangent setbacks.
    const isOuterFace = faceSide === -direction;
    const radius = dimensions.thickness * (isOuterFace ? 2 : 1);
    return radius * Math.tan((angle * Math.PI) / 360);
  };
  const previousSetback = legT.index > 0 ? bendSetback(legT.index - 1) : 0;
  const nextSetback = legT.index < dimensions.bendCount ? bendSetback(legT.index) : 0;
  const isTerminalWing = legT.index === dimensions.bendCount;
  return {
    tip: {
      x: legT.tip.x - legT.direction.x * (isTerminalWing ? 0 : previousSetback),
      y: legT.tip.y - legT.direction.y * (isTerminalWing ? 0 : previousSetback),
    },
    bend: {
      x: legT.bendStart.x + legT.direction.x * (isTerminalWing ? previousSetback : nextSetback),
      y: legT.bendStart.y + legT.direction.y * (isTerminalWing ? previousSetback : nextSetback),
    },
  };
}


export function SegmentDimension({
  legT,
  dimensions,
  profileBounds,
  profilePathPoints,
  onLegLengthChange,
  onLegLengthEdit,
  showInnerDimension = false,
}: {
  legT: LegTransform;
  dimensions: SheetMetalState;
  profileBounds: { minX: number; maxX: number; minY: number; maxY: number };
  profilePathPoints: { x: number; y: number }[];
  onLegLengthChange?: (index: number, value: number) => void;
  onLegLengthEdit?: (index: number, editing: boolean) => void;
  showInnerDimension?: boolean;
}) {
  const measuredLength = Math.max(0, legT.length);
  const maxLength = getMaxLegLength(dimensions, legT.index);
  // La cote saisie est extérieure : elle inclut donc la zone de rayon du pli.
  const { tip: measuredTip, bend: measuredBendStart } = getExteriorLegEndpoints(legT, dimensions);
  const profileCenter = {
    x: (profileBounds.minX + profileBounds.maxX) / 2,
    y: (profileBounds.minY + profileBounds.maxY) / 2,
  };
  const midProfile = {
    // Use the same corrected endpoints as the witness lines. The previous
    // midpoint mixed the corrected free end with the raw bend start, which
    // shifted the outward side selection and made wing A's dimension drift.
    x: (measuredTip.x + measuredBendStart.x) / 2,
    y: (measuredTip.y + measuredBendStart.y) / 2,
  };
  const isInsideProfile = (x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = profilePathPoints.length - 1; i < profilePathPoints.length; j = i++) {
      const current = profilePathPoints[i];
      const previous = profilePathPoints[j];
      const crossesY = (current.y > y) !== (previous.y > y);
      if (crossesY && x < ((previous.x - current.x) * (y - current.y)) / (previous.y - current.y) + current.x) {
        inside = !inside;
      }
    }
    return inside;
  };
  const probeDistance = Math.max(2, dimensions.thickness);
  const plusProbe = new THREE.Vector2(
    midProfile.x + legT.normal.x * probeDistance,
    midProfile.y + legT.normal.y * probeDistance,
  );
  const minusProbe = new THREE.Vector2(
    midProfile.x - legT.normal.x * probeDistance,
    midProfile.y - legT.normal.y * probeDistance,
  );
  const plusIsInside = isInsideProfile(plusProbe.x, plusProbe.y);
  const minusIsInside = isInsideProfile(minusProbe.x, minusProbe.y);
  const pointsTowardPiece = (profileCenter.x - midProfile.x) * legT.normal.x
    + (profileCenter.y - midProfile.y) * legT.normal.y;
  // Le centre de gravité des bounds peut tomber du mauvais côté d'une aile
  // intermédiaire (B dans un U/Z). On teste donc la vraie silhouette à proximité.
  const outwardNormal = plusIsInside !== minusIsInside
    ? (plusIsInside ? { x: -legT.normal.x, y: -legT.normal.y } : legT.normal)
    : pointsTowardPiece >= 0
      ? { x: -legT.normal.x, y: -legT.normal.y }
      : legT.normal;
  const edgeOffset = Math.max(1, dimensions.thickness * 0.5);
  const isIntermediateWing = legT.index > 0 && legT.index < dimensions.bendCount;
  // Intermediate wings (notably B in a U/Z profile) sit between two bends;
  // give their dimension line more breathing room from adjacent geometry.
  const dimensionOffset = edgeOffset + Math.max(
    isIntermediateWing ? 28 : 18,
    dimensions.thickness * (isIntermediateWing ? 7 : 5),
  );
  // Keep cotations just outside the near sheet face. Anchoring exactly on
  // z=width/2 made depth occlusion flicker as the camera moved.
  const dimensionFaceOffset = Math.max(0.8, dimensions.thickness * 0.25);
  const baseStart = new THREE.Vector3(
    measuredTip.x + outwardNormal.x * edgeOffset,
    measuredTip.y + outwardNormal.y * edgeOffset,
    dimensions.width * 0.5 + dimensionFaceOffset,
  );
  const baseEnd = new THREE.Vector3(
    measuredBendStart.x + outwardNormal.x * edgeOffset,
    measuredBendStart.y + outwardNormal.y * edgeOffset,
    dimensions.width * 0.5 + dimensionFaceOffset,
  );
  const start = new THREE.Vector3(
    measuredTip.x + outwardNormal.x * dimensionOffset,
    measuredTip.y + outwardNormal.y * dimensionOffset,
    dimensions.width * 0.5 + dimensionFaceOffset,
  );
  const end = new THREE.Vector3(
    measuredBendStart.x + outwardNormal.x * dimensionOffset,
    measuredBendStart.y + outwardNormal.y * dimensionOffset,
    dimensions.width * 0.5 + dimensionFaceOffset,
  );
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  return (
    <group>
      <DimensionWitnessLine start={baseStart} end={start} color={0x737373} />
      <DimensionWitnessLine start={baseEnd} end={end} color={0x737373} />
      <DimensionArrows start={start} end={end} color={0x262626} />
      <AlignedDimensionLabel position={midpoint} start={start} end={end}>
        <span>{legT.label}</span>
        {showInnerDimension && <span className="text-[9px] font-normal text-neutral-600">Ext.</span>}
        {onLegLengthChange ? (
          <input
            key={`dimension-${legT.id}-${measuredLength.toFixed(1)}`}
            aria-label={`Longueur ${legT.label}`}
            type="number"
            min="1"
            max={maxLength}
            step="0.1"
            defaultValue={measuredLength.toFixed(1)}
            className="w-16 border-0 border-b border-neutral-500 bg-transparent px-0.5 text-right text-sm font-mono font-semibold outline-none focus:border-[#e83c69]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onFocus={() => onLegLengthEdit?.(legT.index, true)}
            onBlur={(event) => {
              const rawValue = parseFloat(event.currentTarget.value);
              onLegLengthChange(legT.index, rawValue);
              onLegLengthEdit?.(legT.index, false);
              if (Number.isFinite(rawValue)) {
                event.currentTarget.value = Math.min(rawValue, maxLength).toFixed(1);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        ) : (
          <span>{measuredLength.toFixed(1)}</span>
        )}
        <span>mm</span>
        {showInnerDimension && (
          <span className="ml-1 border-l border-neutral-300 pl-1 text-[9px] font-normal text-neutral-700">
            Int. {getInnerLegLength(dimensions, legT.index).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mm
          </span>
        )}
      </AlignedDimensionLabel>
    </group>
  );
}


export function WidthDimension({
  legT,
  dimensions,
  profileBounds,
  onWidthChange,
}: {
  legT: LegTransform;
  dimensions: SheetMetalState;
  profileBounds: { minX: number; maxX: number; minY: number; maxY: number };
  onWidthChange?: (value: number) => void;
}) {
  const profileCenter = {
    x: (profileBounds.minX + profileBounds.maxX) / 2,
    y: (profileBounds.minY + profileBounds.maxY) / 2,
  };
  const pointsTowardPiece = (profileCenter.x - legT.center.x) * legT.normal.x
    + (profileCenter.y - legT.center.y) * legT.normal.y;
  const outwardNormal = pointsTowardPiece >= 0
    ? { x: -legT.normal.x, y: -legT.normal.y }
    : legT.normal;
  const edgeOffset = Math.max(1, dimensions.thickness * 0.5);
  const dimensionFaceOffset = Math.max(0.8, dimensions.thickness * 0.25);
  // Keep the width label farther from the profile than the A/B segment labels
  // so the two HTML badges never occupy the same projected area.
  const dimensionOffset = edgeOffset + Math.max(48, dimensions.thickness * 10);
  const baseCenter = new THREE.Vector3(
    legT.center.x + outwardNormal.x * edgeOffset,
    legT.center.y + outwardNormal.y * edgeOffset,
    dimensions.width * 0.5 + dimensionFaceOffset,
  );
  const center = new THREE.Vector3(
    legT.center.x + outwardNormal.x * dimensionOffset,
    legT.center.y + outwardNormal.y * dimensionOffset,
    dimensions.width * 0.5 + dimensionFaceOffset,
  );
  const baseStart = baseCenter.clone();
  baseStart.z = -dimensionFaceOffset;
  const baseEnd = baseCenter.clone();
  baseEnd.z = dimensions.width + dimensionFaceOffset;
  const start = center.clone();
  start.z = -dimensionFaceOffset;
  const end = center.clone();
  end.z = dimensions.width + dimensionFaceOffset;
  return (
    <group>
      <DimensionWitnessLine start={baseStart} end={start} color={0x737373} />
      <DimensionWitnessLine start={baseEnd} end={end} color={0x737373} />
      <DimensionArrows start={start} end={end} color={0x262626} />
      <AlignedDimensionLabel position={center} start={start} end={end}>
        <span>Largeur</span>
        {onWidthChange ? (
          <input
            key={`width-${dimensions.width}`}
            aria-label="Largeur de la pièce"
            type="number"
            min="10"
            step="0.1"
            defaultValue={dimensions.width}
            className="w-16 border-0 border-b border-neutral-500 bg-transparent px-0.5 text-right text-sm font-mono font-semibold outline-none focus:border-[#e83c69]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => onWidthChange(parseFloat(event.currentTarget.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        ) : (
          <span>{dimensions.width}</span>
        )}
        <span>mm</span>
      </AlignedDimensionLabel>
    </group>
  );
}


export function HoleNearestEdgeDimensions({
  holeLeg,
  legT,
  dimensions,
}: {
  holeLeg: LegConfig;
  legT: LegTransform;
  dimensions: SheetMetalState;
}) {
  const hx = legT.tip.x + (legT.direction.x * holeLeg.holeDist);
  const hy = legT.tip.y + (legT.direction.y * holeLeg.holeDist);
  const hz = holeLeg.holeOffset;

  // Calcul des distances et des arêtes les plus proches
  const edgeDistances = getNearestEdgeDistances(
    holeLeg, 
    legT.length || 100, 
    dimensions.width, 
    dimensions.thickness,
    dimensions.bendCount > 0
  );

  // Décalage léger selon la normale pour éviter tout z-fighting
  const faceOffset = Math.max(1.5, dimensions.thickness);
  const normX = legT.normal.x * faceOffset;
  const normY = legT.normal.y * faceOffset;

  const centerPt = new THREE.Vector3(hx + normX, hy + normY, hz);

  // 1. Point d'arête longitudinale la plus proche (Bord libre ou Ligne de pli)
  const isFreeNearest = edgeDistances.nearestX.edgeKey === 'free';
  const edgePtX = isFreeNearest
    ? new THREE.Vector3(legT.tip.x + normX, legT.tip.y + normY, hz)
    : new THREE.Vector3(legT.bendStart.x + normX, legT.bendStart.y + normY, hz);

  // 2. Point d'arête latérale la plus proche (Bord gauche Z=0 ou Bord droit Z=width)
  const isLeftNearest = edgeDistances.nearestZ.edgeKey === 'left';
  const edgePtZ = isLeftNearest
    ? new THREE.Vector3(hx + normX, hy + normY, 0)
    : new THREE.Vector3(hx + normX, hy + normY, dimensions.width);

  const midX = centerPt.clone().add(edgePtX).multiplyScalar(0.5);
  const midZ = centerPt.clone().add(edgePtZ).multiplyScalar(0.5);

  const lineXMesh = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([centerPt, edgePtX]);
    const mat = new THREE.LineBasicMaterial({ color: 0x525252 });
    return new THREE.Line(geom, mat);
  }, [centerPt.x, centerPt.y, centerPt.z, edgePtX.x, edgePtX.y, edgePtX.z]);

  const lineZMesh = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([centerPt, edgePtZ]);
    const mat = new THREE.LineBasicMaterial({ color: 0x525252 });
    return new THREE.Line(geom, mat);
  }, [centerPt.x, centerPt.y, centerPt.z, edgePtZ.x, edgePtZ.y, edgePtZ.z]);
  useEffect(() => () => {
    for (const line of [lineXMesh, lineZMesh]) { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }
  }, [lineXMesh, lineZMesh]);

  return (
    <group>
      {/* Marqueur de centre */}
      <mesh position={[centerPt.x, centerPt.y, centerPt.z]}>
        <sphereGeometry args={[1.5, 16, 16]} />
        <meshBasicMaterial color="#6366f1" />
      </mesh>

      {/* Ligne de rappel longitudinale X */}
      <primitive object={lineXMesh} />

      {/* Badge cote longitudinale X */}
      <group position={[midX.x, midX.y, midX.z]}>
        <Html center occlude>
          <div className="flex items-center gap-1 whitespace-nowrap bg-[#f5f5f4]/95 px-1.5 py-0.5 font-mono text-[10px] text-neutral-900 shadow-sm pointer-events-none select-none">
            <span className="font-semibold">{edgeDistances.nearestX.distCenter} mm</span>
            <span className="text-[8px] text-neutral-600 font-sans">{edgeDistances.nearestX.name}</span>
          </div>
        </Html>
      </group>

      {/* Ligne de rappel latérale Z */}
      <primitive object={lineZMesh} />

      {/* Badge cote latérale Z */}
      <group position={[midZ.x, midZ.y, midZ.z]}>
        <Html center occlude>
          <div className="flex items-center gap-1 whitespace-nowrap bg-[#f5f5f4]/95 px-1.5 py-0.5 font-mono text-[10px] text-neutral-900 shadow-sm pointer-events-none select-none">
            <span className="font-semibold">{edgeDistances.nearestZ.distCenter} mm</span>
            <span className="text-[8px] text-neutral-600 font-sans">{edgeDistances.nearestZ.name}</span>
          </div>
        </Html>
      </group>
    </group>
  );
}
