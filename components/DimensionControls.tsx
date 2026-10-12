import React from 'react';
import { DimensionNumberInput } from './Controls';
import { getMinLegLength, getMaxLegLength, getInnerLegLength, type SheetMetalState } from '../sheetGeometry';

export function DimensionField({ id, label, value, min, max, onChange, onFocus, onBlur, children, unit = 'mm', step = 1 }: {
  id: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void;
  onFocus?: () => void; onBlur?: () => void; children?: React.ReactNode;
  unit?: 'mm' | '°' | '';
  step?: number;
}) {
  return <section className="dimension-field">
    <div className="field-heading"><label htmlFor={id}>{label}</label><div className="number-unit">
      <DimensionNumberInput id={id} label={`${label}${unit ? ` en ${unit === 'mm' ? 'millimètres' : 'degrés'}` : ''}`} value={value} min={min} max={max} step={step} onCommit={onChange} onFocus={onFocus} onBlur={onBlur} />
      <span aria-hidden="true">{unit}</span></div></div>
    <input className="angle-slider" type="range" min={min} max={max} step={step} value={value} aria-label={label}
      onChange={event => { onFocus?.(); onChange(Number(event.target.value)); }} onFocus={onFocus} onBlur={onBlur} />
    <div className="range-limits" aria-hidden="true"><span>{min} {unit}</span><span>{max.toLocaleString('fr-FR')} {unit}</span></div>
    {children}
  </section>;
}

export default function DimensionControls({ state, proMode, legIndex, widthPage, maxWidth, onLegChange, onWidthChange, onLegFocus, onLegBlur }: {
  state: SheetMetalState; proMode: boolean; legIndex: number; widthPage: boolean; maxWidth: number;
  onLegChange: (index: number, value: number) => void; onWidthChange: (value: number) => void;
  onLegFocus: (index: number) => void; onLegBlur: (index: number) => void;
}) {
  return <div className="dimension-fields">
    {(!widthPage || proMode) && state.legs.slice(0, state.bendCount + 1).map((leg, index) => (proMode || index === legIndex) &&
      <DimensionField key={leg.id} id={`leg-length-${leg.id}`} label={`Longueur de l’aile ${leg.id}`} value={leg.length}
        min={getMinLegLength(state.thickness)} max={getMaxLegLength(state, index)} onChange={value => onLegChange(index, value)}
        onFocus={() => onLegFocus(index)} onBlur={() => onLegBlur(index)}>
        <dl className="dimension-readouts"><div><dt>Cote extérieure</dt><dd>{leg.length.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} <span>mm</span></dd></div>
          <div><dt>Cote intérieure</dt><dd>{getInnerLegLength(state, index).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} <span>mm</span></dd></div></dl>
      </DimensionField>)}
    {(widthPage || proMode) && <DimensionField id="sheet-width" label="Largeur de la pièce" value={state.width} min={10} max={maxWidth} onChange={onWidthChange} />}
  </div>;
}
