import { perspectiveDepthRange } from './depthRange';
import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { orbitPositionAtAngle } from './rotation';
import type { LegConfig, FlatCornerRadii, ProfileGeometryData } from '../../sheetGeometry';

// Camera-only responsibilities: framing, flat editing transitions and restoring
// the previous orbit. These components must stay inside the R3F Canvas context.
export function PlacementCameraTransition({ active, totalLength, width, legs, focusLegId, onTransitionStateChange }: {
  active: boolean; totalLength: number; width: number; legs: LegConfig[]; focusLegId: string | null;
  onTransitionStateChange: (transitioning: boolean) => void;
}) {
  const { camera, size } = useThree();
  const controls = useThree((state) => state.controls as any);
  const savedView = useRef<{ position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; zoom: number; controlsEnabled: boolean } | null>(null);
  const transition = useRef<{ from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromUp: THREE.Vector3; toUp: THREE.Vector3; fromZoom: number; toZoom: number; elapsed: number } | null>(null);
  const interpolatedTarget = useMemo(() => new THREE.Vector3(), []);
  const lastKey = useRef('');
  useEffect(() => {
    if (!active) {
      if (!savedView.current || lastKey.current === 'restore') return;
      const saved = savedView.current;
      lastKey.current = 'restore';
      onTransitionStateChange(true);
      if (controls) controls.enabled = false;
      transition.current = {
        from: camera.position.clone(), to: saved.position.clone(),
        fromTarget: controls?.target?.clone() || new THREE.Vector3(), toTarget: saved.target.clone(),
        fromUp: camera.up.clone(), toUp: saved.up.clone(),
        fromZoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1, toZoom: saved.zoom,
        elapsed: 0,
      };
      return;
    }

    if (!savedView.current) {
      const target = controls?.target?.clone() || new THREE.Vector3();
      savedView.current = {
        position: camera.position.clone(), target, up: camera.up.clone(),
        zoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1,
        controlsEnabled: controls?.enabled ?? true,
      };
    }
    const aspect = Math.max(0.35, size.width / Math.max(1, size.height));
    let centerX = 0;
    let viewLength = totalLength;
    if (focusLegId) {
      let start = -totalLength / 2;
      for (const leg of legs) {
        if (leg.id === focusLegId) { centerX = start + leg.length / 2; viewLength = leg.length; break; }
        start += leg.length;
      }
      viewLength = Math.max(viewLength, width);
    }
    const halfHeight = focusLegId
      ? Math.max(width / 2, viewLength / (2 * aspect)) * 1.35
      : Math.max(width / 2, totalLength / (2 * aspect));
    const nextTarget = new THREE.Vector3(centerX, 0, 0);
    const key = `${focusLegId || 'all'}:${totalLength}:${width}:${size.width}:${size.height}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    let nextPosition: THREE.Vector3;
    let nextZoom = camera instanceof THREE.OrthographicCamera ? camera.zoom : 1;
    if (camera instanceof THREE.PerspectiveCamera) {
      const distance = Math.max(120, halfHeight / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.18);
      nextPosition = new THREE.Vector3(centerX, 0, distance);
    } else {
      nextZoom = size.height / Math.max(1, halfHeight * 2);
      nextPosition = new THREE.Vector3(centerX, 0, Math.max(120, totalLength));
    }
    onTransitionStateChange(true);
    if (controls) controls.enabled = false;
    transition.current = {
      from: camera.position.clone(), to: nextPosition,
      fromTarget: controls?.target?.clone() || new THREE.Vector3(), toTarget: nextTarget,
      fromUp: camera.up.clone(), toUp: new THREE.Vector3(0, 1, 0),
      fromZoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1, toZoom: nextZoom,
      elapsed: 0,
    };
    if (camera instanceof THREE.PerspectiveCamera) {
      Object.assign(camera, perspectiveDepthRange(nextPosition.distanceTo(nextTarget), Math.max(totalLength, width)));
    }
    camera.updateProjectionMatrix();
  }, [active, camera, controls, size.width, size.height, totalLength, width, focusLegId, legs, onTransitionStateChange]);
  useFrame((_, delta) => {
    const active = transition.current;
    if (!active) return;
    active.elapsed = Math.min(1, active.elapsed + delta / 0.75);
    const eased = active.elapsed * active.elapsed * (3 - 2 * active.elapsed);
    const target = interpolatedTarget.copy(active.fromTarget).lerp(active.toTarget, eased);
    camera.position.lerpVectors(active.from, active.to, eased);
    camera.up.lerpVectors(active.fromUp, active.toUp, eased).normalize();
    if (controls?.target) controls.target.copy(target);
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = THREE.MathUtils.lerp(active.fromZoom, active.toZoom, eased);
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target);
    controls?.update();
    if (active.elapsed >= 1) {
      transition.current = null;
      if (lastKey.current === 'restore') {
        const saved = savedView.current;
        if (controls && saved) controls.enabled = saved.controlsEnabled;
        savedView.current = null;
        lastKey.current = '';
      }
      onTransitionStateChange(false);
    }
  });
  return null;
}

export function CornerRadiusCameraTransition({ active, totalLength, width, focusedCorner, focusReady, onTransitionStateChange }: {
  active: boolean; totalLength: number; width: number;
  focusedCorner: keyof FlatCornerRadii | null; focusReady: boolean;
  onTransitionStateChange: (transitioning: boolean) => void;
}) {
  const { camera, size } = useThree();
  const controls = useThree((state) => state.controls as any);
  const savedView = useRef<{ position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; zoom: number; controlsEnabled: boolean } | null>(null);
  const flatView = useRef<{ position: THREE.Vector3; target: THREE.Vector3; zoom: number } | null>(null);
  const lastCorner = useRef<keyof FlatCornerRadii | 'all'>('all');
  const pendingCornerFocus = useRef<{ position: THREE.Vector3; target: THREE.Vector3; zoom: number } | null>(null);
  const transition = useRef<{ elapsed: number; delay: number; duration: number; fromPosition: THREE.Vector3; toPosition: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromUp: THREE.Vector3; toUp: THREE.Vector3; fromZoom: number; toZoom: number } | null>(null);
  const interpolatedTarget = useMemo(() => new THREE.Vector3(), []);
  const interpolatedPosition = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (active && !savedView.current) {
      const target = controls?.target?.clone() || new THREE.Vector3();
      savedView.current = {
        position: camera.position.clone(), target,
        up: camera.up.clone(), zoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1,
        controlsEnabled: controls?.enabled ?? true,
      };
      const aspect = Math.max(0.35, size.width / Math.max(1, size.height));
      const flatTarget = new THREE.Vector3(0, 0, 0);
      let distance = 900;
      let zoom = 1;
      if (camera instanceof THREE.PerspectiveCamera) {
        const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        distance = Math.max(width / 2 / tanVertical, totalLength / 2 / (tanVertical * aspect)) * 1.28;
      } else {
        const visibleHeight = Math.max(width, totalLength / aspect) * 1.28;
        zoom = size.height / visibleHeight;
      }
      const toPosition = new THREE.Vector3(0, 0, distance);
      flatView.current = { position: toPosition.clone(), target: flatTarget.clone(), zoom };
      lastCorner.current = 'all';
      onTransitionStateChange(true);
      if (controls) controls.enabled = false;
      transition.current = {
        elapsed: 0, delay: 0.22, duration: 1.5, fromPosition: camera.position.clone(), toPosition,
        fromTarget: target, toTarget: flatTarget,
        fromUp: camera.up.clone(), toUp: new THREE.Vector3(0, 1, 0),
        fromZoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1, toZoom: zoom,
      };
    } else if (!active && savedView.current) {
      const saved = savedView.current;
      pendingCornerFocus.current = null;
      onTransitionStateChange(true);
      if (controls) controls.enabled = false;
      transition.current = {
        elapsed: 0, delay: 0, duration: 1.5, fromPosition: camera.position.clone(), toPosition: saved.position.clone(),
        fromTarget: controls?.target?.clone() || new THREE.Vector3(), toTarget: saved.target.clone(),
        fromUp: camera.up.clone(), toUp: saved.up.clone(),
        fromZoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1, toZoom: saved.zoom,
      };
    }
  }, [active, camera, controls, onTransitionStateChange, size.height, size.width, totalLength, width]);

  useEffect(() => {
    if (!active || !focusReady || !flatView.current) return;
    const nextCorner = focusedCorner ?? 'all';
    if (lastCorner.current === nextCorner) return;
    const previousCorner = lastCorner.current;
    lastCorner.current = nextCorner;
    pendingCornerFocus.current = null;

    let target = flatView.current.target.clone();
    let position = flatView.current.position.clone();
    let zoom = flatView.current.zoom;
    if (focusedCorner) {
      const shortSide = Math.max(1, Math.min(totalLength, width));
      const span = Math.max(35, Math.min(shortSide * 0.8, 180));
      const xSign = focusedCorner.startsWith('start') ? -1 : 1;
      const ySign = focusedCorner.endsWith('Left') ? -1 : 1;
      target = new THREE.Vector3(
        xSign * (totalLength / 2 - Math.min(span * 0.25, totalLength * 0.2)),
        ySign * (width / 2 - Math.min(span * 0.25, width * 0.2)),
        0,
      );
      const aspect = Math.max(0.35, size.width / Math.max(1, size.height));
      if (camera instanceof THREE.PerspectiveCamera) {
        const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        const distance = Math.max(span / (2 * tanVertical), span / (2 * tanVertical * aspect)) * 1.45;
        position = target.clone().add(new THREE.Vector3(0, 0, distance));
      } else {
        zoom = size.height / (Math.max(span, span / aspect) * 1.45);
        position = target.clone().add(new THREE.Vector3(0, 0, Math.max(120, span * 2)));
      }
    }
    const changingCorners = focusedCorner && previousCorner !== 'all';
    if (changingCorners) pendingCornerFocus.current = { position, target, zoom };
    onTransitionStateChange(true);
    transition.current = {
      elapsed: 0, delay: 0, duration: changingCorners ? 0.85 : 1.05,
      fromPosition: camera.position.clone(), toPosition: changingCorners ? flatView.current.position.clone() : position,
      fromTarget: controls?.target?.clone() || new THREE.Vector3(), toTarget: changingCorners ? flatView.current.target.clone() : target,
      fromUp: camera.up.clone(), toUp: new THREE.Vector3(0, 1, 0),
      fromZoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1, toZoom: changingCorners ? flatView.current.zoom : zoom,
    };
  }, [active, focusReady, focusedCorner, camera, controls, onTransitionStateChange, size.height, size.width, totalLength, width]);

  useFrame((_, delta) => {
    const tween = transition.current;
    if (!tween) return;
    tween.elapsed = Math.min(tween.delay + tween.duration, tween.elapsed + delta);
    const t = Math.max(0, Math.min(1, (tween.elapsed - tween.delay) / tween.duration));
    const eased = t * t * (3 - 2 * t);
    const target = interpolatedTarget.copy(tween.fromTarget).lerp(tween.toTarget, eased);
    const position = interpolatedPosition.copy(tween.fromPosition).lerp(tween.toPosition, eased);
    // Give the changing silhouette room while the sheet and camera rotate.
    // Both endpoints keep their exact saved framing.
    const transitDistance = 1 + (tween.duration > 1.2 ? 0.8 : 0.08) * Math.sin(Math.PI * eased);
    camera.position.copy(target).add(position.sub(target).multiplyScalar(transitDistance));
    camera.up.lerpVectors(tween.fromUp, tween.toUp, eased).normalize();
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = THREE.MathUtils.lerp(tween.fromZoom, tween.toZoom, eased);
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target);
    if (controls) {
      controls.target.copy(target);
      controls.update?.();
    }
    if (t >= 1) {
      const pending = active ? pendingCornerFocus.current : null;
      pendingCornerFocus.current = null;
      transition.current = pending ? {
        elapsed: 0, delay: 0, duration: 0.95,
        fromPosition: camera.position.clone(), toPosition: pending.position,
        fromTarget: target.clone(), toTarget: pending.target,
        fromUp: camera.up.clone(), toUp: new THREE.Vector3(0, 1, 0),
        fromZoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : 1, toZoom: pending.zoom,
      } : null;
      if (!pending) onTransitionStateChange(false);
      if (!active && savedView.current && controls) controls.enabled = savedView.current.controlsEnabled;
      if (!active) { savedView.current = null; flatView.current = null; }
    }
  });
  return null;
}

export function AutoFrameModel({
  profileData,
  width,
  restY,
  bendCount,
  orthographic,
  placementMode,
  placementTargetLegId,
  cornerFocusKey,
  cornerRadiusView,
}: {
  profileData: ProfileGeometryData;
  width: number;
  restY: number;
  bendCount: number;
  orthographic: boolean;
  placementMode: boolean;
  placementTargetLegId: string | null;
  cornerFocusKey: string;
  cornerRadiusView: boolean;
}) {
  const { camera, size } = useThree();
  const controls = useThree((state) => state.controls as any);
  const wasInCornerRadiusView = useRef(false);
  const wasInPlacementMode = useRef(false);

  useEffect(() => {
    if (placementMode) {
      wasInPlacementMode.current = true;
      return;
    }
    if (wasInPlacementMode.current) {
      wasInPlacementMode.current = false;
      return;
    }
    if (cornerRadiusView) {
      wasInCornerRadiusView.current = true;
      return;
    }
    if (wasInCornerRadiusView.current) {
      wasInCornerRadiusView.current = false;
      return;
    }
    const spanX = Math.max(1, profileData.bounds.maxX - profileData.bounds.minX);
    const spanY = Math.max(1, profileData.bounds.maxY - profileData.bounds.minY);
    const selectedLeg = placementMode && placementTargetLegId
      ? profileData.legTransforms.find(item => item.id === placementTargetLegId)
      : null;
    const focus = selectedLeg
      ? new THREE.Vector3(
        selectedLeg.center.x + profileData.centerOffsetX,
        selectedLeg.center.y + profileData.centerOffsetY + restY,
        0,
      )
      : new THREE.Vector3(0, restY, 0);
    const modelSpan = selectedLeg
      ? Math.max(selectedLeg.length, width)
      : Math.max(spanX, spanY, width);
    const aspect = Math.max(0.35, size.width / Math.max(1, size.height));
    // Opening azimuth matches the rotation slider, while preserving elevation.
    const direction = selectedLeg
      ? new THREE.Vector3(
        selectedLeg.normal.x * 1.55 + selectedLeg.direction.x * 0.28,
        selectedLeg.normal.y * 1.55 + selectedLeg.direction.y * 0.28,
        1.2,
      ).normalize()
      : bendCount === 0
        // A flat sheet lies in the XZ plane. Raise the camera enough to read
        // its full outline while retaining a little perspective on thickness.
        ? orbitPositionAtAngle(new THREE.Vector3(0.48, 1.8, 0.72), new THREE.Vector3(), -40).normalize()
        : orbitPositionAtAngle(new THREE.Vector3(1.45, 0.85, 1.05), new THREE.Vector3(), -40).normalize();

    const frameCorners: THREE.Vector3[] = [];
    const zNear = -width / 2;
    const zFar = width / 2;
    if (selectedLeg) {
      for (const point of [selectedLeg.tip, selectedLeg.bendStart]) {
        frameCorners.push(
          new THREE.Vector3(point.x + profileData.centerOffsetX, point.y + profileData.centerOffsetY + restY, zNear),
          new THREE.Vector3(point.x + profileData.centerOffsetX, point.y + profileData.centerOffsetY + restY, zFar),
        );
      }
    } else {
      for (const x of [profileData.bounds.minX, profileData.bounds.maxX]) {
        for (const y of [profileData.bounds.minY, profileData.bounds.maxY]) {
          frameCorners.push(
            new THREE.Vector3(x + profileData.centerOffsetX, y + profileData.centerOffsetY + restY, zNear),
            new THREE.Vector3(x + profileData.centerOffsetX, y + profileData.centerOffsetY + restY, zFar),
          );
        }
      }
    }

    // Fit the projected 3D silhouette (not only its longest world axis). This
    // leaves room for long diagonal profiles and tall narrow wings on phones.
    const viewDirection = direction.clone().negate();
    const screenRight = new THREE.Vector3().crossVectors(viewDirection, new THREE.Vector3(0, 1, 0)).normalize();
    const screenUp = new THREE.Vector3().crossVectors(screenRight, viewDirection).normalize();
    let halfWidth = 1;
    let halfHeight = 1;
    let nearDepth = 0;
    frameCorners.forEach(corner => {
      const relative = corner.sub(focus);
      halfWidth = Math.max(halfWidth, Math.abs(relative.dot(screenRight)));
      halfHeight = Math.max(halfHeight, Math.abs(relative.dot(screenUp)));
      nearDepth = Math.max(nearDepth, relative.dot(direction));
    });

    if (orthographic && camera instanceof THREE.OrthographicCamera) {
      const visibleHeight = 2 * Math.max(halfHeight, halfWidth / aspect) * 1.06;
      camera.zoom = Math.max(0.08, Math.min(8, size.height / visibleHeight));
      camera.position.copy(focus.clone().add(direction.clone().multiplyScalar(Math.max(modelSpan * 1.5, 250))));
    } else if (!orthographic && camera instanceof THREE.PerspectiveCamera) {
      const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const tanHorizontal = tanVertical * aspect;
      const projectedFit = Math.max(halfHeight / tanVertical, halfWidth / tanHorizontal);
      const distance = Math.max(45, (nearDepth + projectedFit) * 1.06);
      camera.position.copy(focus.clone().add(direction.clone().multiplyScalar(distance)));
    }

    camera.lookAt(focus);
    if (controls) {
      // Let the automatic framing dolly back for large sheet sizes. The old
      // fixed 800 mm OrbitControls limit clamped the camera after it was fit.
      controls.maxDistance = Math.max(800, modelSpan * 5);
      controls.target.copy(focus);
      controls.saveState?.();
      controls.update?.();
    }
    camera.updateProjectionMatrix();
  }, [camera, controls, size.width, size.height, profileData.bounds.maxX, profileData.bounds.minX, profileData.bounds.maxY, profileData.bounds.minY, profileData.legTransforms, profileData.centerOffsetX, profileData.centerOffsetY, width, restY, bendCount, orthographic, placementMode, placementTargetLegId, cornerFocusKey, cornerRadiusView]);

  return null;
}
