import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { featureDistance } from './measurementGeometry';
import { useMeasurementSelection } from './useMeasurementSelection';

/** Measurements use world-space model units (millimetres), never pixels.
 * Only explicitly marked sheet meshes are selectable, not the floor or labels.
 */
export default function MeasureTool({ enabled, resetKey }: { enabled: boolean; resetKey: string }) {
  const { selected, hover } = useMeasurementSelection(enabled, resetKey);
  const points = useMemo(() => selected.length === 2 ? featureDistance(selected[0], selected[1]) : null, [selected]);
  if (!enabled) return null;
  const middle = points ? points[0].clone().lerp(points[1], .5) : null;
  const description = selected.map(feature => feature.kind === 'bend' ? feature.label : feature.kind === 'hole' ? 'centre du trou' : feature.kind === 'edge' ? 'arête' : 'coin').join(' ↔ ');
  return <>
    {[...selected, ...(hover && !selected.some(item => item.id === hover.id) ? [hover] : [])].map(feature => feature.b
      ? <Line key={feature.id} points={[feature.a, feature.b]} color="#e83c69" lineWidth={4} depthTest={false} />
      : <Html key={feature.id} center position={feature.a} style={{ pointerEvents: 'none' }}><span className="measure-point">{feature.kind === 'hole' ? '⊕' : '●'}</span></Html>)}
    {middle && points && <><Line points={points} color="#e83c69" lineWidth={1.5} depthTest={false} />
      <Html center position={middle} style={{ pointerEvents: 'none' }}><span className="technical-dimension-label">{points[0].distanceTo(points[1]).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} mm</span></Html></>}
    <Html fullscreen style={{ pointerEvents: 'none' }}><div className="measure-instructions" role="status">
      {points ? `${description} · Échap pour effacer.` : `${selected.length ? 'Second repère' : 'Règle'} : choisissez un coin, une arête, un pli intérieur/extérieur ou le centre d’un trou.`}
      {hover && !points && ` ${hover.label}`}
    </div></Html>
  </>;
}
