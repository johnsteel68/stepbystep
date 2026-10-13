import { useEffect, useMemo } from 'react';
import { DoubleSide } from 'three';
import { createFilmPeelGeometry, type FilmPeel } from './protectiveFilm';

/** Cosmetic only: no measurement marker, pointer interception or CAD export. */
export default function ProtectiveFilmCorner({ peel }: { peel: FilmPeel }) {
  const geometry = useMemo(() => createFilmPeelGeometry(peel), [peel]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} raycast={() => {}}>
    <meshPhysicalMaterial color="#eff2f5" metalness={0} roughness={.48} clearcoat={.06} clearcoatRoughness={.65} side={DoubleSide} />
  </mesh>;
}
