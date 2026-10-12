import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { SignedAngleInput } from './Controls';
import type { SheetMetalState } from '../sheetGeometry';

const CLASSIC_ANGLES = [-150, -135, -120, -90, -60, -45, -30, 30, 45, 60, 90, 120, 135, 150];
function snapAngle(value: number) {
  const nearest = CLASSIC_ANGLES.reduce((best, angle) => Math.abs(angle - value) < Math.abs(best - value) ? angle : best);
  return Math.abs(nearest - value) <= 3 ? nearest : value;
}

export default function BendControls({ state, proMode, bendIndex, onAngleChange, onBendFocus }: {
  state: SheetMetalState; proMode: boolean; bendIndex: number;
  onAngleChange: (index: number, value: number) => void; onBendFocus: (index: number) => void;
}) {
  return <div className="bend-fields">
    {state.bends.slice(0, state.bendCount).map((bend, index) => (proMode || index === bendIndex) && <section key={bend.id} className="bend-field">
      <div className="field-heading">
        <label htmlFor={`bend-angle-${bend.id}`}>Pli {bend.id} <span className="bend-wings">{state.legs[index].id} ↔ {state.legs[index + 1].id}</span></label>
        <SignedAngleInput bendId={bend.id} value={bend.direction * bend.angle}
          onFocus={() => onBendFocus(index)} onCommit={value => onAngleChange(index, value)} />
      </div>
      <input type="range" className="angle-slider" min={-165} max={165} step={1} value={bend.direction * bend.angle}
        aria-label={`Angle du pli ${bend.id}`} onFocus={() => onBendFocus(index)}
        onChange={event => onAngleChange(index, snapAngle(Number(event.target.value)))} />
      <div className="range-limits" aria-hidden="true"><span>−165°</span><span>+165°</span></div>
      <div className="bend-direction" role="group" aria-label={`Sens du pli ${bend.id}`}>
        <button type="button" aria-pressed={bend.direction === 1} onClick={() => onAngleChange(index, bend.angle)}><ArrowUpRight size={17} />Vers le haut</button>
        <button type="button" aria-pressed={bend.direction === -1} onClick={() => onAngleChange(index, -bend.angle)}><ArrowDownRight size={17} />Vers le bas</button>
      </div>
    </section>)}
  </div>;
}
