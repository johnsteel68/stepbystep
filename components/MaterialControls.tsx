import { Check } from 'lucide-react';
import { FINISH_TEXTURE_PROFILES, TEXTURE_SETS } from '../viewer/materials/textureCatalog';
import { DEFAULT_FINISH, SHEET_FINISHES, getAvailableSheetThicknesses, getAvailableSheetFinishes, type MaterialType, type SheetFinish } from '../sheetGeometry';

const materials: { id: MaterialType; name: string; description: string }[] = [
  { id: 'Steel', name: 'Acier', description: 'Brut, galvanisé, Corten…' },
  { id: 'Stainless', name: 'Inox', description: 'Brossé, marin, miroir…' },
  { id: 'Aluminum', name: 'Aluminium', description: 'Brut, filmé, anodisé…' },
];

// Use the same base map as the viewer: previews cannot drift from the catalogue.
function texturePreview(finish: SheetFinish) {
  const texture = TEXTURE_SETS[FINISH_TEXTURE_PROFILES[finish].set];
  return { backgroundImage: `url("${texture.color}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
}

export function MaterialControls({ value, onChange, bendCount = 0 }: { value: MaterialType; onChange: (value: MaterialType) => void; bendCount?: number }) {
  return <fieldset className="material-options"><legend className="sr-only">Matière de la pièce</legend>
    {materials.filter(material => getAvailableSheetFinishes(material.id, bendCount).length > 0).map(material => <label key={material.id} className={`material-option ${value === material.id ? 'is-selected' : ''}`}>
      <input type="radio" name="sheet-material" value={material.id} checked={value === material.id} onChange={() => onChange(material.id)} />
      <span className={`material-swatch material-swatch--${material.id}`} style={texturePreview(DEFAULT_FINISH[material.id])} aria-hidden="true" />
      <span className="material-description"><strong>{material.name}</strong><small>{bendCount > 0 ? getAvailableSheetFinishes(material.id, bendCount).map(finish => SHEET_FINISHES[finish].name).join(', ') : material.description}</small></span>
      <span className="material-check" aria-hidden="true">{value === material.id && <Check size={14} />}</span>
    </label>)}
  </fieldset>;
}

export function FinishControls({ material, value, onChange, bendCount = 0 }: { material: MaterialType; value?: SheetFinish; onChange: (finish: SheetFinish) => void; bendCount?: number }) {
  const selected = value || DEFAULT_FINISH[material];
  const options = getAvailableSheetFinishes(material, bendCount).map(id => [id, SHEET_FINISHES[id]] as const);
  return <fieldset className="finish-options">
    <legend className="field-label">Nuance / finition</legend>
    <div className="finish-option-grid">
      {options.map(([id, finishOption]) => <button key={id} type="button" className={`finish-option ${selected === id ? 'is-selected' : ''}`} aria-pressed={selected === id} onClick={() => onChange(id)}>
        <span className={`finish-swatch finish-swatch--${id}`} style={texturePreview(id)} aria-hidden="true" />
        <span className="finish-option-copy"><strong>{material === 'Steel' ? 'Acier' : material === 'Stainless' ? 'Inox' : 'Aluminium'} {finishOption.name}</strong><small>{finishOption.reference} · {getAvailableSheetThicknesses(id, bendCount).join(' / ')} mm</small></span>
        {selected === id && <Check className="finish-check" size={16} aria-hidden="true" />}
      </button>)}
    </div>
  </fieldset>;
}

export function ThicknessControls({ value, finish, onChange, bendCount = 0 }: { value: number; finish?: SheetFinish; onChange: (value: number) => void; bendCount?: number }) {
  const thicknesses = getAvailableSheetThicknesses(finish, bendCount);
  return <div className="thickness-control">
    <div className="field-heading"><label htmlFor={thicknesses.length > 1 ? 'sheet-thickness' : undefined}>Épaisseur de la tôle</label><div className="thickness-value"><output htmlFor={thicknesses.length > 1 ? 'sheet-thickness' : undefined}>{value.toLocaleString('fr-FR')}</output><span>mm</span></div></div>
    {thicknesses.length > 1 && <input id="sheet-thickness" className="angle-slider" type="range" min={0} max={thicknesses.length - 1} step={1}
      value={Math.max(0, thicknesses.indexOf(value))}
      aria-valuetext={`${value} millimètres`} onChange={event => onChange(thicknesses[Number(event.target.value)])} />}
  </div>;
}
