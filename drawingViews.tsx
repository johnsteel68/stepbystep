import React, { Suspense, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { orbitPositionAtAngle } from './viewer/camera/rotation';
import { SheetMetalGroup } from './Viewer';
import { generateSheetProfile } from './sheetGeometry';
import type { SheetMetalState } from './sheetGeometry';
import type { DrawingView, DrawingViews, GrainDirection } from './technicalDrawing';

type ViewName = keyof DrawingViews;
const WIDTH = 1600, HEIGHT = 900;

/** Dedicated export scene: no viewport crop, physics, badges or selection.
 * It reuses the viewer's final CSG mesh and PBR face assignments. */
function Capture({ state, grainDirection, onDone, onError }: {
  state: SheetMetalState; grainDirection: GrainDirection; onDone: (views: DrawingViews) => void; onError: (error: Error) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const frames = useRef(0);
  const { gl, scene } = useThree();
  const profile = React.useMemo(() => generateSheetProfile(state), [state]);
  useFrame(() => {
    if (++frames.current !== 4 || !group.current) return;
    const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT);
    const oldTarget = gl.getRenderTarget();
    const oldBackground = scene.background;
    const oldOverride = scene.overrideMaterial;
    const normals = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    try {
      scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      group.current.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !object.geometry.getAttribute('position')?.count) return;
        let ancestor: THREE.Object3D | null = object;
        while (ancestor) { if (!ancestor.visible) return; ancestor = ancestor.parent; }
        meshes.push(object);
      });
      // CSG keeps hidden cutter brushes under the final mesh. Those are not
      // part of the manufactured solid and must not affect outlines or sizes.
      const box = new THREE.Box3();
      meshes.forEach(mesh => {
        mesh.geometry.computeBoundingBox();
        box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
      });
      if (box.isEmpty()) throw new Error('La pièce ne contient pas de géométrie à dessiner.');
      const center = box.getCenter(new THREE.Vector3());
      const span = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 1);
      const corners = [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z =>
        new THREE.Vector3(x ? box.max.x : box.min.x, y ? box.max.y : box.min.y, z ? box.max.z : box.min.z))));
      const render = (name: ViewName, direction: THREE.Vector3, up: THREE.Vector3, textured: boolean): DrawingView => {
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, span * 0.01, span * 8);
        camera.position.copy(center).addScaledVector(direction.normalize(), span * 3);
        camera.up.copy(up); camera.lookAt(center); camera.updateMatrixWorld(true);
        const local = name === 'isometric' ? meshes.flatMap(mesh => {
          const positions = mesh.geometry.getAttribute('position');
          const matrix = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
          return Array.from({ length: positions.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix));
        }) : corners.map(p => p.clone().applyMatrix4(camera.matrixWorldInverse));
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of local) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
        const widthMm = maxX - minX;
        const heightMm = maxY - minY;
        const viewH = Math.max(heightMm, widthMm / (WIDTH / HEIGHT), 1) * 1.24;
        const viewW = viewH * WIDTH / HEIGHT;
        const cx = (maxX + minX) / 2, cy = (maxY + minY) / 2;
        camera.left = cx - viewW / 2; camera.right = cx + viewW / 2;
        camera.top = cy + viewH / 2; camera.bottom = cy - viewH / 2; camera.updateProjectionMatrix();
        scene.background = new THREE.Color('#ffffff');
        // Screen-space normal discontinuities produce visible outlines without
        // exposing the coplanar T-junction triangulation introduced by CSG.
        scene.overrideMaterial = textured ? null : normals;
        gl.setRenderTarget(target); gl.clear(); gl.render(scene, camera);
        const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
        gl.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
        if (!textured) {
          const outline = new Uint8Array(pixels.length).fill(255);
          for (let y = 1; y < HEIGHT - 1; y++) for (let x = 1; x < WIDTH - 1; x++) {
            const i = (y * WIDTH + x) * 4;
            let edge = false;
            for (const j of [i + 4, i + WIDTH * 4]) for (let c = 0; c < 3; c++) {
              if (Math.abs(pixels[i + c] - pixels[j + c]) > 28) edge = true;
            }
            if (edge) for (const j of [i, i + 4]) {
              outline[j] = 32; outline[j + 1] = 41; outline[j + 2] = 53;
            }
          }
          pixels.set(outline);
        }
        const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Impossible de créer les images du plan.');
        const output = ctx.createImageData(WIDTH, HEIGHT);
        for (let row = 0; row < HEIGHT; row++) output.data.set(
          pixels.subarray((HEIGHT - 1 - row) * WIDTH * 4, (HEIGHT - row) * WIDTH * 4), row * WIDTH * 4);
        ctx.putImageData(output, 0, 0);
        const faceMarkers: NonNullable<DrawingView['faceMarkers']> = [];
        if (textured) for (const leg of profile.legTransforms) {
          const centerPoint = new THREE.Vector3(leg.center.x + profile.centerOffsetX, leg.center.y + profile.centerOffsetY, 0);
          const normal = new THREE.Vector3(leg.normal.x, leg.normal.y, 0);
          const face = normal.dot(camera.position.clone().sub(centerPoint)) > 0 ? 'F1' : 'F2';
          if (faceMarkers.some(marker => marker.face === face)) continue;
          const ray = new THREE.Raycaster();
          let point: THREE.Vector3 | undefined;
          for (const along of [0, .22, -.22]) for (const across of [0, .22, -.22]) {
            if (point) continue;
            const candidate = centerPoint.clone().addScaledVector(normal, (face === 'F1' ? 1 : -1) * state.thickness / 2)
              .add(new THREE.Vector3(leg.direction.x * leg.length * along, leg.direction.y * leg.length * along, state.width * across));
            ray.set(camera.position, candidate.clone().sub(camera.position).normalize());
            const hit = ray.intersectObjects(meshes, false)[0];
            if (hit && hit.point.distanceTo(candidate) < 0.1) point = candidate;
          }
          if (!point) continue;
          const end = point.clone().addScaledVector(grainDirection === 'width' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(leg.direction.x, leg.direction.y, 0),
            Math.min(leg.length, state.width) * 0.22);
          const p = point.project(camera), e = end.project(camera);
          faceMarkers.push({ face, wing: leg.id, x: (p.x + 1) / 2, y: (1 - p.y) / 2,
            grainEnd: { x: (e.x + 1) / 2, y: (1 - e.y) / 2 } });
        }
        return { image: canvas.toDataURL('image/png'), widthMm, heightMm, faceMarkers,
          frame: { x: (1 - widthMm / viewW) / 2, y: (1 - heightMm / viewH) / 2, width: widthMm / viewW, height: heightMm / viewH } };
      };
      const views: DrawingViews = {
        front: render('front', new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), false),
        top: render('top', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), false),
        right: render('right', new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), false),
        // Match the viewer's −40° ground-plane azimuth; retain camera elevation
        // and automatic framing. Orthographic technical views stay unchanged.
        isometric: render('isometric', orbitPositionAtAngle(new THREE.Vector3(1, 1, 1), new THREE.Vector3(), -40), new THREE.Vector3(0, 1, 0), true),
      };
      onDone(views);
    } catch (error) { onError(error instanceof Error ? error : new Error(String(error))); }
    finally {
      gl.setRenderTarget(oldTarget); scene.background = oldBackground; scene.overrideMaterial = oldOverride;
      normals.dispose(); target.dispose();
    }
  });
  return <>
    <ambientLight intensity={0.9} />
    <directionalLight position={[140, 220, 120]} intensity={2.15} />
    <directionalLight position={[-180, 130, -120]} intensity={1.1} color="#d9e3f5" />
    <directionalLight position={[40, 80, -220]} intensity={1.25} />
    <Environment resolution={state.finish === 'stainless-mirror' ? 1024 : 128} frames={1}>
      <color attach="background" args={['#c3cbd5']} />
      <Lightformer form="rect" intensity={5} position={[10, 18, 10]} scale={[38, 16, 1]} />
      <Lightformer form="rect" intensity={3} position={[-24, 12, -16]} scale={[30, 12, 1]} />
      <Lightformer form="rect" intensity={2} position={[0, -4, 24]} scale={[26, 8, 1]} />
    </Environment>
    <group ref={group}>
      <SheetMetalGroup dimensions={state} profileData={profile} realistic exportOnly exportGrainDirection={grainDirection} showDimensions={false} />
    </group>
  </>;
}

