import React from 'react';
import { DimensionNumberInput } from './Controls';
import { getFlatCornerRadii, getMaxFlatCornerRadius, type SheetMetalState, type FlatCornerRadii } from '../sheetGeometry';

export default function CornerRadiusControls({ state, setState, independent, onIndependentChange, activeCorner, onActiveCornerChange }: {
  state: SheetMetalState; setState: React.Dispatch<React.SetStateAction<SheetMetalState>>;
  independent: boolean; onIndependentChange: (value: boolean) => void;
  activeCorner: keyof FlatCornerRadii | null; onActiveCornerChange: (key: keyof FlatCornerRadii | null) => void;
}) {
  const radii = getFlatCornerRadii(state);
  const corners = [
    ['startLeft', `${state.legs[0].id} · gauche`], ['startRight', `${state.legs[0].id} · droite`],
    ['endLeft', `${state.legs[state.bendCount].id} · gauche`], ['endRight', `${state.legs[state.bendCount].id} · droite`],
  ] as const;
  const update = (value: number, key?: keyof FlatCornerRadii) => setState(previous => {
    const safe = Math.max(0, Math.min(getMaxFlatCornerRadius(previous, key), value));
    return key ? { ...previous, cornerRadii: { ...getFlatCornerRadii(previous), [key]: safe } }
      : { ...previous, cornerRadius: safe, cornerRadii: { startLeft: safe, startRight: safe, endLeft: safe, endRight: safe } };
  });
  const control = (label: string, key?: keyof FlatCornerRadii) => {
    const value = key ? radii[key] : radii.startLeft;
    const max = getMaxFlatCornerRadius(state, key);
    const id = key ? `corner-radius-${key}` : 'shared-corner-radius';
    return <div key={id} className={`radius-field ${key && activeCorner === key ? 'is-active' : ''}`}
      onFocus={() => key && onActiveCornerChange(key)} onPointerDown={() => key && onActiveCornerChange(key)}>
      <div className="field-heading"><label htmlFor={id}>{label}</label><div className="number-unit">
        <DimensionNumberInput id={id} label={`Rayon ${label} en millimètres`} value={value} min={0} max={max} step={0.5} onCommit={next => update(next, key)} />
        <span>mm</span></div></div>
      {!key && <p className="field-description">Appliqué aux quatre coins de la pièce.</p>}
      <input className="angle-slider" type="range" min={0} max={max} step={0.5} value={value} aria-label={`Régler le rayon ${label}`}
        onChange={event => update(Number(event.target.value), key)} />
      <div className="range-limits"><span>0 mm</span><span>{max} mm</span></div>
    </div>;
  };
  return <div className="corner-controls">
    {independent ? <div className="corner-radius-individual-grid">{corners.map(([key, label]) => control(label, key))}</div> : control('Rayon commun')}
    <label className="corner-radius-unlock"><input type="checkbox" checked={independent} onChange={event => {
      const next = event.target.checked;
      onIndependentChange(next);
      onActiveCornerChange(next ? 'startLeft' : null);
      if (!next) update(Math.round(Object.values(radii).reduce((total, radius) => total + radius, 0) / 4 * 2) / 2);
    }} /><span>Régler les rayons un par un</span></label>
  </div>;
}
