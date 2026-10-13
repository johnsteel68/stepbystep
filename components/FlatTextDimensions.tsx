import { useMemo } from 'react';
import type { SheetMetalState } from '../sheetGeometry';
import { flatDimensionLayouts } from '../viewer/annotations/flatDimensionLayout';

/** Pure SVG annotations: no 3D transform, no pointer capture or drag handlers. */
export default function FlatTextDimensions({ state, length, width, zoom }: { state: SheetMetalState; length: number; width: number; zoom: number }) {
  const layouts = useMemo(() => flatDimensionLayouts(state, length, width), [state, length, width]);
  const fontSize = Math.max(length, width) * .026 / zoom;
  const point = (p: { x: number; y: number }) => ({ x: p.x + length / 2, y: width / 2 - p.y });
  return <g pointerEvents="none" fill="#323843" stroke="#5b616b" strokeWidth={1}>
    {layouts.map((layout, index) => {
      const a = point(layout.start), b = point(layout.end), baseA = point(layout.baseStart), baseB = point(layout.baseEnd);
      const vertical = index === layouts.length - 1;
      const x = (a.x + b.x) / 2 + (vertical ? fontSize : 0), y = (a.y + b.y) / 2 - (vertical ? 0 : fontSize * .65);
      const arrow = fontSize * .35;
      return <g key={index}>
        <line x1={baseA.x} y1={baseA.y} x2={a.x} y2={a.y} vectorEffect="non-scaling-stroke" />
        <line x1={baseB.x} y1={baseB.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
        <path d={vertical ? `M${a.x-arrow},${a.y-arrow} L${a.x},${a.y} L${a.x+arrow},${a.y-arrow} M${b.x-arrow},${b.y+arrow} L${b.x},${b.y} L${b.x+arrow},${b.y+arrow}`
          : `M${a.x+arrow},${a.y-arrow} L${a.x},${a.y} L${a.x+arrow},${a.y+arrow} M${b.x-arrow},${b.y-arrow} L${b.x},${b.y} L${b.x-arrow},${b.y+arrow}`} fill="none" vectorEffect="non-scaling-stroke" />
        <text x={x} y={y} transform={vertical ? `rotate(-90 ${x} ${y})` : undefined} stroke="none" textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fontFamily="Arial, sans-serif">{layout.value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mm</text>
      </g>;
    })}
  </g>;
}
