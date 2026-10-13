import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { DoubleSide, Vector3, type Mesh, type MeshPhysicalMaterial } from 'three';
import { createFilmPeelGeometry, setProtectiveFilmSize, type FilmPeel } from './protectiveFilm';

/** Cosmetic interaction only. Dragging changes uniforms and a reusable vertex
 * buffer, never dimensions, CSG, project state or STEP export. */
export default function ProtectiveFilmCorner({ peel, material, interactive = true, coverage, removing = false }: {
  peel: FilmPeel; material: MeshPhysicalMaterial; interactive?: boolean;
  coverage?: RefObject<number>; removing?: boolean;
}) {
  const geometry = useMemo(() => createFilmPeelGeometry(peel), [peel]);
  const { gl, camera, controls, invalidate } = useThree();
  const motion = useRef({ current: peel.size, target: peel.size });
  const release = useRef<(() => void) | undefined>(undefined);
  const keyboardControl = useRef<HTMLButtonElement>(null);
  const flap = useRef<Mesh>(null);
  const plastic = useRef<MeshPhysicalMaterial>(null);
  useEffect(() => { if (!interactive) release.current?.(); }, [interactive]);

  useEffect(() => {
    motion.current = { current: peel.size, target: peel.size };
    return () => {
      release.current?.();
      setProtectiveFilmSize(material, peel.size);
      geometry.dispose();
    };
  }, [geometry, material, peel]);

  useFrame((_, delta) => {
    const m = motion.current;
    const visibleAmount = coverage?.current ?? 1;
    if (flap.current) flap.current.visible = visibleAmount > .005;
    if (plastic.current) plastic.current.opacity = .48 * visibleAmount;
    if (removing) m.target = visibleAmount > .005 ? peel.maxSize ?? peel.size : peel.size;
    const next = m.current + (m.target - m.current) * (1 - Math.exp(-12 * Math.min(delta, .05)));
    if (Math.abs(next - m.current) < .001 && Math.abs(m.target - m.current) < .01) return;
    m.current = Math.abs(m.target - next) < .01 ? m.target : next;
    if (keyboardControl.current) keyboardControl.current.dataset.peelSize = m.current.toFixed(2);
    createFilmPeelGeometry({ ...peel, size: m.current }, geometry);
    setProtectiveFilmSize(material, m.current);
    invalidate();
  });

  const beginDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!interactive || event.button !== 0 || release.current) return;
    event.stopPropagation();
    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();
    const origin = event.object.localToWorld(peel.origin.clone()).project(camera);
    const end = event.object.localToWorld(peel.origin.clone().addScaledVector(
      new Vector3().addVectors(peel.along, peel.across).normalize(), peel.size,
    )).project(camera);
    const dx = (end.x - origin.x) * rect.width / 2;
    const dy = -(end.y - origin.y) * rect.height / 2;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    const control = controls as unknown as { enabled: boolean } | undefined;
    const wasEnabled = control?.enabled;
    if (control) control.enabled = false;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture(event.pointerId);
    const startX = event.clientX, startY = event.clientY, startSize = motion.current.current;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const distance = ((next.clientX - startX) * dx + (next.clientY - startY) * dy) / length;
      motion.current.target = Math.max(peel.size, Math.min(peel.maxSize ?? peel.size, startSize + distance * peel.size / length));
      invalidate();
    };
    const finish = () => {
      motion.current.target = peel.size;
      if (control && wasEnabled !== undefined) control.enabled = wasEnabled;
      canvas.style.cursor = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('blur', finish);
      canvas.removeEventListener('lostpointercapture', finish);
      release.current = undefined;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      invalidate();
    };
    const endDrag = (next: PointerEvent) => { if (next.pointerId === event.pointerId) finish(); };
    release.current = finish;
    if (keyboardControl.current) keyboardControl.current.dataset.dragCount = String(Number(keyboardControl.current.dataset.dragCount || 0) + 1);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', finish);
    canvas.addEventListener('lostpointercapture', finish);
  };

  return <>
    <mesh ref={flap} geometry={geometry}
      raycast={interactive ? undefined : () => {}}
      onPointerDown={beginDrag}
      onPointerOver={() => { if (interactive && !release.current) gl.domElement.style.cursor = 'grab'; }}
      onPointerOut={() => { if (!release.current) gl.domElement.style.cursor = ''; }}>
      <meshPhysicalMaterial ref={plastic} color="#489be5" metalness={0} roughness={.2} clearcoat={.8} clearcoatRoughness={.2}
        transparent opacity={.48} depthWrite={false} side={DoubleSide} />
    </mesh>
    {interactive && <Html position={peel.origin} zIndexRange={[10, 0]}>
      <button ref={keyboardControl} data-peel-size={peel.size.toFixed(2)} type="button" className="film-keyboard-control" aria-label="Décoller le film : maintenir Espace ou Entrée"
        onKeyDown={event => {
          if (event.key !== ' ' && event.key !== 'Enter') return;
          event.preventDefault();
          motion.current.target = peel.maxSize ?? peel.size;
          invalidate();
        }}
        onKeyUp={() => { motion.current.target = peel.size; invalidate(); }}
        onBlur={() => { motion.current.target = peel.size; invalidate(); }}>
        Décoller le film
      </button>
    </Html>}
  </>;
}
