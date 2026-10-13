import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MeshPhysicalMaterial } from 'three';
import ProtectiveFilmCorner from './ProtectiveFilmCorner';
import { setProtectiveFilmCoverage, type FilmPeel } from './protectiveFilm';
import { nextFilmCoverage, type FilmStage } from './filmPresentation';

/** Presentation-only film: no film in exports, no geometry/project mutation.
 * Leaving thickness unfurls the corner while revealing the metal underneath. */
export default function ProtectiveFilmLayer({ stage, peel, material, interactive }: {
  stage: FilmStage; peel?: FilmPeel; material: MeshPhysicalMaterial; interactive: boolean;
}) {
  const coverage = useRef(stage === 'selection' ? 1 : 0);
  const reducedMotion = useRef(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { reducedMotion.current = preference.matches; };
    sync();
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  useEffect(() => () => setProtectiveFilmCoverage(material, 0), [material]);
  useFrame((_, delta) => {
    coverage.current = nextFilmCoverage(coverage.current, stage, delta, reducedMotion.current);
    setProtectiveFilmCoverage(material, coverage.current);
  });
  return peel ? <ProtectiveFilmCorner peel={peel} material={material} coverage={coverage}
    removing={stage === 'removed' && !reducedMotion.current}
    interactive={interactive && stage === 'selection'} /> : null;
}
