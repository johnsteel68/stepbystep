import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';

/** Propagate GPU loss to the outer boundary, which preserves editor state. */
export default function ContextLossGuard() {
  const renderer = useThree(state => state.gl);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const canvas = renderer.domElement;
    const onLost = (event: Event) => { event.preventDefault(); setLost(true); };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => canvas.removeEventListener('webglcontextlost', onLost);
  }, [renderer]);
  if (lost) throw new Error('WebGL context lost');
  return null;
}
