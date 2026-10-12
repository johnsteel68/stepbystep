import type { HolePosition } from '../sheetGeometry';
import { memo } from 'react';

/** Same generated vector geometry used by the CAD exporter and 3D cutter. */
export default memo(function TextCutout({ cut }: { cut: HolePosition }) {
  if (cut.contour?.length) return <polygon points={cut.contour.map(p => `${cut.dist + p.x},${cut.offset + p.y}`).join(' ')} />;
  return cut.shape === 'round' ? <circle cx={cut.dist} cy={cut.offset} r={cut.diam! / 2} />
    : <rect x={cut.dist - (cut.length ?? cut.diam!) / 2} y={cut.offset - (cut.width ?? cut.diam!) / 2} width={cut.length ?? cut.diam} height={cut.width ?? cut.diam} />;
});
