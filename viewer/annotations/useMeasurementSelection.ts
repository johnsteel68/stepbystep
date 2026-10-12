import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import type { MeasureFeature } from './measurementGeometry';
import { createMeasurementPicker } from './measurementPicking';

const CLICK_MOVEMENT_TOLERANCE_PX = 5;

/** Les interactions et leur nettoyage sont séparés du rendu des annotations.
 * Un mouvement de caméra ne doit jamais sélectionner un repère de mesure. */
export function useMeasurementSelection(enabled: boolean, resetKey: string) {
  const { camera, gl, scene } = useThree();
  const [selected, setSelected] = useState<MeasureFeature[]>([]);
  const [hover, setHover] = useState<MeasureFeature | null>(null);

  useEffect(() => {
    setSelected([]);
    setHover(null);
  }, [enabled, resetKey]);

  useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    const pickFeature = createMeasurementPicker(canvas, camera, scene);
    let pointerDown = { x: 0, y: 0 };

    const begin = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      const candidate = pickFeature(event);
      setHover(previous => previous?.id === candidate?.id ? previous : candidate);
    };
    const leave = () => setHover(null);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelected([]);
      setHover(null);
    };
    const pick = (event: MouseEvent) => {
      const movement = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      if (movement > CLICK_MOVEMENT_TOLERANCE_PX) return;
      event.stopImmediatePropagation();
      const feature = pickFeature(event);
      if (!feature) return;

      setSelected(current => {
        // Le troisième clic commence une nouvelle mesure ; un double clic sur
        // le premier repère ne doit pas produire une mesure nulle involontaire.
        if (current.length !== 1) return [feature];
        return current[0].id === feature.id ? current : [current[0], feature];
      });
    };

    canvas.addEventListener('pointerdown', begin, true);
    canvas.addEventListener('click', pick, true);
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerleave', leave);
    window.addEventListener('keydown', keyboard);
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    return () => {
      canvas.removeEventListener('pointerdown', begin, true);
      canvas.removeEventListener('click', pick, true);
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', keyboard);
      canvas.style.cursor = previousCursor;
    };
  }, [enabled, resetKey, camera, gl, scene]);

  return { selected, hover };
}
