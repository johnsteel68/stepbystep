import { DepthPrecision } from './viewer/camera/DepthPrecision';
import ViewerTools from './components/ViewerTools';
import { isShapedBlank } from './flatBlank';
import { blankInnerContours } from './blankGeometry';
import { createFlatBlankGeometry } from './viewer/geometry/flatBlank';
import { createFormedBlankGeometry } from './viewer/geometry/formedBlank';
import { blankBendPlan, blankHoleAllowed } from './formedBlank';
import { generateSheetProfile } from './sheetGeometry';
import { orbitAngle, orbitPositionAtAngle } from './viewer/camera/rotation';
import { FlatCornerRadiusMarker, HoleNearestEdgeDimensions } from './viewer/annotations/Dimensions';
import PlanarWingDimension from './viewer/annotations/PlanarWingDimension';
import { WingBadge, WingLabel, HoleNumberLabel, HOLE_NUMBER_BADGE_COLOR } from './viewer/annotations/Badges';
import { annotationOpenings, wingLabelPoint } from './viewer/annotations/labelLayout';
import { getHoleRadii } from './sheetGeometry';
import { ActiveBendCue } from './viewer/annotations/ActiveBendCue';
import MeasureTool from './viewer/annotations/MeasureTool';
import { bendMeasurementReferences } from './viewer/annotations/bendMeasurement';
import { SelectedLegSurface, PlacementDistancePreview } from './viewer/annotations/Selection';
import ContextLossGuard from './viewer/ContextLossGuard';
import { PlacementCameraTransition, CornerRadiusCameraTransition, AutoFrameModel } from './viewer/camera/CameraControllers';
import { createVectorCutterGeometry, createOblongBufferGeometry, createRoundedRectBufferGeometry, createFlatHolePreviewGeometry, createOctagonBufferGeometry, createFlatCornerCutGeometry } from './viewer/geometry/cutters';
import { numberPreviewCutouts } from './viewer/annotations/previewCutouts';
import { useImportedPbrMaterial } from './viewer/materials/useSheetMaterial';
import { filmPeelCorner } from './viewer/materials/protectiveFilm';
import ProtectiveFilmCorner from './viewer/materials/ProtectiveFilmCorner';
import { explicitHoles, holeSeries } from './holeEditing';
import type { ViewerProps } from './viewerTypes';
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, ContactShadows, PerspectiveCamera, OrthographicCamera, Lightformer, Html, Line, Text } from '@react-three/drei';
import { Geometry, Base, Subtraction } from '@react-three/csg';
import * as THREE from 'three';
import { triggerHaptic } from './haptics';
import { AlertTriangle, Ruler } from 'lucide-react';
import { 
  SheetMetalState, 
  SheetFinish,
  MATERIAL_CONFIG, 
  getNearestEdgeDistances, 
  getHoleConstraints,
  getMaxHoleCornerRadius,
  constrainHolePosition,
  getMaxLegLength,
  getInnerLegLength,
  LegTransform, 
  LegConfig,
  HolePatternConfig,
  HoleShape,
  getFlatCornerRadii,
  getFlatCornerEnds,
  FlatCornerRadii,
  ProfileGeometryData,
  calculateUnfoldedLength,
  getPatternPositions,
  createOneSidedTreadGeometry,
  applyContinuousSideUvs,
  getBendArcSegments,
} from './sheetGeometry';

// Le visualiseur utilise le rayon saisi, sans réduction visuelle.
const VISUAL_CORNER_RADIUS_SCALE = 1;