class CaptureBoundary extends React.Component<{ children: React.ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function captureDrawingViews(state: SheetMetalState, grainDirection: GrainDirection = 'length'): Promise<DrawingViews> {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '900px', height: '600px', pointerEvents: 'none' });
    host.setAttribute('aria-hidden', 'true'); document.body.append(host);
    const root = createRoot(host); let completed = false;
    const finish = (views?: DrawingViews, error?: Error) => {
      if (completed) return; completed = true; clearTimeout(timeout);
      // Defer unmount until React/R3F has finished its current frame.
      setTimeout(() => { root.unmount(); host.remove(); }, 0);
      if (error) reject(error); else resolve(views!);
    };
    const timeout = setTimeout(() => finish(undefined, new Error('Le rendu du plan a pris trop de temps. Réessayez.')), 30000);
    root.render(<CaptureBoundary onError={error => finish(undefined, error)}>
      <Canvas dpr={1} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
        onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', () => finish(undefined, new Error('Le contexte 3D du plan a été perdu.')), { once: true })}>
        <Suspense fallback={null}><Capture state={structuredClone(state)} grainDirection={grainDirection} onDone={views => finish(views)} onError={error => finish(undefined, error)} /></Suspense>
      </Canvas>
    </CaptureBoundary>);
  });
}