const HoleSubtraction = React.memo(function HoleSubtraction({ holeDefinition, legT, dist, offset, thickness, material }: {
  holeDefinition: LegConfig;
  legT: LegTransform;
  dist: number;
  offset: number;
  thickness: number;
  material?: THREE.Material;
}) {
  const shape = holeDefinition.holeShape || 'round';
  const diam = Math.max(1, holeDefinition.holeDiam);
  const length = Math.max(1, holeDefinition.holeLength || 25);
  const width = Math.max(1, holeDefinition.holeWidth || 12);
  const cornerRadius = Math.min(getMaxHoleCornerRadius(holeDefinition), Math.max(0, holeDefinition.holeCornerRadius || 0));
  const geometry = useMemo(() => {
    if (holeDefinition.holeContour?.length) return createVectorCutterGeometry(holeDefinition.holeContour, thickness);
    switch (shape) {
      case 'square': return createRoundedRectBufferGeometry(diam, diam, thickness * 4, cornerRadius);
      case 'rect': return createRoundedRectBufferGeometry(length, width, thickness * 4, cornerRadius);
      case 'oblong': return createOblongBufferGeometry(length, width, thickness, holeDefinition.holeOrientation);
      case 'octagonal': return createOctagonBufferGeometry(diam, thickness);
      default: return null;
    }
  }, [shape, diam, length, width, thickness, cornerRadius, holeDefinition.holeOrientation, holeDefinition.holeContour]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  return (
    <Subtraction
      material={material}
      position={[legT.tip.x + legT.direction.x * dist, legT.tip.y + legT.direction.y * dist, offset]}
      rotation={[0, 0, legT.rotationAngle]}
      geometry={geometry || undefined}
    >
      {shape === 'round' && <cylinderGeometry args={[diam / 2, diam / 2, thickness * 4, 32]} />}
    </Subtraction>
  );
});

const FlatCornerSubtraction = React.memo(function FlatCornerSubtraction({ legT, side, radius, thickness, z, material }: {
  legT: LegTransform;
  side: 'left' | 'right';
  radius: number;
  thickness: number;
  z: number;
  material?: THREE.Material;
}) {
  const geometry = useMemo(() => createFlatCornerCutGeometry(radius, side, thickness, legT), [radius, side, thickness, legT]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <Subtraction material={material} position={[legT.tip.x, legT.tip.y, z]} geometry={geometry} />;
});



/** One continuous sheet whose shared bend vertices open into a flat strip. */
function UnfoldingSheet(props: { dimensions: SheetMetalState; restY: number; unfolding: boolean; realistic: boolean }) {
  return props.dimensions.blankShape ? <BlankUnfoldingSheet {...props} /> : <LegacyUnfoldingSheet {...props} />;
}
function BlankUnfoldingSheet({ dimensions, restY, unfolding, realistic }: {
  dimensions: SheetMetalState; restY: number; unfolding: boolean; realistic: boolean;
}) {
  const group = useRef<THREE.Group>(null), mesh = useRef<THREE.Mesh>(null), started = useRef<number | null>(null);
  const settled = useRef(false);
  const finish = dimensions.finish || 'steel-raw';
  const materials = useImportedPbrMaterial(finish, realistic);
  const geometry = useMemo(() => createFormedBlankGeometry(dimensions, materials.oneSidedRelief, unfolding ? 1 : 0), [dimensions, materials.oneSidedRelief, unfolding]);
  const profile = useMemo(() => generateSheetProfile(dimensions), [dimensions]);
  const length = blankBendPlan(dimensions).frame.length;
  React.useLayoutEffect(() => { started.current = null; settled.current = false; }, [geometry]);
  useFrame(({ clock }) => {
    if (!mesh.current || !group.current || settled.current) return;
    if (started.current === null) started.current = clock.elapsedTime;
    const t = Math.min(1, (clock.elapsedTime - started.current) / 1.5), ease = t * t * (3 - 2 * t);
    const flatness = unfolding ? ease : 1 - ease;
    settled.current = t >= 1;
    const next = createFormedBlankGeometry(dimensions, materials.oneSidedRelief, 1 - flatness);
    next.translate(THREE.MathUtils.lerp(profile.centerOffsetX, -length / 2, flatness),
      profile.centerOffsetY * (1 - flatness), -dimensions.width / 2);
    if (mesh.current.geometry !== geometry) mesh.current.geometry.dispose();
    mesh.current.geometry = next;
    group.current.rotation.x = flatness * Math.PI / 2;
    group.current.position.set(0, restY * (1 - flatness), flatness * dimensions.thickness / 2);
  });
  useEffect(() => () => { mesh.current?.geometry.dispose(); geometry.dispose(); }, [geometry]);
  return <group ref={group}><mesh ref={mesh} userData={{ measureSurface: true }} geometry={geometry} material={materials.material} frustumCulled={false} castShadow /></group>;
}
function LegacyUnfoldingSheet({ dimensions, restY, unfolding, realistic }: {
  dimensions: SheetMetalState;
  restY: number;
  unfolding: boolean;
  realistic: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const started = useRef<number | null>(null);
  const settled = useRef(false);
  const legs = dimensions.legs.slice(0, dimensions.bendCount + 1);
  const finish = dimensions.finish || (dimensions.material === 'Steel' ? 'steel-raw' : dimensions.material === 'Aluminum' ? 'aluminum-raw' : 'stainless-brushed');
  const sheetMaterials = useImportedPbrMaterial(finish, realistic);
  const geometry = useMemo(() => {
    const jointCount = legs.length + 1;
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(new Float32Array(jointCount * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    result.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(jointCount * 4 * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    let groupOffset = 0;
    const addGroup = (count: number, materialIndex: number) => {
      if (sheetMaterials.oneSidedRelief) result.addGroup(groupOffset, count, materialIndex);
      groupOffset += count;
    };
    for (let index = 0; index < legs.length; index++) {
      const a = index * 4;
      const b = (index + 1) * 4;
      // Both broad faces and both long edges share the same bend vertices.
      indices.push(a, b, a + 1, b, b + 1, a + 1);
      addGroup(6, 1);
      indices.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3);
      addGroup(6, 2);
      indices.push(a, a + 2, b, b, a + 2, b + 2);
      addGroup(6, 0);
      indices.push(a + 1, b + 1, a + 3, b + 1, b + 3, a + 3);
      addGroup(6, 0);
    }
    const last = legs.length * 4;
    indices.push(0, 1, 2, 2, 1, 3);
    addGroup(6, 0);
    indices.push(last, last + 2, last + 1, last + 1, last + 2, last + 3);
    addGroup(6, 0);
    result.setIndex(indices);
    return result;
  }, [legs.length, sheetMaterials.oneSidedRelief]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const updateTextureCoordinates = () => {
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const totalLength = legs.reduce((sum, leg) => sum + leg.length, 0);
    let station = 0;
    for (let index = 0; index <= legs.length; index++) {
      for (const side of [1, -1]) {
        for (const zSide of [-1, 1]) {
          const vertex = index * 4 + (side === 1 ? 0 : 2) + (zSide === -1 ? 0 : 1);
          uv.setXY(vertex, station, zSide === -1 ? 0 : dimensions.width);
        }
      }
      if (index < legs.length) station += legs[index].length;
    }
    uv.needsUpdate = true;
  };

  const updateGeometry = (flatness: number) => {
    const points = [{ x: 0, y: 0 }];
    const directions: number[] = [];
    let direction = 0;
    legs.forEach((leg, index) => {
      directions.push(direction);
      const previous = points[index];
      points.push({
        x: previous.x + leg.length * Math.cos(direction),
        y: previous.y + leg.length * Math.sin(direction),
      });
      const bend = dimensions.bends[index];
      if (bend) {
        const angle = Math.max(15, Math.min(165, Math.abs(bend.angle)));
        const sign = bend.angle < 0 ? -1 : bend.direction;
        direction += sign * THREE.MathUtils.degToRad(angle) * (1 - flatness);
      }
    });
    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const halfThickness = Math.max(1, dimensions.thickness) / 2;
    const halfWidth = dimensions.width / 2;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    points.forEach((point, index) => {
      const before = directions[Math.max(0, index - 1)];
      const after = directions[Math.min(index, directions.length - 1)];
      const normalBefore = new THREE.Vector2(-Math.sin(before), Math.cos(before));
      const normalAfter = new THREE.Vector2(-Math.sin(after), Math.cos(after));
      const miter = normalBefore.clone().add(normalAfter).normalize();
      const scale = halfThickness / Math.max(0.2, miter.dot(normalBefore));
      const centerX = point.x - (minX + maxX) / 2;
      const centerY = point.y - (minY + maxY) / 2;
      for (const side of [1, -1]) {
        for (const zSide of [-1, 1]) {
          const vertex = index * 4 + (side === 1 ? 0 : 2) + (zSide === -1 ? 0 : 1);
          positions.setXYZ(vertex, centerX + miter.x * scale * side, centerY + miter.y * scale * side, halfWidth * zSide);
        }
      }
    });
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  };

  React.useLayoutEffect(() => {
    started.current = null;
    settled.current = false;
    updateTextureCoordinates();
    updateGeometry(unfolding ? 0 : 1);
  }, [geometry, dimensions, unfolding]);

  useFrame((state) => {
    if (!root.current || settled.current) return;
    if (started.current === null) started.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - started.current;
    const t = Math.max(0, Math.min(1, elapsed / 1.5));
    const eased = t * t * (3 - 2 * t);
    const flatness = unfolding ? eased : 1 - eased;
    root.current.rotation.x = flatness * Math.PI / 2;
    root.current.position.y = THREE.MathUtils.lerp(restY, 0, flatness);
    root.current.position.z = flatness * dimensions.thickness / 2;
    updateGeometry(flatness);
    settled.current = t >= 1;
  });

  return (
    <group ref={root} position={[0, unfolding ? restY : 0, unfolding ? 0 : dimensions.thickness / 2]} rotation={[unfolding ? 0 : Math.PI / 2, 0, 0]}>
      <mesh geometry={geometry} material={realistic ? sheetMaterials.material : undefined} frustumCulled={false} castShadow receiveShadow={false}>
        {!realistic && <meshStandardMaterial color="#aeb8c3" metalness={0.67} roughness={0.34} side={THREE.DoubleSide} />}
      </mesh>
    </group>
  );
}

function FlatPlacementSheet({
  dimensions,
  realistic,
  stage,
  targetLegId,
  holeShape,
  holeOrientation,
  holeCornerRadius,
  draft,
  patternConfig,
  onWingSelect,
  onCandidate,
  onDeleteHole,
  cornerRadiusPreview = false,
}: {
  dimensions: SheetMetalState;
  realistic: boolean;
  stage: 'select-wing' | 'choose-shape' | 'choose-pattern' | 'position' | 'configure-single' | 'preview';
  targetLegId: string | null;
  holeShape: HoleShape;
  holeOrientation: 'along_length' | 'along_width';
  holeCornerRadius: number;
  draft: { legId: string; dist: number; offset: number; valid: boolean } | null;
  patternConfig: HolePatternConfig | null;
  onWingSelect?: (id: string) => void;
  onCandidate?: (candidate: { legId: string; dist: number; offset: number; valid: boolean } | null) => void;
  onDeleteHole?: (legId: string, holeIndex: number) => void;
  cornerRadiusPreview?: boolean;
}) {
  const blankPlan = dimensions.blankShape ? blankBendPlan(dimensions) : null;
  const legs = dimensions.legs.slice(0, dimensions.bendCount + 1).map((leg, index) => blankPlan ? { ...leg, length: blankPlan.wings[index].length } : leg);
  const totalLength = blankPlan?.frame.length ?? legs.reduce((sum, leg) => sum + leg.length, 0);
  const starts: number[] = [];
  let cursor = -totalLength / 2;
  legs.forEach((leg, index) => { starts.push(blankPlan ? blankPlan.wings[index].start - totalLength / 2 : cursor); cursor += leg.length; });
  const thickness = Math.max(1, dimensions.thickness);
  const finish = dimensions.finish || (dimensions.material === 'Steel' ? 'steel-raw' : dimensions.material === 'Aluminum' ? 'aluminum-raw' : 'stainless-brushed');
  const sheetMaterials = useImportedPbrMaterial(finish, realistic);
  const flatRadii = getFlatCornerRadii(dimensions);
  const sheetGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    if (blankPlan) {
      const points = blankPlan.frame.outline;
      shape.moveTo(points[0].x - totalLength / 2, dimensions.width / 2 - points[0].y);
      for (const p of points.slice(1)) shape.lineTo(p.x - totalLength / 2, dimensions.width / 2 - p.y);
      shape.closePath();
      shape.holes = blankInnerContours(blankPlan.frame.definition).map(points => new THREE.Path(points.map(point => {
        const p = blankPlan.frame.project(point);
        return new THREE.Vector2(p.x - totalLength / 2, dimensions.width / 2 - p.y);
      })));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
      if (sheetMaterials.oneSidedRelief) {
        const caps = geometry.groups.find(group => group.materialIndex === 0), edges = geometry.groups.find(group => group.materialIndex === 1);
        if (caps && edges) {
          geometry.clearGroups(); geometry.addGroup(caps.start, caps.count / 2, 0);
          geometry.addGroup(caps.start + caps.count / 2, caps.count / 2, 1); geometry.addGroup(edges.start, edges.count, 2);
        }
      }
      return geometry;
    }
    const x0 = -totalLength / 2;
    const x1 = totalLength / 2;
    const y0 = -dimensions.width / 2;
    const y1 = dimensions.width / 2;
    const maxRadius = Math.min(totalLength / 2, dimensions.width / 2);
    const r0 = Math.min(flatRadii.startLeft, maxRadius);
    const r1 = Math.min(flatRadii.endLeft, maxRadius);
    const r2 = Math.min(flatRadii.endRight, maxRadius);
    const r3 = Math.min(flatRadii.startRight, maxRadius);
    shape.moveTo(x0 + r0, y0);
    shape.lineTo(x1 - r1, y0);
    if (r1) shape.absarc(x1 - r1, y0 + r1, r1, -Math.PI / 2, 0, false);
    else shape.lineTo(x1, y0);
    shape.lineTo(x1, y1 - r2);
    if (r2) shape.absarc(x1 - r2, y1 - r2, r2, 0, Math.PI / 2, false);
    else shape.lineTo(x1, y1);
    shape.lineTo(x0 + r3, y1);
    if (r3) shape.absarc(x0 + r3, y1 - r3, r3, Math.PI / 2, Math.PI, false);
    else shape.lineTo(x0, y1);
    shape.lineTo(x0, y0 + r0);
    if (r0) shape.absarc(x0 + r0, y0 + r0, r0, Math.PI, Math.PI * 1.5, false);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    if (sheetMaterials.oneSidedRelief) {
      const caps = geometry.groups.find(group => group.materialIndex === 0);
      const edges = geometry.groups.find(group => group.materialIndex === 1);
      if (caps && edges && caps.count % 2 === 0) {
        geometry.clearGroups();
        const oneFaceCount = caps.count / 2;
        geometry.addGroup(caps.start, oneFaceCount, 2);
        geometry.addGroup(caps.start + oneFaceCount, oneFaceCount, 1);
        geometry.addGroup(edges.start, edges.count, 0);
      }
    }
    return geometry;
}, [dimensions.blankShape, dimensions.blankLength, dimensions.blankWidth, dimensions.blankInnerDiameter, dimensions.blankToothCount, dimensions.blankToothHeight, dimensions.blankBranchCount, dimensions.blankBranchHeight, dimensions.blankOrientation, dimensions.width, thickness, totalLength, flatRadii.startLeft, flatRadii.startRight, flatRadii.endLeft, flatRadii.endRight, sheetMaterials.oneSidedRelief]);
  useEffect(() => () => sheetGeometry.dispose(), [sheetGeometry]);
  const [hover, setHover] = useState<{ legId: string; dist: number; offset: number; valid: boolean } | null>(null);
  const [selectedHole, setSelectedHole] = useState<{ legId: string; index: number; x: number; y: number } | null>(null);

  const getCandidate = (point: THREE.Vector3, legIndex: number) => {
    const leg = legs[legIndex];
    const local = point.x - starts[legIndex];
    const dist = legIndex === legs.length - 1 ? leg.length - local : local;
    const offset = dimensions.width / 2 - point.y;
    const hasBendAtStart = legIndex > 0 && legIndex < dimensions.bendCount;
    const bounds = getHoleConstraints({ ...leg, holeShape, holeOrientation }, dimensions.thickness, dimensions.width, dimensions.bendCount > 0, undefined, undefined, undefined, dimensions.bendCount > 0, hasBendAtStart);
    const roundedDist = Math.round(dist);
    const roundedOffset = Math.round(offset);
    return {
      legId: leg.id,
      dist: Math.max(0, Math.min(leg.length, roundedDist)),
      offset: Math.max(0, Math.min(dimensions.width, roundedOffset)),
      valid: bounds.isFeasible && roundedDist >= bounds.minDist && roundedDist <= bounds.maxDist
        && roundedOffset >= bounds.minOffset && roundedOffset <= bounds.maxOffset
        && (!blankPlan || blankHoleAllowed(dimensions, legIndex, roundedDist, roundedOffset, bounds.rx, bounds.rz)),
    };
  };
  const onPointerMove = (event: any) => {
    if (stage !== 'position' || draft) return;
    const index = legs.findIndex((leg, legIndex) =>
      event.point.x >= starts[legIndex] && event.point.x <= starts[legIndex] + leg.length
      && (!targetLegId || leg.id === targetLegId),
    );
    if (index < 0) {
      setHover(null);
      return;
    }
    const candidate = getCandidate(event.point, index);
    setHover(candidate);
    event.stopPropagation();
  };
  const onClick = (event: any) => {
    event.stopPropagation();
    if (stage === 'preview') return;
    const clickedHole = stage === 'position' ? null : legs.flatMap((leg, legIndex) => {
      if (!leg.hasHole) return [];
      return getPatternPositions(leg, dimensions.width, leg.holePattern || dimensions.holePattern, dimensions.thickness, dimensions.bendCount > 0, legIndex > 0 && legIndex < dimensions.bendCount)
        .map((position, index) => ({ legId: leg.id, index, textCutout: position.textCutout,
          x: starts[legIndex] + (legIndex === legs.length - 1 ? leg.length - position.dist : position.dist),
          y: dimensions.width / 2 - position.offset,
          radius: Math.max(7, (leg.holeDiam || 5) * 0.75),
        })).filter(hole => !hole.textCutout);
    }).find(hole => Math.hypot(event.point.x - hole.x, event.point.y - hole.y) <= hole.radius);
    if (clickedHole) {
      setSelectedHole({ legId: clickedHole.legId, index: clickedHole.index, x: clickedHole.x, y: clickedHole.y });
      return;
    }
    setSelectedHole(null);
    const index = legs.findIndex((leg, legIndex) => event.point.x >= starts[legIndex] && event.point.x <= starts[legIndex] + leg.length);
    if (index < 0) return;
    if (stage === 'select-wing') {
      onWingSelect?.(legs[index].id);
      return;
    }
    if (stage === 'position' && (!targetLegId || legs[index].id === targetLegId)) {
      const candidate = getCandidate(event.point, index);
      // An invalid hover is useful feedback, but must never become a placed draft.
      if (!candidate.valid) { setHover(candidate); return; }
      onCandidate?.(candidate);
    }
  };

  const visiblePattern = stage === 'choose-pattern' && patternConfig && targetLegId
    ? { leg: legs.find(leg => leg.id === targetLegId), config: patternConfig }
    : null;
  const patternPreviews = numberPreviewCutouts(legs.flatMap((leg, index) => {
    const positions = explicitHoles(leg, dimensions);
    if (visiblePattern?.leg?.id === leg.id && visiblePattern.config.mode !== 'single') {
      positions.push(...holeSeries({ ...leg, holeShape, holeOrientation, holeCornerRadius, holePattern: visiblePattern.config }, dimensions));
    }
    return positions
      .map(position => ({ legId: leg.id, textCutout: position.textCutout, leg: { ...leg, holeContour: position.contour, holeShape: position.shape, holeDiam: position.diam, holeLength: position.length, holeWidth: position.width, holeOrientation: position.orientation, holeCornerRadius: position.cornerRadius }, x: starts[index] + (index === legs.length - 1 ? leg.length - position.dist : position.dist), y: dimensions.width / 2 - position.offset }));
  }));
  const activeMarker = draft || (stage === 'position' ? hover : null);
  const markerIndex = activeMarker ? legs.findIndex(leg => leg.id === activeMarker.legId) : -1;
  const markerX = activeMarker && markerIndex >= 0
    ? starts[markerIndex] + (markerIndex === legs.length - 1 ? legs[markerIndex].length - activeMarker.dist : activeMarker.dist)
    : 0;
  const markerY = activeMarker ? dimensions.width / 2 - activeMarker.offset : 0;
  const nearestLongEdgeX = markerIndex >= 0 && markerX - starts[markerIndex] < starts[markerIndex] + legs[markerIndex].length - markerX
    ? starts[markerIndex]
    : markerIndex >= 0 ? starts[markerIndex] + legs[markerIndex].length : markerX;
  const nearestWidthEdgeY = markerY < 0 ? -dimensions.width / 2 : dimensions.width / 2;
  const longEdgeDistance = markerIndex >= 0 ? Math.abs(markerX - nearestLongEdgeX) : 0;
  const widthEdgeDistance = Math.abs(markerY - nearestWidthEdgeY);
  // Keep placement dimensions secondary to the part, even when the camera is
  // zoomed in to place a hole precisely.
  const dimensionFontSize = Math.max(2.1, Math.min(3.2, dimensions.width * 0.045));
  const dimensionLabelOffset = Math.max(2.5, dimensions.width * 0.014);
  const dimensionOutlineWidth = dimensionFontSize * 0.018;
  const markerHole = legs[markerIndex >= 0 ? markerIndex : 0] ?? dimensions.legs[0];
  const markerPreviewGeometry = useMemo(
    () => createFlatHolePreviewGeometry(markerHole, holeShape, holeOrientation, holeCornerRadius),
    [markerHole, holeShape, holeOrientation, holeCornerRadius],
  );
  const markerPreviewEdges = useMemo(() => new THREE.EdgesGeometry(markerPreviewGeometry), [markerPreviewGeometry]);
  useEffect(() => () => {
    markerPreviewGeometry.dispose();
    markerPreviewEdges.dispose();
  }, [markerPreviewGeometry, markerPreviewEdges]);

  return (
    <>
      <mesh geometry={sheetGeometry} material={realistic ? sheetMaterials.material : undefined} onPointerMove={onPointerMove} onPointerOut={() => setHover(null)} onClick={onClick} receiveShadow={false} castShadow>
        {!realistic && <meshStandardMaterial color="#b8c0c8" metalness={0.62} roughness={0.38} />}
      </mesh>
      {legs.map((leg, index) => {
        const centerX = starts[index] + leg.length / 2;
        const selected = stage !== 'preview' && leg.id === (hover?.legId || draft?.legId || targetLegId);
        const labelSize = Math.max(.5, Math.min(24, dimensions.width * 0.1, leg.length * .24));
        const labelPoint = wingLabelPoint(leg.length, dimensions.width, labelSize * .78,
          annotationOpenings(leg, explicitHoles(leg, dimensions)),
          blankPlan ? p => blankHoleAllowed(dimensions, index, p.x, p.y, labelSize * .78, labelSize * .78) : undefined);
        return (
          <group key={`flat-leg-${leg.id}`}>
            {selected && <mesh position={[centerX, 0, thickness + 0.05]}><planeGeometry args={[leg.length, dimensions.width]} /><meshBasicMaterial color="#e83c69" transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} /></mesh>}
            <group position={[starts[index] + (index === legs.length - 1 ? leg.length - (labelPoint?.x ?? leg.length / 2) : labelPoint?.x ?? leg.length / 2), dimensions.width / 2 - (labelPoint?.y ?? dimensions.width / 2), thickness + 0.15]}>
              {labelPoint && <WingBadge letter={leg.id} fontSize={labelSize} depthTest={false} />}
            </group>
            {!blankPlan && index < legs.length - 1 && <>
              <mesh position={[starts[index] + leg.length, 0, thickness + 0.12]} raycast={() => null}>
                <planeGeometry args={[Math.max(8, thickness * 6), dimensions.width]} />
                <meshBasicMaterial color="#e83c69" transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
              <Line points={[[starts[index] + leg.length, -dimensions.width / 2, thickness + 0.2], [starts[index] + leg.length, dimensions.width / 2, thickness + 0.2]]} color="#e83c69" lineWidth={2} />
              <Text position={[starts[index] + leg.length, dimensions.width / 2 + Math.max(8, dimensions.width * 0.04), thickness + 0.2]} fontSize={Math.max(5, Math.min(12, dimensions.width * 0.035))} color="#e83c69" anchorX="center" anchorY="middle">{`Pli ${index + 1} · zone`}</Text>
            </>}
          </group>
        );
      })}
      {blankPlan?.bands.map(band => {
        const cross = blankPlan.frame.crossSection(band.position), x = band.position - totalLength / 2;
        return <group key={`blank-fold-zone-${band.index}`}>
          <mesh position={[x, dimensions.width / 2 - (cross.min + cross.max) / 2, thickness + .12]} raycast={() => null}>
            <planeGeometry args={[Math.max(8, band.half * 2, thickness * 7), cross.max - cross.min]} />
            <meshBasicMaterial color="#e83c69" transparent opacity={.22} depthWrite={false} />
          </mesh>
          <Line points={[[x, dimensions.width / 2 - cross.min, thickness + .2], [x, dimensions.width / 2 - cross.max, thickness + .2]]} color="#e83c69" lineWidth={1} />
        </group>;
      })}
      {stage === 'preview' && patternPreviews.map((hole, index) => <FlatHoleOutline key={`flat-hole-${hole.legId}-${index}`} leg={hole.leg} x={hole.x} y={hole.y} z={thickness + 0.32} number={hole.number} badgeFontSize={Math.max(3.4, Math.min(6, dimensions.width * 0.055))} />)}
      {selectedHole && (() => {
        const holeLeg = legs.find(leg => leg.id === selectedHole.legId);
        if (!holeLeg) return null;
        return <>
          <mesh position={[selectedHole.x, selectedHole.y, thickness + 0.6]} raycast={() => null}>
            <ringGeometry args={[Math.max(5, (holeLeg.holeDiam || 5) * 0.65), Math.max(7, (holeLeg.holeDiam || 5) * 0.9), 32]} />
            <meshBasicMaterial color="#ffb400" transparent opacity={0.98} side={THREE.DoubleSide} depthTest={false} />
          </mesh>
          <Html center position={[selectedHole.x, selectedHole.y, thickness + 1.2]} distanceFactor={150} style={{ pointerEvents: 'auto' }}>
            <div onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-300/70 bg-slate-950/95 p-1.5 text-[10px] text-white shadow-xl">
              <span className="px-1">Trou sélectionné · aile {selectedHole.legId}</span>
              <button type="button" onClick={() => { onDeleteHole?.(selectedHole.legId, selectedHole.index); setSelectedHole(null); }} className="rounded-md bg-rose-600 px-2 py-1 font-bold hover:bg-rose-500">Supprimer</button>
              <button type="button" onClick={() => setSelectedHole(null)} className="rounded-md border border-white/20 px-2 py-1">×</button>
            </div>
          </Html>
        </>;
      })()}
      {activeMarker && <>
        <Line points={[[markerX, markerY, thickness + 0.55], [nearestLongEdgeX, markerY, thickness + 0.55]]} color="#e83c69" lineWidth={1.7} />
        <Line points={[[markerX, markerY, thickness + 0.56], [markerX, nearestWidthEdgeY, thickness + 0.56]]} color="#e83c69" lineWidth={1.7} />
        <mesh position={[markerX, markerY, thickness + 0.7]} geometry={markerPreviewGeometry} raycast={() => null}>
          <meshBasicMaterial color="#e83c69" transparent opacity={activeMarker.valid ? 0.32 : 0.18} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <lineSegments position={[markerX, markerY, thickness + 0.72]} geometry={markerPreviewEdges} raycast={() => null}>
          <lineBasicMaterial color={activeMarker.valid ? '#e83c69' : '#ef4444'} depthTest={false} depthWrite={false} />
        </lineSegments>
        <Text position={[(markerX + nearestLongEdgeX) / 2, markerY + dimensionLabelOffset, thickness + 0.8]} fontSize={dimensionFontSize} color="#be185d" anchorX="center" anchorY="bottom" outlineWidth={dimensionOutlineWidth} outlineColor="#f8fafc" renderOrder={110} material-depthTest={false} material-depthWrite={false}>{`${Math.round(longEdgeDistance)} mm`}</Text>
        <Text position={[markerX + dimensionLabelOffset, (markerY + nearestWidthEdgeY) / 2, thickness + 0.8]} rotation={[0, 0, Math.PI / 2]} fontSize={dimensionFontSize} color="#be185d" anchorX="center" anchorY="middle" outlineWidth={dimensionOutlineWidth} outlineColor="#f8fafc" renderOrder={110} material-depthTest={false} material-depthWrite={false}>{`${Math.round(widthEdgeDistance)} mm`}</Text>
      </>}
    </>
  );
}

function FlatHoleOutline({ leg, x, y, z, number, badgeFontSize }: { leg: LegConfig; x: number; y: number; z: number; number?: number; badgeFontSize: number }) {
  const geometry = useMemo(() => createFlatHolePreviewGeometry(leg, leg.holeShape || 'round', leg.holeOrientation || 'along_length', leg.holeCornerRadius || 0),
    [leg.holeShape, leg.holeDiam, leg.holeLength, leg.holeWidth, leg.holeOrientation, leg.holeCornerRadius, leg.holeContour]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);
  useEffect(() => () => { geometry.dispose(); edges.dispose(); }, [geometry, edges]);
  const badgeRadius = badgeFontSize * 0.92;
  const radii = getHoleRadii(leg);
  const badgeX = radii.rx + badgeRadius + 1;
  return <group position={[x, y, z]}>
    <lineSegments geometry={edges} raycast={() => null}>
      <lineBasicMaterial color="#e83c69" depthTest={false} depthWrite={false} />
    </lineSegments>
    {number !== undefined && <><mesh position={[badgeX, 0, 0.04]} raycast={() => null} renderOrder={99}>
      <circleGeometry args={[badgeRadius, 32]} />
      <meshBasicMaterial color={HOLE_NUMBER_BADGE_COLOR} side={THREE.DoubleSide} depthTest={false} depthWrite={false} />
    </mesh>
    <Text position={[badgeX, 0, 0.08]} fontSize={badgeFontSize} color="#fff" anchorX="center" anchorY="middle"
      outlineWidth={Math.max(0.04, badgeFontSize * 0.012)} outlineColor="#17202b" renderOrder={101} raycast={() => null}
      material-depthTest={false} material-depthWrite={false}>
      {String(number)}
    </Text></>}
  </group>;
}

interface SheetMetalGroupProps extends ViewerProps {
  showDimensions?: boolean;
  showDimensionInfo?: boolean;
  exportOnly?: boolean;
  exportGrainDirection?: 'length' | 'width';
}


/**
 * Lightweight rigid-body feel for the preview. It is deliberately local to
 * the visualizer: the STEP geometry remains exact and no physics engine is
 * involved in export. After the user stops changing dimensions, the new
 * piece lifts slightly, accelerates down, and settles on the preview floor.
 */
function PhysicsDropGroup({
  children,
  bendCount,
  restY,
  floorY,
  supportPoints,
  restTiltX = -0.1,
  restTiltZ = 0.025,
  onImpact,
}: {
  children: React.ReactNode;
  bendCount: number;
  restY: number;
  floorY: number;
  supportPoints: THREE.Vector3[];
  restTiltX?: number;
  restTiltZ?: number;
  onImpact?: (speed: number) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const velocityRef = useRef(0);
  const angularVelocityRef = useRef({ x: 0, z: 0 });
  const targetYRef = useRef(restY);
  const targetTiltRef = useRef({ x: restTiltX, z: restTiltZ });
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const droppingRef = useRef(false);
  const hapticSentRef = useRef(false);
  const groundedRef = useRef(true);
  const previousBendCountRef = useRef(bendCount);
  const supportEulerRef = useRef(new THREE.Euler());
  const supportPointRef = useRef(new THREE.Vector3());

  useEffect(() => {
    targetYRef.current = restY;
    targetTiltRef.current = { x: restTiltX, z: restTiltZ };
  }, [restY, restTiltX, restTiltZ]);

  useEffect(() => {
    if (previousBendCountRef.current === bendCount) return;
    previousBendCountRef.current = bendCount;

    if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
    dropTimerRef.current = setTimeout(() => {
      if (!groupRef.current) return;
      // Start with a small angular error, then let the heavy sheet settle
      // flat instead of freezing in the tilted launch pose.
      groupRef.current.position.y = Math.max(groupRef.current.position.y, restY) + 34;
      groupRef.current.rotation.x = -0.16;
      groupRef.current.rotation.z = 0.045;
      // A steel part should not hang in the air: give it an initial downward
      // impulse in addition to the stronger gravity used by the preview.
      velocityRef.current = -18;
      angularVelocityRef.current = { x: -0.2, z: 0.08 };
      hapticSentRef.current = false;
      groundedRef.current = false;
      droppingRef.current = true;
    }, 140);

    return () => {
      if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
    };
  }, [bendCount]);

  useFrame((_, delta) => {
    if (!groupRef.current || !droppingRef.current) return;
    const step = Math.min(delta, 0.04);
    // Deliberately heavier/faster than a generic UI drop. This is a visual
    // cue only; exported STEP geometry is unaffected.
    if (!groundedRef.current) {
      velocityRef.current -= 500 * step;
      groupRef.current.position.y += velocityRef.current * step;
    }

    // A damped angular spring lets the sheet wobble on impact, then settle
    // precisely into the flat resting pose.
    const tiltSpring = 26;
    const tiltDamping = 10.5;
    angularVelocityRef.current.x += (
      (targetTiltRef.current.x - groupRef.current.rotation.x) * tiltSpring
      - angularVelocityRef.current.x * tiltDamping
    ) * step;
    angularVelocityRef.current.z += (
      (targetTiltRef.current.z - groupRef.current.rotation.z) * tiltSpring
      - angularVelocityRef.current.z * tiltDamping
    ) * step;
    groupRef.current.rotation.x += angularVelocityRef.current.x * step;
    groupRef.current.rotation.z += angularVelocityRef.current.z * step;

    // Keep the lowest point of the rotated sheet on the floor while it
    // settles. A fixed landing height makes the part clip through the ground
    // during its wobble or appear to hover when the support edge changes.
    const supportEuler = supportEulerRef.current;
    supportEuler.set(groupRef.current.rotation.x, groupRef.current.rotation.y, groupRef.current.rotation.z, groupRef.current.rotation.order);
    let minSupportY = Infinity;
    for (const point of supportPoints) {
      supportPointRef.current.copy(point).applyEuler(supportEuler);
      minSupportY = Math.min(minSupportY, supportPointRef.current.y);
    }
    targetYRef.current = Number.isFinite(minSupportY) ? floorY - minSupportY : restY;

    if (groundedRef.current) {
      groupRef.current.position.y = targetYRef.current;
      velocityRef.current = 0;
    }

    if (!groundedRef.current && groupRef.current.position.y <= targetYRef.current) {
      const impactSpeed = Math.abs(velocityRef.current);
      groupRef.current.position.y = targetYRef.current;
      // One soft contact only: impact effects carry the sense of weight while
      // the sheet remains grounded instead of visibly bouncing or floating.
      velocityRef.current = 0;
      groundedRef.current = true;
      angularVelocityRef.current.x *= -0.18;
      angularVelocityRef.current.z *= -0.18;

      if (!hapticSentRef.current) {
        hapticSentRef.current = true;
        onImpact?.(impactSpeed);
        triggerHaptic('impact');
      }

    }

    const angleSettled =
      Math.abs(targetTiltRef.current.x - groupRef.current.rotation.x) < 0.002
      && Math.abs(targetTiltRef.current.z - groupRef.current.rotation.z) < 0.002
      && Math.abs(angularVelocityRef.current.x) < 0.01
      && Math.abs(angularVelocityRef.current.z) < 0.01;
    if (angleSettled && groundedRef.current) {
      velocityRef.current = 0;
      angularVelocityRef.current = { x: 0, z: 0 };
      groupRef.current.rotation.x = targetTiltRef.current.x;
      groupRef.current.rotation.z = targetTiltRef.current.z;
      groupRef.current.position.y = targetYRef.current;
      droppingRef.current = false;
    }
  });

  return <group ref={groupRef} position={[0, restY, 0]}>{children}</group>;
}

/** Small, pooled translucent puffs spreading along the ground at impact. */
function ImpactDust({ impact, width, contactX }: {
  impact: React.MutableRefObject<{ serial: number; strength: number }>;
  width: number;
  contactX: number;
}) {
  const root = useRef<THREE.Group>(null);
  const seen = useRef(0);
  const age = useRef(10);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.3)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame((_, delta) => {
    if (!root.current) return;
    if (seen.current !== impact.current.serial) {
      seen.current = impact.current.serial;
      age.current = 0;
    }
    age.current += Math.min(delta, 0.05);
    const t = age.current;
    root.current.visible = t < 1.5;
    if (t >= 1.5) return;
    root.current.children.forEach((child, i) => {
      const sprite = child as THREE.Sprite;
      const angle = i * 2.399963;
      const spread = (1 - Math.exp(-t * 3)) * (20 + (i % 5) * 7);
      sprite.position.set(contactX + Math.cos(angle) * spread,
        -48 + t * (4 + i % 4),
        ((i / 23) - 0.5) * width + Math.sin(angle) * spread);
      const size = (12 + i % 7) * (1 + t * 1.8);
      sprite.scale.set(size * 1.5, size, 1);
      sprite.material.opacity = Math.min(1, t * 25) * Math.pow(1 - t / 1.5, 2) * 0.38 * impact.current.strength;
    });
  });
  return <group ref={root} visible={false}>
    {Array.from({ length: 24 }, (_, i) => <sprite key={i} raycast={() => {}}>
      <spriteMaterial map={texture} color="#998f82" transparent depthWrite={false} toneMapped={false} />
    </sprite>)}
  </group>;
}

/** Soft circular pool of studio light on the floor beneath the formed part. */
function StudioFloorSpot({ centerX, floorY, radius }: {
  centerX: number;
  floorY: number;
  radius: number;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const gradient = context.createRadialGradient(128, 128, 5, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 244, 226, 0.34)');
    gradient.addColorStop(0.28, 'rgba(255, 232, 205, 0.25)');
    gradient.addColorStop(0.62, 'rgba(255, 219, 190, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 210, 180, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, []);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;

  return (
    <mesh
      position={[centerX, floorY + 0.18, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => {}}
      renderOrder={1}
    >
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.82}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export const SheetMetalGroup = React.memo(function SheetMetalGroup({
  dimensions, 
  profileData,
  realistic, 
  activeBendIndex = 0,
  showActiveBendCue = false,
  activeLegIndex = 0,
  showActiveLegCue = false,
  placementMode, 
  placementTargetLegId,
  placementDraft,
  onHolePlacement,
  onPlacementCandidate,
  onPlacementWingSelect,
  onHoleMoveRequest,
  onLegLengthChange,
  onLegLengthEdit,
  onWidthChange,
  showDimensions = true,
  showDimensionInfo = false,
  exportOnly = false,
  exportGrainDirection,
  grainDirection = 'length',
}: SheetMetalGroupProps) {
  const [hoverPoint, setHoverPoint] = useState<THREE.Vector3 | null>(null);
  const [hoveredLegId, setHoveredLegId] = useState<string | null>(placementTargetLegId || null);
  const [hoveredHoleKey, setHoveredHoleKey] = useState<string | null>(null);
  const [placementPreview, setPlacementPreview] = useState<{ legId: string; dist: number; offset: number; valid: boolean } | null>(null);
  useEffect(() => {
    setHoveredLegId(placementTargetLegId || null);
    setPlacementPreview(null);
  }, [placementTargetLegId]);

  const finish = dimensions.finish || (dimensions.material === 'Steel' ? 'steel-raw' : dimensions.material === 'Aluminum' ? 'aluminum-raw' : 'stainless-brushed');
  const usePbrMaterial = realistic && !profileData.collision.hasCollision;
  const selectedGrain = exportOnly ? exportGrainDirection : grainDirection;
  const filmPeel = useMemo(() => exportOnly ? undefined : filmPeelCorner(dimensions, profileData.legTransforms), [dimensions, profileData.legTransforms, exportOnly]);
  const sheetMaterials = useImportedPbrMaterial(finish, realistic, finish === 'stainless-brushed' && selectedGrain === 'width' ? Math.PI / 2 : 0, filmPeel);

  const baseGeometry = useMemo(() => {
    if (dimensions.blankShape) return createFormedBlankGeometry(dimensions, sheetMaterials.oneSidedRelief);
    const extrudeSettings = {
      depth: dimensions.width,
      // Le biseau de l'ancien maillage de base créait un liseré rectangulaire
      // autour des coins après la soustraction CSG. Les arêtes de tôle sont
      // maintenant laissées nettes : les arrondis du développé sont ainsi
      // les seules arêtes visibles au bord de la pièce.
      bevelEnabled: false,
      steps: 1,
    };
    return sheetMaterials.oneSidedRelief
      ? createOneSidedTreadGeometry(profileData.shape, dimensions.width, profileData.treadFaceEdges)
      : applyContinuousSideUvs(new THREE.ExtrudeGeometry(profileData.shape, extrudeSettings), profileData.shape);
  }, [profileData.shape, profileData.treadFaceEdges, dimensions.width, dimensions.blankShape, dimensions.blankLength, dimensions.blankWidth, dimensions.blankInnerDiameter, dimensions.blankToothCount, dimensions.blankToothHeight, dimensions.blankBranchCount, dimensions.blankBranchHeight, dimensions.cornerRadius, dimensions.cornerRadii, dimensions.blankOrientation, dimensions.blankBendPositions, dimensions.bendCount, dimensions.thickness, sheetMaterials.oneSidedRelief]);

  const posX = profileData.centerOffsetX;
  const posY = profileData.centerOffsetY;
  const posZ = -dimensions.width / 2;

  const config = MATERIAL_CONFIG[dimensions.material] || MATERIAL_CONFIG['Steel'];

  const fallbackMaterial = (
    <meshToonMaterial
      color={profileData.collision.hasCollision ? "#dc2626" : config.color}
      emissive={profileData.collision.hasCollision ? "#7f1d1d" : "#000000"}
      emissiveIntensity={profileData.collision.hasCollision ? 0.3 : 0}
    />
  );

  const getLegAtPoint = (localX: number, localY: number, localZ: number) => {
    if (placementTargetLegId) {
      return profileData.legTransforms.find(legT => legT.id === placementTargetLegId) || null;
    }
    let bestLeg: LegTransform | null = null;
    let bestScore = Infinity;
    for (const legT of profileData.legTransforms) {
      const ax = legT.tip.x;
      const ay = legT.tip.y;
      const bx = legT.bendStart.x;
      const by = legT.bendStart.y;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((localX - ax) * dx + (localY - ay) * dy) / lengthSq));
      const px = ax + t * dx;
      const py = ay + t * dy;
      const profileDistance = Math.hypot(localX - px, localY - py);
      const zDistance = localZ < 0 ? -localZ : localZ > dimensions.width ? localZ - dimensions.width : 0;
      const normalDistance = Math.abs(
        (localX - legT.tip.x) * legT.normal.x + (localY - legT.tip.y) * legT.normal.y,
      );
      // Use the actual hit surface, not only the 2D projected segment. This
      // prevents an oblique/vertical wing from stealing clicks from another
      // wing whose projection happens to be closer in XY.
      const score = profileDistance + zDistance * 4 + normalDistance * 2;
      if (score < bestScore) {
        bestScore = score;
        bestLeg = legT;
      }
    }
    return bestLeg;
  };

  const handlePointerMove = (e: any) => {
    if (!placementMode) return;
    if (placementDraft) return;
    e.stopPropagation();
    setHoverPoint(e.point);
    const localX = e.point.x - posX;
    const localY = e.point.y - posY;
    const localZ = e.point.z - posZ;
    const legT = getLegAtPoint(localX, localY, localZ);
    setHoveredLegId(legT?.id || null);
    if (legT) {
      const leg = dimensions.legs.find(item => item.id === legT.id);
      const legIndex = dimensions.legs.findIndex(item => item.id === legT.id);
      const constraints = getHoleConstraints(leg || legT.length, dimensions.thickness, dimensions.width, dimensions.bendCount > 0, undefined, undefined, undefined, dimensions.bendCount > 0, legIndex > 0 && legIndex < dimensions.bendCount);
      const dist = Math.max(0, Math.min(legT.length, (localX - legT.tip.x) * legT.direction.x + (localY - legT.tip.y) * legT.direction.y));
      const offset = Math.max(0, Math.min(dimensions.width, localZ));
      setPlacementPreview({
        legId: legT.id,
        dist,
        offset,
        valid: dist >= constraints.minDist && dist <= constraints.maxDist && offset >= constraints.minOffset && offset <= constraints.maxOffset,
      });
    }
    document.body.style.cursor = 'crosshair';
  };

  const handlePointerOut = () => {
    if (placementDraft) return;
    setHoverPoint(null);
    if (!placementTargetLegId) setHoveredLegId(null);
    setPlacementPreview(null);
    document.body.style.cursor = 'auto';
  };

  const handleClick = (e: any) => {
    if (!placementMode || !onPlacementCandidate || placementDraft) return;
    e.stopPropagation();
    const point = e.point as THREE.Vector3;

    // Convert world point to local group coordinates
    const localX = point.x - posX;
    const localY = point.y - posY;
    const localZ = point.z - posZ;
    const bestLeg = getLegAtPoint(localX, localY, localZ);

    if (bestLeg) {
      if (!placementTargetLegId) {
        onPlacementWingSelect?.(bestLeg.id);
        return;
      }
      // Distance from tip along the leg's direction
      const dist = (localX - bestLeg.tip.x) * bestLeg.direction.x
        + (localY - bestLeg.tip.y) * bestLeg.direction.y;
      // Safe distance from outer tip and avoiding the bend deformation zone (rOut)
      const holeLeg = dimensions.legs.find(item => item.id === bestLeg.id);
      const bestLegIndex = dimensions.legs.findIndex(item => item.id === bestLeg.id);
      const constraints = getHoleConstraints(holeLeg || bestLeg.length, dimensions.thickness, dimensions.width, dimensions.bendCount > 0, undefined, undefined, undefined, dimensions.bendCount > 0, bestLegIndex > 0 && bestLegIndex < dimensions.bendCount);
      const roundedDist = Math.round(dist);
      const roundedOffset = Math.round(localZ);
      const candidate = {
        legId: bestLeg.id,
        dist: Math.max(0, Math.min(bestLeg.length, roundedDist)),
        offset: Math.max(0, Math.min(dimensions.width, roundedOffset)),
        valid: constraints.isFeasible && roundedDist >= constraints.minDist && roundedDist <= constraints.maxDist
          && roundedOffset >= constraints.minOffset && roundedOffset <= constraints.maxOffset,
      };
      setPlacementPreview(candidate);
      onPlacementCandidate(candidate);
    }
  };

  // Holes to subtract
  const activeLegs = useMemo(() => dimensions.legs.slice(0, dimensions.bendCount + 1), [dimensions.legs, dimensions.bendCount]);
  const activeHoles = useMemo(() => activeLegs.filter(l => l.hasHole), [activeLegs]);
  const activeHoleInstances = useMemo(() => activeHoles.flatMap((holeLeg) =>
    getPatternPositions(holeLeg, dimensions.width, holeLeg.holePattern || dimensions.holePattern, dimensions.thickness, dimensions.bendCount > 0, dimensions.legs.indexOf(holeLeg) > 0 && dimensions.legs.indexOf(holeLeg) < dimensions.bendCount).map((position, index) => {
      const holeDefinition = { ...holeLeg, holeContour: position.contour, holeShape: position.shape || holeLeg.holeShape, holeDiam: position.diam ?? holeLeg.holeDiam, holeLength: position.length ?? holeLeg.holeLength, holeWidth: position.width ?? holeLeg.holeWidth, holeOrientation: position.orientation || holeLeg.holeOrientation, holeCornerRadius: position.cornerRadius ?? holeLeg.holeCornerRadius };
      const legIndex = dimensions.legs.indexOf(holeLeg);
      const safe = constrainHolePosition(holeDefinition, dimensions.width, dimensions.thickness, position.dist, position.offset, dimensions.bendCount > 0, legIndex > 0 && legIndex < dimensions.bendCount);
      return ({
      holeLeg,
      holeDefinition,
      textCutout: position.textCutout,
      dist: safe.dist,
      offset: safe.offset,
      index,
      });
    })
  ), [activeHoles, dimensions.width, dimensions.holePattern, dimensions.thickness, dimensions.bendCount]);

  const cornerRadii = getFlatCornerRadii(dimensions);
  const cornerEnds = getFlatCornerEnds(dimensions, profileData.legTransforms);
  const hasFlatCornerCuts = !dimensions.blankShape && Object.values(cornerRadii).some(radius => radius > 0) && cornerEnds.length > 0;
  const selectedLeg = placementMode
    ? profileData.legTransforms.find(legT => legT.id === (placementTargetLegId || hoveredLegId))
    : null;
  const lengthCueLeg = showActiveLegCue
    ? profileData.legTransforms[Math.max(0, Math.min(activeLegIndex, profileData.legTransforms.length - 1))]
    : null;

  return (
    <group position={[posX, posY, posZ]} userData={{ measureBends: bendMeasurementReferences(dimensions, profileData.legTransforms), measureHoles: activeHoleInstances.filter(hole => !hole.textCutout).flatMap(({ holeLeg, dist, offset, index }, number) => {
      const leg = profileData.legTransforms.find(item => item.id === holeLeg.id);
      if (!leg) return [];
      // Expose exact CAD centres on both faces. The ruler rejects whichever
      // face is hidden, without including text cutouts in the hole catalogue.
      return [-1, 1].map(side => ({
        id: `hole-${holeLeg.id}-${index}-${side}`,
        label: `Centre du trou ${number + 1} · aile ${holeLeg.id}`,
        point: [leg.tip.x + leg.direction.x * dist + side * leg.normal.x * dimensions.thickness / 2,
          leg.tip.y + leg.direction.y * dist + side * leg.normal.y * dimensions.thickness / 2, offset],
      }));
    }) }}>
      {usePbrMaterial && filmPeel && <ProtectiveFilmCorner peel={filmPeel} />}
      {showActiveBendCue && (
        <ActiveBendCue
          dimensions={dimensions}
          legTransforms={profileData.legTransforms}
          bendIndex={Math.max(0, Math.min(dimensions.bendCount - 1, activeBendIndex))}
        />
      )}
      {selectedLeg && <SelectedLegSurface legT={selectedLeg} dimensions={dimensions} />}
      {!selectedLeg && lengthCueLeg && <SelectedLegSurface legT={lengthCueLeg} dimensions={dimensions} />}
      {placementMode && placementPreview && selectedLeg?.id === placementPreview.legId && (
        <PlacementDistancePreview legT={selectedLeg} dist={placementPreview.dist} offset={placementPreview.offset} dimensions={dimensions} valid={placementPreview.valid} />
      )}
      {activeHoleInstances.length > 0 || hasFlatCornerCuts ? (
        <mesh 
          userData={{ measureSurface: true }}
          material={usePbrMaterial ? sheetMaterials.material : undefined}
        key={`csg-${dimensions.bendCount}-${Object.values(cornerRadii).join('-')}-${activeHoles.map(h => `${h.id}-${h.holeShape || 'round'}-${h.holeDiam}-${h.holeLength || 0}-${h.holeWidth || 0}-${h.holeCornerRadius || 0}-${h.holeDist}-${h.holeOffset}-${JSON.stringify(h.holePositions || [])}-${h.holeOrientation || 'along_length'}-${h.holePattern?.mode || dimensions.holePattern?.mode || 'single'}-${h.holePattern?.count || dimensions.holePattern?.count || 1}-${h.holePattern?.margin || dimensions.holePattern?.margin || 0}-${h.holePattern?.rows || dimensions.holePattern?.rows || 1}-${h.holePattern?.columns || dimensions.holePattern?.columns || 1}`).join('_')}`}
          castShadow 
          // This is one continuous, very thin sheet mesh. Receiving its own
          // directional shadow map produces rectangular acne/facets around
          // bends at grazing camera angles; keep its cast shadow on the floor.
          receiveShadow={false}
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <Geometry useGroups={usePbrMaterial && sheetMaterials.oneSidedRelief}>
            <Base geometry={baseGeometry} material={usePbrMaterial ? sheetMaterials.material : undefined} />
          {activeHoleInstances.map(({ holeLeg, holeDefinition, dist, offset, index: patternIndex }) => {
              const legT = profileData.legTransforms.find(lt => lt.id === holeLeg.id);
              if (!legT) return null;
              return <HoleSubtraction
                key={`hole-${holeLeg.id}-${patternIndex}`}
                holeDefinition={holeDefinition}
                legT={legT}
                dist={dist}
                offset={offset}
                thickness={dimensions.thickness}
                material={usePbrMaterial ? sheetMaterials.cutMaterial : undefined}
              />;
            })}
            {hasFlatCornerCuts && cornerEnds.flatMap(({ legTransform: legT, sideRadii }, endIndex) =>
              (['left', 'right'] as const).map((side) => {
              const radius = Math.min(
                sideRadii[side],
                Math.max(0.5, legT.length / 2),
                Math.max(0.5, dimensions.width / 2),
              );
              if (radius <= 0) return null;
              const displayRadius = Math.max(0.5, radius * VISUAL_CORNER_RADIUS_SCALE);
                return (
                  <FlatCornerSubtraction
                  key={`flat-corner-${legT.id}-${endIndex}-${side}`}
                  material={usePbrMaterial ? sheetMaterials.cutMaterial : undefined}
                  legT={legT}
                  side={side}
                  radius={displayRadius}
                  thickness={dimensions.thickness}
                  z={side === 'left' ? 0 : dimensions.width}
                />
              );
              }),
            )}
          </Geometry>
          {!usePbrMaterial && fallbackMaterial}
        </mesh>
      ) : (
        <mesh 
          key="base-mesh"
          userData={{ measureSurface: true }}
          geometry={baseGeometry} 
          material={usePbrMaterial ? sheetMaterials.material : undefined}
          castShadow 
          // Avoid self-shadow artifacts on the broad faces of the thin sheet.
          receiveShadow={false}
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          {!usePbrMaterial && fallbackMaterial}
        </mesh>
      )}

      {!exportOnly && <>
      {/* Repères A, B, C… directement sur la face de chaque aile. */}
      {((dimensions.blankShape === 'washer' || (dimensions.blankShape === 'gear' && dimensions.blankInnerDiameter)) ? [] : activeLegs).map((leg) => {
        const legT = profileData.legTransforms.find((item) => item.id === leg.id);
        return legT ? (
          <React.Fragment key={`wing-label-${leg.id}`}>
            <WingLabel legT={legT} leg={leg} holes={explicitHoles(leg, dimensions)} width={dimensions.width} thickness={dimensions.thickness} />
          </React.Fragment>
        ) : null;
      })}

      {!placementMode && activeHoleInstances.filter(hole => !hole.textCutout).map(({ holeLeg, holeDefinition, dist, offset, index }, number) => {
        const legT = profileData.legTransforms.find(item => item.id === holeLeg.id);
        const openingSize = holeDefinition.holeShape === 'round' || holeDefinition.holeShape === 'octagonal'
          ? holeDefinition.holeDiam
          : Math.min(holeDefinition.holeWidth || holeDefinition.holeDiam, holeDefinition.holeLength || holeDefinition.holeDiam);
        return legT ? <HoleNumberLabel
          key={`hole-number-${holeLeg.id}-${index}`}
          legT={legT}
          dist={dist}
          offset={offset}
          number={number + 1}
          openingSize={openingSize}
          thickness={dimensions.thickness}
          holeDefinition={holeDefinition}
          holes={explicitHoles(holeLeg, dimensions)}
          width={dimensions.width}
        /> : null;
      })}

      {showDimensionInfo && hasFlatCornerCuts && cornerEnds.flatMap(({ legTransform: legT, sideRadii }, endIndex) =>
        (['left', 'right'] as const).map((side) => {
          const radius = Math.min(
            sideRadii[side],
            Math.max(0.5, legT.length / 2),
            Math.max(0.5, dimensions.width / 2),
          );
          if (radius <= 0) return null;
          const displayRadius = Math.max(0.5, radius * VISUAL_CORNER_RADIUS_SCALE);
          return (
            <React.Fragment key={`corner-radius-marker-${legT.id}-${endIndex}-${side}`}>
              <FlatCornerRadiusMarker
                legT={legT}
                radius={radius}
                displayRadius={displayRadius}
                side={side}
                dimensions={dimensions}
              />
              </React.Fragment>
            );
        }),
      )}

      {/* Les cotations de trou restent discrètes : une zone invisible au-dessus
          de chaque ouverture sert uniquement de cible de survol. */}
      {!placementMode && activeHoleInstances.filter(hole => !hole.textCutout).map(({ holeLeg, dist, offset, index: patternIndex }) => {
        const legT = profileData.legTransforms.find(lt => lt.id === holeLeg.id);
        if (!legT) return null;
        const holeKey = `${holeLeg.id}-${patternIndex}`;
        const hx = legT.tip.x + (legT.direction.x * dist);
        const hy = legT.tip.y + (legT.direction.y * dist);
        const hitRadius = Math.max(5, (holeLeg.holeShape === 'round' || holeLeg.holeShape === 'octagonal'
          ? holeLeg.holeDiam
          : Math.max(holeLeg.holeLength || 25, holeLeg.holeWidth || 12)) * 0.55);
        return (
          <mesh
            key={`hole-hover-${holeKey}`}
            position={[hx, hy, offset]}
            onPointerOver={(event) => {
              event.stopPropagation();
              setHoveredHoleKey(holeKey);
              document.body.style.cursor = 'grab';
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              setHoveredHoleKey(current => current === holeKey ? null : current);
              document.body.style.cursor = 'auto';
            }}
            onClick={(event) => {
              event.stopPropagation();
              onHoleMoveRequest?.(holeLeg.id, patternIndex);
            }}
          >
            <sphereGeometry args={[hitRadius, 16, 10]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}

      {/* 3D Cotes d'atelier vers les arêtes les plus proches */}
      {showDimensions && profileData.legTransforms.slice(0, dimensions.bendCount + 1).map((legT) => (
        <React.Fragment key={`segment-dim-${legT.id}`}>
          <PlanarWingDimension leg={legT} state={dimensions} kind="length" onChange={onLegLengthChange ? value => onLegLengthChange(legT.index, value) : undefined} onEditing={onLegLengthEdit ? editing => onLegLengthEdit(legT.index, editing) : undefined} />
        </React.Fragment>
      ))}
      {showDimensions && profileData.legTransforms[0] && (
        <PlanarWingDimension leg={profileData.legTransforms[dimensions.bendCount]} state={dimensions} kind="width" onChange={onWidthChange} />
      )}

      {showDimensions && hoveredHoleKey && activeHoleInstances.map(({ holeLeg, dist, offset, index: patternIndex }) => {
        const legT = profileData.legTransforms.find(lt => lt.id === holeLeg.id);
        if (!legT) return null;
        const holeKey = `${holeLeg.id}-${patternIndex}`;
        if (holeKey !== hoveredHoleKey) return null;
        return (
          <React.Fragment key={`hole-dim-${holeLeg.id}-${patternIndex}`}>
            <HoleNearestEdgeDimensions
              holeLeg={{ ...holeLeg, holeDist: dist, holeOffset: offset }}
              legT={legT}
              dimensions={dimensions}
            />
          </React.Fragment>
        );
      })}

      {/* Target indicator in placement mode */}
      {placementMode && hoverPoint && (
        <group position={[hoverPoint.x - posX, hoverPoint.y - posY, hoverPoint.z - posZ]}>
          <mesh>
            <sphereGeometry args={[2.5, 16, 16]} />
            <meshBasicMaterial color="#6366f1" opacity={0.9} transparent depthTest={false} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[4, 5, 32]} />
            <meshBasicMaterial color="#818cf8" side={THREE.DoubleSide} opacity={0.8} transparent depthTest={false} />
          </mesh>
          <pointLight color="#818cf8" intensity={3} distance={30} />
        </group>
      )}

      {/* Point d'impact / Collision physique entre les tôles */}
      {profileData.collision.hasCollision && profileData.collision.collisionPoint && (
        <group position={[
          profileData.collision.collisionPoint.x, 
          profileData.collision.collisionPoint.y, 
          dimensions.width / 2
        ]}>
          <mesh>
            <sphereGeometry args={[Math.max(2.5, dimensions.thickness * 1.4), 16, 16]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={3} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[dimensions.thickness * 1.5, dimensions.thickness * 2.5, 32]} />
            <meshBasicMaterial color="#f87171" side={THREE.DoubleSide} transparent opacity={0.85} depthTest={false} />
          </mesh>
          <pointLight color="#ef4444" intensity={8} distance={80} />
        </group>
      )}
      </>}
    </group>
  );
});

function FlatMiniMapTracker({
  length, width, thickness, centerX, centerY, centerZ, onView,
}: { length: number; width: number; thickness: number; centerX: number; centerY: number; centerZ: number; onView: (points: [number, number][]) => void }) {
  const { camera, size } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), -(centerZ + thickness)), [centerZ, thickness]);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const corners = useMemo(() => [
    new THREE.Vector2(-1, -1), new THREE.Vector2(1, -1),
    new THREE.Vector2(1, 1), new THREE.Vector2(-1, 1),
  ], []);
  const last = useRef('');
  useFrame(() => {
    if (!size.width || !size.height) return;
    const polygon: [number, number][] = [];
    for (const corner of corners) {
      raycaster.setFromCamera(corner, camera);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return;
      polygon.push([
        ((hit.x - centerX + length / 2) / length) * 100,
        ((width / 2 - (hit.y - centerY)) / width) * 100,
      ]);
    }
    const signature = polygon.map(point => point.map(value => value.toFixed(1)).join(',')).join(';');
    if (signature !== last.current) { last.current = signature; onView(polygon); }
  });
  return null;
}

function FlatMiniMap({ length, width, view }: { length: number; width: number; view: [number, number][] }) {
  const points = view.map(([x, y]) => `${x},${y}`).join(' ');
  return <div className="absolute bottom-4 left-4 z-20 w-36 overflow-hidden rounded-lg border border-slate-300 bg-slate-950/80 p-2 shadow-xl backdrop-blur">
    <div className="mb-1 flex items-center justify-between text-[9px] font-semibold uppercase tracking-wide text-white/75"><span>Pièce entière</span><span>{Math.round(length)} × {Math.round(width)} mm</span></div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="block w-full rounded bg-slate-200" style={{ aspectRatio: `${length} / ${width}` }} aria-label="Repère de vue sur le développé">
      <rect x="0" y="0" width="100" height="100" fill="#d8dee7" />
      <rect x="0.5" y="0.5" width="99" height="99" fill="none" stroke="#526174" strokeWidth=".8" />
      {view.length > 2 && <polygon points={points} fill="rgba(232,60,105,.22)" stroke="#e83c69" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
    </svg>
  </div>;
}

export default function Viewer({ 
  temporaryDimension = null,
  dimensions, 
  profileData,
  activeBendIndex = 0,
  showActiveBendCue = false,
  activeLegIndex = 0,
  showActiveLegCue = false,
  cornerRadiusView = false,
  focusedCorner = null,
  realistic: initialRealistic = true, 
  grainDirection = 'length',
  embedded = false,
  placementMode = false,
  placementTargetLegId = null,
  placementStage = 'select-wing',
  placementHoleShape = 'round',
  placementHoleOrientation = 'along_length',
  placementHoleCornerRadius = 0,
  placementPatternChoice = null,
  placementPatternConfig = { mode: 'line', count: 4, margin: 15, rows: 2, columns: 2 },
  placementDraft = null,
  onHolePlacement,
  onPlacementHoleSizeChange,
  onPlacementCandidate,
  onPlacementWingSelect,
  onPlacementShapeSelect,
  onPlacementHoleOrientationChange,
  onPlacementHoleCornerRadiusChange,
  onPlacementPatternSelect,
  onPlacementPatternChange,
  onPlacementPatternConfirm,
  onHoleDeleteRequest,
  onHoleMoveRequest,
  onCancelPlacement,
  onLegLengthChange,
  onLegLengthEdit,
  onWidthChange,
}: ViewerProps) {
  const [realistic, setRealistic] = useState(initialRealistic);
  const [isOrthographic, setIsOrthographic] = useState(false);
  const [showDimensions, setShowDimensions] = useState(false);
  const [measureEnabled, setMeasureEnabled] = useState(false);
  const [touchPan, setTouchPan] = useState(false);
  const [showDimensionInfo, setShowDimensionInfo] = useState(false);
  const [cornerVisualPhase, setCornerVisualPhase] = useState<'bent' | 'unfolding' | 'flat' | 'folding'>('bent');
  const [placementVisualPhase, setPlacementVisualPhase] = useState<'bent' | 'unfolding' | 'flat' | 'folding'>('bent');
  const [cornerCameraTransitioning, setCornerCameraTransitioning] = useState(false);
  const [placementCameraTransitioning, setPlacementCameraTransitioning] = useState(false);
  const orbitControlsRef = useRef<any>(null);
  const [cameraRotation, setCameraRotation] = useState(0);
  const syncCameraRotation = () => {
    const controls = orbitControlsRef.current;
    if (controls) setCameraRotation(orbitAngle(controls.object.position, controls.target));
  };
  const rotateCamera = (degrees: number) => {
    const controls = orbitControlsRef.current;
    if (!controls) return;
    // Flush orbit inertia before setting an absolute angle from the slider.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.object.position.copy(orbitPositionAtAngle(controls.object.position, controls.target, degrees));
    controls.update();
    controls.enableDamping = damping;
    setCameraRotation(degrees);
  };
  const previousPerspectiveView = useRef<{ position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; zoom: number; fov?: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [flatViewBounds, setFlatViewBounds] = useState<[number, number][]>([]);
  // Zoom around the current target, without tilting the flat editing plane.
  const zoomPlacement = (factor: number) => {
    const controls = orbitControlsRef.current;
    if (!controls || placementCameraTransitioning) return;
    const camera = controls.object;
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 0.001, 200);
      camera.updateProjectionMatrix();
    } else {
      const offset = camera.position.clone().sub(controls.target);
      const distance = THREE.MathUtils.clamp(offset.length() / factor, 20, Math.max(800, sceneSpan * 5));
      camera.position.copy(controls.target).add(offset.setLength(distance));
    }
    controls.update();
  };
  const impact = useRef({ serial: 0, strength: 1 });
  const shake = useRef<Animation | null>(null);
  useEffect(() => () => shake.current?.cancel(), []);
  const handleImpact = (speed: number) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const strength = Math.min(2.8, Math.max(0.85, speed / 65));
    impact.current = { serial: impact.current.serial + 1, strength };
    shake.current?.cancel();
    shake.current = viewportRef.current?.animate([
      { transform: 'translate3d(0, 0, 0) rotate(0deg)' },
      { transform: `translate3d(${-3 * strength}px, ${6 * strength}px, 0) rotate(${-0.12 * strength}deg)` },
      { transform: `translate3d(${5 * strength}px, ${-4 * strength}px, 0) rotate(${0.16 * strength}deg)` },
      { transform: `translate3d(${-4 * strength}px, ${3 * strength}px, 0) rotate(${-0.1 * strength}deg)` },
      { transform: `translate3d(${2.5 * strength}px, ${-2 * strength}px, 0) rotate(${0.06 * strength}deg)` },
      { transform: `translate3d(${-1.2 * strength}px, ${strength}px, 0) rotate(${-0.025 * strength}deg)` },
      { transform: 'translate3d(0, 0, 0) rotate(0deg)' },
    ], { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' }) ?? null;
  };

  const selectedPlacementLeg = placementMode && placementTargetLegId
    ? dimensions.legs.find(leg => leg.id === placementTargetLegId)
    : null;
  const sceneSpan = selectedPlacementLeg
    ? Math.max(selectedPlacementLeg.length, dimensions.width)
    : Math.max(
      profileData.bounds.maxX - profileData.bounds.minX,
      profileData.bounds.maxY - profileData.bounds.minY,
      dimensions.width,
    );
  const liveUnfoldedLength = calculateUnfoldedLength(dimensions);
  const flatPlacementLength = dimensions.blankShape ? blankBendPlan(dimensions).frame.length : dimensions.legs.slice(0, dimensions.bendCount + 1).reduce((sum, leg) => sum + leg.length, 0);
  useEffect(() => {
    if (cornerRadiusView) {
      const start = window.setTimeout(() => setCornerVisualPhase('unfolding'), 220);
      const finish = window.setTimeout(() => setCornerVisualPhase('flat'), 1720);
      return () => { window.clearTimeout(start); window.clearTimeout(finish); };
    }
    if (cornerVisualPhase !== 'bent') {
      setCornerVisualPhase('folding');
      const finish = window.setTimeout(() => setCornerVisualPhase('bent'), 1500);
      return () => window.clearTimeout(finish);
    }
  }, [cornerRadiusView]);
  useEffect(() => {
    if (placementMode) {
      setPlacementVisualPhase('unfolding');
      const finish = window.setTimeout(() => setPlacementVisualPhase('flat'), 1500);
      return () => window.clearTimeout(finish);
    }
    setPlacementVisualPhase(current => current === 'bent' ? current : 'folding');
    const finish = window.setTimeout(() => setPlacementVisualPhase('bent'), 1500);
    return () => window.clearTimeout(finish);
  }, [placementMode]);
  const cornerSceneActive = cornerRadiusView || cornerVisualPhase !== 'bent';
  const placementSceneActive = placementMode || placementVisualPhase !== 'bent';
  const flatLightingView = placementSceneActive || cornerSceneActive;
  const floorY = -50;
  const contactX = useMemo(() => {
    const points = profileData.shape.getPoints(64);
    const lowest = points.reduce((a, b) => a.y < b.y ? a : b);
    return lowest.x + profileData.centerOffsetX;
  }, [profileData]);
  const profileSpanY = profileData.bounds.maxY - profileData.bounds.minY;
  // ContactShadows uses a fixed-size render plane. Scale it with the model's
  // footprint and depth range so large sheets don't get clipped or frozen at
  // the old 400 mm shadow texture bounds.
  const profileSpanX = profileData.bounds.maxX - profileData.bounds.minX;
  const contactShadowScaleX = Math.max(400, profileSpanX * 1.5);
  const contactShadowScaleZ = Math.max(400, dimensions.width * 1.5);
  const contactShadowFar = Math.max(100, profileSpanY + dimensions.thickness * 4);
  const restTiltX = 0;
  const restTiltZ = 0;
  const supportPoints = useMemo(() => profileData.pathPoints.flatMap((point) => ([
    new THREE.Vector3(point.x + profileData.centerOffsetX, point.y + profileData.centerOffsetY, -dimensions.width / 2),
    new THREE.Vector3(point.x + profileData.centerOffsetX, point.y + profileData.centerOffsetY, dimensions.width / 2),
  ])), [profileData, dimensions.width]);
  // Rest exactly on the floor; PhysicsDropGroup follows the changing support
  // point during its final angular settling so the mesh neither floats nor clips.
  const restY = floorY + (profileSpanY / 2);

  const handleRecenter = () => {
    setIsOrthographic(false);
    previousPerspectiveView.current = null;
    if (orbitControlsRef.current) {
      orbitControlsRef.current.reset();
      orbitControlsRef.current.target.set(0, restY, 0);
      orbitControlsRef.current.update();
    }
  };

  const handleIsometric = () => {
    if (isOrthographic) {
      const savedView = previousPerspectiveView.current;
      setIsOrthographic(false);
      if (orbitControlsRef.current) {
        const controls = orbitControlsRef.current;
        if (savedView) {
          controls.target.copy(savedView.target);
          controls.object.position.copy(savedView.position);
          controls.object.up.copy(savedView.up);
          if (controls.object instanceof THREE.PerspectiveCamera && savedView.fov !== undefined) {
            controls.object.fov = savedView.fov;
          }
          controls.object.zoom = savedView.zoom;
          controls.object.updateProjectionMatrix();
          controls.update();
        } else {
          controls.reset();
          controls.target.set(0, restY, 0);
          controls.update();
        }
      }
      previousPerspectiveView.current = null;
      return;
    }
    if (orbitControlsRef.current) {
      const controls = orbitControlsRef.current;
      previousPerspectiveView.current = {
        position: controls.object.position.clone(),
        target: controls.target.clone(),
        up: controls.object.up.clone(),
        zoom: controls.object.zoom,
        ...(controls.object instanceof THREE.PerspectiveCamera ? { fov: controls.object.fov } : {}),
      };
    }
    setIsOrthographic(true);
    if (orbitControlsRef.current) {
      orbitControlsRef.current.object.position.set(200, 200 + restY, 200);
      orbitControlsRef.current.target.set(0, restY, 0);
      orbitControlsRef.current.update();
    }
  };

  return (
    <div 
      ref={viewportRef}
      className="relative w-full h-full overflow-hidden select-none"
      style={{
        background: 'radial-gradient(ellipse 36% 42% at 50% 40%, rgba(255,255,255,.94) 0%, rgba(244,247,251,.76) 46%, transparent 80%), radial-gradient(ellipse 25% 32% at 23% 28%, rgba(255,255,255,.7), transparent 76%), radial-gradient(ellipse 25% 34% at 79% 24%, rgba(232,60,105,.07), transparent 76%), linear-gradient(180deg, #f8fafc 0%, #edf1f6 62%, #e5eaf1 100%)'
      }}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.08,
        }}
      >
        <ContextLossGuard />
        {(placementMode || cornerRadiusView) && <FlatMiniMapTracker
          length={flatPlacementLength}
          width={dimensions.width}
          thickness={Math.max(1, dimensions.thickness)}
          centerX={profileData.centerOffsetX}
          centerY={profileData.centerOffsetY}
          centerZ={-dimensions.width / 2}
          onView={setFlatViewBounds}
        />}
        <fog attach="fog" args={['#111720', Math.max(350, sceneSpan * 3), Math.max(1200, sceneSpan * 5)]} />

        {isOrthographic ? (
          <OrthographicCamera 
            makeDefault 
            zoom={2.5} 
            position={[200, 200, 200]} 
            near={-20000} 
            far={20000} 
          />
        ) : (
          <PerspectiveCamera 
            makeDefault 
            fov={45} 
            position={[180, 140, 220]} 
            near={10} 
            far={30000} 
          />
        )}

        <CornerRadiusCameraTransition active={cornerRadiusView} totalLength={flatPlacementLength} width={dimensions.width} focusedCorner={focusedCorner} focusReady={cornerVisualPhase === 'flat'} onTransitionStateChange={setCornerCameraTransitioning} />

        <AutoFrameModel
          profileData={profileData}
          width={dimensions.width}
          restY={restY}
          bendCount={dimensions.bendCount}
          orthographic={isOrthographic}
          placementMode={placementMode}
          placementTargetLegId={placementTargetLegId}
          cornerFocusKey={[
            dimensions.cornerRadius,
            dimensions.cornerRadii?.startLeft,
            dimensions.cornerRadii?.startRight,
            dimensions.cornerRadii?.endLeft,
            dimensions.cornerRadii?.endRight,
          ].join('|')}
          cornerRadiusView={cornerSceneActive}
        />

        <PlacementCameraTransition
          active={placementMode}
          totalLength={flatPlacementLength}
          width={dimensions.width}
          legs={dimensions.legs.slice(0, dimensions.bendCount + 1)}
          focusLegId={placementStage === 'position' || placementStage === 'configure-single' ? placementTargetLegId : null}
          onTransitionStateChange={setPlacementCameraTransitioning}
        />

        <ambientLight intensity={realistic ? 0.28 : 0.62} color="#b8c9e3" />
        <directionalLight 
          position={[140, 220, 120]} 
          intensity={realistic ? 2.15 : 1.45}
          castShadow 
          shadow-mapSize-width={2048} 
          shadow-mapSize-height={2048}
          shadow-bias={-0.0001}
        />
        <directionalLight position={[-180, 130, -120]} intensity={realistic ? 1.1 : 0.65} color="#9bbcff" />
        <directionalLight position={[40, 80, -220]} intensity={realistic ? 1.25 : 0.4} color="#f5f7ff" />
        {!flatLightingView && <directionalLight position={[0, 30, 220]} intensity={realistic ? 0.85 : 0.35} color="#e83c69" />}
        <spotLight
          position={[-sceneSpan * 0.62, sceneSpan * 1.05, sceneSpan * 0.72]}
          angle={Math.PI / 5.5}
          penumbra={0.78}
          intensity={realistic ? 3.2 : 2.5}
          distance={sceneSpan * 3.5}
          decay={0}
          color="#fff1dc"
        />
        <spotLight
          position={[sceneSpan * 0.72, sceneSpan * 0.58, -sceneSpan * 0.82]}
          angle={Math.PI / 4.5}
          penumbra={0.88}
          intensity={realistic ? 2.3 : 1.8}
          distance={sceneSpan * 3.5}
          decay={0}
          color="#a9c8ff"
        />

        {!placementSceneActive && !cornerSceneActive && <Grid
          infiniteGrid 
          cellSize={10} 
          sectionSize={50} 
          fadeDistance={280} 
          fadeStrength={1.2}
          sectionColor="#536174"
          cellColor="#263241"
          position={[0, -50, 0]} 
        />}

        {!placementSceneActive && !cornerSceneActive && <StudioFloorSpot
          centerX={(profileData.bounds.minX + profileData.bounds.maxX) / 2 + profileData.centerOffsetX}
          floorY={floorY}
          radius={Math.max(160, sceneSpan * 0.82)}
        />}

        {!placementSceneActive && !cornerSceneActive && <ContactShadows
          position={[0, -49.9, 0]} 
          opacity={0.72}
          scale={[contactShadowScaleX, contactShadowScaleZ]} 
          blur={2.25}
          far={contactShadowFar}
          frames={Infinity}
          resolution={sceneSpan > 1400 ? 1024 : 512}
          color="#05080d"
        />}

        {placementMode && placementVisualPhase !== 'flat' ? (
          <UnfoldingSheet dimensions={dimensions} restY={restY} unfolding realistic={realistic} />
        ) : !placementMode && placementVisualPhase === 'folding' ? (
          <UnfoldingSheet dimensions={dimensions} restY={restY} unfolding={false} realistic={realistic} />
        ) : placementMode || cornerVisualPhase === 'flat' ? (
          <FlatPlacementSheet
            dimensions={dimensions}
            realistic={realistic}
            stage={!placementMode ? 'preview' : placementStage}
            targetLegId={placementTargetLegId}
            holeShape={placementHoleShape}
            holeOrientation={placementHoleOrientation}
            holeCornerRadius={placementHoleCornerRadius}
            draft={placementDraft}
            patternConfig={placementPatternConfig}
            onWingSelect={onPlacementWingSelect}
            onCandidate={onPlacementCandidate}
            onDeleteHole={onHoleDeleteRequest}
            cornerRadiusPreview={!placementMode}
          />
        ) : cornerVisualPhase === 'unfolding' || cornerVisualPhase === 'folding' ? (
          <UnfoldingSheet dimensions={dimensions} restY={restY} unfolding={cornerVisualPhase === 'unfolding'} realistic={realistic} />
        ) : <PhysicsDropGroup
          onImpact={handleImpact}
          bendCount={dimensions.bendCount}
          restY={restY}
          floorY={floorY}
          supportPoints={supportPoints}
          restTiltX={restTiltX}
          restTiltZ={restTiltZ}
        >
          <SheetMetalGroup
            dimensions={dimensions}
            grainDirection={grainDirection}
            profileData={profileData}
            activeBendIndex={activeBendIndex}
            showActiveBendCue={showActiveBendCue}
            activeLegIndex={activeLegIndex}
            showActiveLegCue={showActiveLegCue}
            realistic={realistic}
            placementMode={placementMode}
            placementTargetLegId={placementTargetLegId}
            placementDraft={placementDraft}
            onHolePlacement={onHolePlacement}
            onPlacementCandidate={onPlacementCandidate}
            onPlacementWingSelect={onPlacementWingSelect}
            onHoleMoveRequest={onHoleMoveRequest}
            onLegLengthChange={onLegLengthChange}
            onLegLengthEdit={onLegLengthEdit}
            onWidthChange={onWidthChange}
            showDimensions={showDimensions || (!!temporaryDimension && !dimensions.blankShape && /longueur|largeur/i.test(temporaryDimension.label))}
            showDimensionInfo={showDimensionInfo}
          />
        </PhysicsDropGroup>}
        {!placementSceneActive && !cornerSceneActive && <ImpactDust impact={impact} width={dimensions.width} contactX={contactX} />}

        {realistic && (
          <Environment resolution={dimensions.finish === 'stainless-mirror' ? 1024 : 256} frames={1}>
            <group rotation={[-Math.PI / 3, 0, 1]}>
              <Lightformer form="rect" intensity={5} color="#ffffff" position={[10, 18, 10]} scale={[38, 16, 1]} />
              <Lightformer form="rect" intensity={3.1} color="#a9c8ff" position={[-24, 12, -16]} scale={[30, 12, 1]} />
              <Lightformer form="rect" intensity={2.4} color="#f8fafc" position={[0, -4, 24]} scale={[26, 8, 1]} />
              {!flatLightingView && <Lightformer form="rect" intensity={1.4} color="#e83c69" position={[20, 4, -22]} scale={[22, 5, 1]} />}
              <Lightformer form="circle" intensity={2} color="#ffffff" position={[0, 28, 0]} scale={20} />
              <Lightformer form="ring" intensity={1.4} color="#94a3b8" position={[0, -12, 8]} scale={14} />
            </group>
          </Environment>
        )}

        <OrbitControls 
          ref={orbitControlsRef} 
          onChange={syncCameraRotation}
          makeDefault 
          dampingFactor={0.05} 
          minDistance={20} 
          maxDistance={Math.max(800, sceneSpan * 5)}
          enableRotate={!placementSceneActive}
          screenSpacePanning={true}
          minZoom={0.001}
          maxZoom={200}
          touches={{ ONE: touchPan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
          enabled={(!placementSceneActive || (placementMode && placementVisualPhase === 'flat')) && !cornerCameraTransitioning && !placementCameraTransitioning}
        />
        <DepthPrecision sceneSpan={sceneSpan} />
        <MeasureTool enabled={measureEnabled && !placementSceneActive && !cornerSceneActive} resetKey={JSON.stringify(dimensions)} />
      </Canvas>
      {!placementSceneActive && !cornerRadiusView && <div className="mobile-gesture-control" role="group" aria-label="Geste à un doigt">
        <button type="button" aria-pressed={!touchPan} onClick={() => setTouchPan(false)}>Tourner</button>
        <button type="button" aria-pressed={touchPan} onClick={() => setTouchPan(true)}>Déplacer</button>
        <span>Pincez pour zoomer</span>
      </div>}
      {!placementSceneActive && !cornerRadiusView && <button type="button" className="measure-toggle" aria-pressed={measureEnabled} onClick={() => setMeasureEnabled(value => !value)}>
        <Ruler size={16} /> {measureEnabled ? 'Quitter la règle' : 'Règle'}
      </button>}
      {temporaryDimension && <div className="temporary-dimension-readout" role="status" aria-live="polite" aria-atomic="true">
        <span>{temporaryDimension.label}</span>
        <strong>{temporaryDimension.value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}<small>{temporaryDimension.unit}</small></strong>
      </div>}
      {!placementSceneActive && !cornerRadiusView && !embedded && <label className="camera-rotation-control">
        <span>Rotation <output>{cameraRotation}°</output></span>
        <input type="range" min={-180} max={180} step={1} value={cameraRotation}
          aria-label="Rotation horizontale de la caméra" aria-valuetext={`${cameraRotation} degrés`}
          onChange={event => rotateCamera(Number(event.target.value))} />
      </label>}

      {((placementMode && placementVisualPhase === 'flat') || (!placementMode && cornerRadiusView && cornerVisualPhase === 'flat')) &&
        <FlatMiniMap length={flatPlacementLength} width={dimensions.width} view={flatViewBounds} />}

      {placementMode && placementVisualPhase === 'flat' && <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1 rounded-lg border border-slate-300 bg-white/95 p-1 shadow-sm" role="group" aria-label="Zoom de placement">
        <button type="button" className="h-11 w-11 rounded text-2xl text-slate-700 hover:bg-slate-100" aria-label="Dézoomer" disabled={placementCameraTransitioning} onClick={() => zoomPlacement(1 / 1.5)}>−</button>
        <span className="px-1 text-xs text-slate-600">Zoom</span>
        <button type="button" className="h-11 w-11 rounded text-2xl text-slate-700 hover:bg-slate-100" aria-label="Zoomer" disabled={placementCameraTransitioning} onClick={() => zoomPlacement(1.5)}>+</button>
      </div>}

      {cornerRadiusView && focusedCorner && cornerVisualPhase === 'flat' && <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-[#e83c69]/40 bg-white/85 px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur-sm">Coin · ${{ startLeft: 'Début gauche', startRight: 'Début droit', endLeft: 'Fin gauche', endRight: 'Fin droit' }[focusedCorner]}</div>}

      {/* Standalone mode keeps the compact tool rail. Embedded product mode
          uses native select controls so the model remains the visual hero. */}
      {!embedded && <ViewerTools realistic={realistic} isOrthographic={isOrthographic}
        showDimensions={showDimensions} showDimensionInfo={showDimensionInfo}
        onRealistic={() => setRealistic(value => !value)} onRecenter={handleRecenter} onIsometric={handleIsometric}
        onDimensions={() => setShowDimensions(value => !value)} onDimensionInfo={() => setShowDimensionInfo(value => !value)} />}

      {embedded && (
        <div className="viewer-selectors absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-end gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-2 shadow-lg shadow-slate-300/35 backdrop-blur-md">
          <label className="viewer-selector">
            <span>Rendu</span>
            <select value={realistic ? 'realistic' : 'sketch'} onChange={(event) => setRealistic(event.target.value === 'realistic')}>
              <option value="realistic">Réaliste</option>
              <option value="sketch">Dessin</option>
            </select>
          </label>
          <label className="viewer-selector">
            <span>Vue</span>
            <select value={isOrthographic ? 'isometric' : 'perspective'} onChange={(event) => event.target.value === 'isometric' ? handleIsometric() : handleRecenter()}>
              <option value="perspective">Perspective</option>
              <option value="isometric">Isométrique</option>
            </select>
          </label>
          <label className="viewer-selector">
            <span>Cotations</span>
            <select value={showDimensions ? 'visible' : 'hidden'} onChange={(event) => setShowDimensions(event.target.value === 'visible')}>
              <option value="hidden">Masquées</option>
              <option value="visible">Visibles</option>
            </select>
          </label>
          <label className="viewer-selector">
            <span>Info</span>
            <select value={showDimensionInfo ? 'visible' : 'hidden'} onChange={(event) => setShowDimensionInfo(event.target.value === 'visible')}>
              <option value="hidden">Masquées</option>
              <option value="visible">Afficher</option>
            </select>
          </label>
        </div>
      )}

      {showDimensionInfo && (
        <div className="absolute bottom-16 left-5 z-20 min-w-[190px] rounded-xl border border-slate-200/90 bg-white/90 px-3 py-2.5 text-[10px] font-mono text-slate-600 shadow-lg shadow-slate-300/40 backdrop-blur-md pointer-events-none">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
            <Ruler size={12} /> Cotes des segments en direct
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span>Développé</span><strong className="text-right text-slate-900">{liveUnfoldedLength} mm</strong>
            <span>Largeur Z</span><strong className="text-right text-slate-900">{dimensions.width} mm</strong>
            <span>Épaisseur</span><strong className="text-right text-slate-900">{dimensions.thickness} mm</strong>
            {dimensions.legs.slice(0, dimensions.bendCount + 1).map((leg, index) => {
              const radii = getFlatCornerRadii(dimensions);
              const terminalRadius = index === 0
                ? Math.max(radii.startLeft, radii.startRight)
                : Math.max(radii.endLeft, radii.endRight);
              const cornerRadius = Math.min(
                terminalRadius,
                Math.max(0.5, dimensions.width / 2),
                Math.max(0.5, leg.length / 2),
              );
              const dimensionedLength = index === 0 || index === dimensions.bendCount
                ? Math.max(0, leg.length - cornerRadius)
                : leg.length;
              return (
                <React.Fragment key={`live-leg-${leg.id}`}>
                  <span>Aile {leg.id}</span><strong className="text-right text-slate-900">{dimensionedLength.toFixed(1)} mm</strong>
                </React.Fragment>
              );
            })}
          </div>
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] leading-tight text-slate-600">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">Verrouillage faisabilité</span>
              <strong className={profileData.collision.hasCollision ? 'text-rose-600' : 'text-pink-600'}>
                {profileData.collision.hasCollision ? 'À vérifier' : 'Actif'}
              </strong>
            </div>
            <div className="mt-0.5">Cotes bloquées aux capacités atelier.</div>
          </div>
        </div>
      )}

      {placementMode && <div className="viewer-mode-badge">Vue à plat · placement du trou</div>}

      {/* Alerte Visuelle Collision Métal */}
      {profileData.collision?.hasCollision && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-rose-950/95 border border-rose-500/70 text-rose-100 px-4 py-2.5 rounded-xl text-xs font-mono flex items-center gap-3 shadow-[0_0_30px_rgba(244,63,94,0.45)] backdrop-blur-md z-30 animate-pulse">
          <AlertTriangle className="text-rose-400 shrink-0" size={18} />
          <div>
            <div className="font-bold flex items-center gap-2">
              <span className="text-rose-200 uppercase tracking-wider">Collision physique détectée</span>
              <span className="text-[10px] bg-rose-900/90 px-1.5 py-0.5 rounded text-rose-300 font-mono">NON FABRICABLE</span>
            </div>
            <div className="text-[11px] text-rose-300/90 mt-0.5 font-sans">
              {profileData.collision.message}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
