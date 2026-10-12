import { BLANK_SHAPES, sampleBlank, normalizeBlank, blankInnerContours } from '../blankGeometry';
import { blankBendPlan } from '../formedBlank';
import { DimensionField } from './DimensionControls';
import { SHEET_LENGTH, SHEET_WIDTH, getMaxWidth, type SheetMetalState } from '../sheetGeometry';
import { useState } from 'react';
import { configureBlankTemplate, templateSettings, removeFrameOpening } from '../blankTemplates';

function ShapeIcon({ shape }: { shape: typeof BLANK_SHAPES[number]['id'] }) {
  const definition = normalizeBlank({ shape, length: 150, width: 100 });
  const scale = Math.min(84 / definition.length, 54 / definition.width);
  const left = (100 - definition.length * scale) / 2, top = (70 - definition.width * scale) / 2;
  const path = [sampleBlank(definition, 12), ...blankInnerContours(definition)].map(points =>
    points.map((p, i) => `${i ? 'L' : 'M'}${left + p.x * scale},${top + p.y * scale}`).join(' ') + 'Z').join(' ');
  return <svg viewBox="0 0 100 70" aria-hidden="true"><path d={path} fillRule="evenodd" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="2" />
    {shape === 'frame' && <rect x={left + 8} y={top + 8} width={definition.length * scale - 16} height={definition.width * scale - 16} fill="none" stroke="currentColor" strokeWidth="2" />}
    {shape === 'mounting-plate' && <g fill="none" stroke="currentColor" strokeWidth="2">
      {[left + 8, 100 - left - 8].flatMap(x => [top + 8, 70 - top - 8].map(y => <circle key={x + ':' + y} cx={x} cy={y} r="3" />))}
      <circle cx="50" cy="35" r="7" /></g>}
  </svg>;
}
/** Selection and dimensions live on separate pages, sharing the same shape definition. */
export function BlankShapeControls({ state, mode, onChange }: { state: SheetMetalState; mode: 'select' | 'parameters'; onChange: (next: SheetMetalState) => void }) {
  const [templateError, setTemplateError] = useState('');
  if (state.bendCount > 0) return null;
  const plan = blankBendPlan(state);
  const shape = state.blankShape || 'rectangle';
  const template = templateSettings(state);
  const isTemplate = shape === 'frame' || shape === 'mounting-plate';
  // Coupled dimensions must fit together, not merely pass two independent caps.
  const equalSides = ['circle', 'square', 'star', 'gear', 'washer', 'octagon'].includes(shape);
  const maxLength = equalSides ? SHEET_WIDTH : shape === 'semicircle' ? Math.min(SHEET_LENGTH, 2 * SHEET_WIDTH)
    : shape === 'hexagon' ? 2 * SHEET_WIDTH / Math.sqrt(3) : getMaxWidth(plan.frame.definition.width);
  const maxWidth = shape === 'hexagon' || equalSides ? SHEET_WIDTH : getMaxWidth(plan.frame.definition.length);
  function updateTemplate(settings: Partial<typeof template>) {
    try { onChange(configureBlankTemplate(state, settings)); setTemplateError(''); }
    catch (error) { setTemplateError(error instanceof Error ? error.message : 'Réglage invalide.'); }
  }
  function updateStar(patch: Partial<SheetMetalState>) {
    const next = { ...state, ...patch };
    onChange({ ...next, blankBranchCount: Math.round(next.blankBranchCount ?? 5),
      blankBranchHeight: Math.min(next.blankBranchHeight ?? next.blankLength! * 11 / 40, next.blankLength! / 2 - 1) });
  }
  function updateGear(patch: Partial<SheetMetalState>) {
    const next = { ...state, ...patch };
    const diameter = next.blankLength!;
    const count = Math.round(next.blankToothCount ?? 16);
    const height = Math.min(next.blankToothHeight ?? diameter * .08, diameter / 2 - 2);
    const maxBore = Math.floor(2 * ((diameter / 2 - height) * Math.cos(.45 * 2 * Math.PI / count) - 1));
    onChange({ ...next, blankToothCount: count, blankToothHeight: height,
      blankInnerDiameter: Math.min(next.blankInnerDiameter || 0, maxBore) });
  }
  function select(nextShape: typeof shape) {
    const length = state.blankLength ?? state.legs.slice(0, state.bendCount + 1).reduce((total, leg) => total + leg.length, 0);
    const width = state.blankWidth ?? state.width;
    const isPreset = nextShape === 'frame' || nextShape === 'mounting-plate';
    const definition = normalizeBlank({ shape: nextShape, length: Math.max(length, width, isPreset ? 30 : 10), width: Math.max(width, isPreset ? 30 : 10) });
    const next = { ...(nextShape !== shape ? removeFrameOpening(state) : state), blankShape: nextShape, blankLength: definition.length, blankWidth: definition.width,
      blankInnerDiameter: definition.innerDiameter, blankToothCount: definition.toothCount, blankToothHeight: definition.toothHeight,
      blankBranchCount: definition.branchCount, blankBranchHeight: definition.branchHeight, blankOrientation: 0,
      blankBendPositions: undefined, cornerRadius: 0, cornerRadii: { startLeft: 0, startRight: 0, endLeft: 0, endRight: 0 } };
    onChange(isPreset ? configureBlankTemplate(next, { border: Math.min(10, definition.width / 5), diameter: 5,
      margin: Math.min(10, definition.width / 4), centralDiameter: Math.min(20, definition.width / 4) }) : next);
    setTemplateError('');
  }
  return <>
    {mode === 'select' && <div className="blank-shape-grid" role="group" aria-label="Forme de la plaque">
      {BLANK_SHAPES.map(option => <button key={option.id} type="button" className={`finish-option blank-shape-option ${shape === option.id ? 'is-selected' : ''}`}
        aria-pressed={shape === option.id} onClick={() => select(option.id)}><ShapeIcon shape={option.id} /><span>{option.label}</span></button>)}
    </div>}
    {mode === 'parameters' && <div className="dimension-fields">
      <DimensionField id="blank-length" label={['circle', 'semicircle', 'star', 'gear', 'washer'].includes(shape) ? shape === 'washer' ? 'Diamètre extérieur' : 'Diamètre' : shape === 'square' ? 'Côté' : 'Longueur'}
        value={plan.frame.definition.length} min={isTemplate ? 30 : 10} max={Math.floor(maxLength)} onChange={value => isTemplate ? updateTemplate({ length: value }) : shape === 'star' ? updateStar({ blankLength: value }) : shape === 'gear' ? updateGear({ blankLength: value }) : onChange({ ...state, blankLength: value,
          ...(shape === 'hexagon' ? { blankWidth: value * Math.sqrt(3) / 2 } : shape === 'octagon' ? { blankWidth: value } : {}), blankBendPositions: undefined })} />
      {!['circle', 'semicircle', 'square', 'star', 'gear', 'washer'].includes(shape) && <DimensionField id="blank-width" label={shape === 'hexagon' || shape === 'octagon' ? 'Entre côtés opposés' : 'Largeur'}
        value={plan.frame.definition.width} min={isTemplate ? 30 : 10} max={Math.floor(maxWidth)} onChange={value => isTemplate ? updateTemplate({ width: value }) : onChange({ ...state, blankWidth: value, blankBendPositions: undefined })} />}
      <p className="step-intro">Format déplié maximal : 2 980 × 1 480 mm. La pièce peut être tournée dans la tôle.</p>
      {shape === 'frame' && <DimensionField id="frame-border" label="Largeur du bord" value={template.border} min={2} max={(Math.min(template.length, template.width) - 1) / 2} step={.5} onChange={border => updateTemplate({ border })} />}
      {shape === 'mounting-plate' && <>
        <DimensionField id="plate-hole-diameter" label="Diamètre des 4 trous de fixation" value={template.diameter} min={1} max={Math.min(2 * (template.margin - 2), Math.min(template.length, template.width) - 2 * template.margin - 2)} onChange={diameter => updateTemplate({ diameter })} />
        <DimensionField id="plate-hole-margin" label="Distance des centres aux bords" value={template.margin} min={template.diameter / 2 + 2} max={(Math.min(template.length, template.width) - template.diameter - 2) / 2} onChange={margin => updateTemplate({ margin })} />
        <label className="step-intro"><input type="checkbox" checked={!!template.centralDiameter} onChange={event => updateTemplate({ centralDiameter: event.target.checked ? 5 : 0 })} /> Trou central</label>
        {!!template.centralDiameter && <DimensionField id="plate-central-diameter" label="Diamètre du trou central" value={template.centralDiameter} min={1} max={Math.min(Math.min(template.length, template.width) - 4, 2 * Math.hypot(template.length / 2 - template.margin, template.width / 2 - template.margin) - template.diameter - 4)} onChange={centralDiameter => updateTemplate({ centralDiameter })} />}
      </>}
      {isTemplate && <p className="step-intro">Les réglages du gabarit recréent ses perçages. Vous pouvez ensuite les modifier individuellement à l’étape Trous.</p>}
      {!!templateError && <p className="step-intro" role="alert">{templateError}</p>}
      {shape === 'washer' && <DimensionField id="blank-inner-diameter" label="Diamètre intérieur"
        value={plan.frame.definition.innerDiameter!} min={1} max={Math.floor(plan.frame.definition.length - 2)}
        onChange={value => onChange({ ...state, blankInnerDiameter: value })} />}
      {shape === 'star' && <>
        <DimensionField id="star-branch-count" label="Nombre de branches" unit="" value={plan.frame.definition.branchCount!} min={3} max={30}
          onChange={value => updateStar({ blankBranchCount: value })} />
        <DimensionField id="star-branch-height" label="Hauteur des branches" step={.01} value={plan.frame.definition.branchHeight!} min={.5} max={plan.frame.definition.length / 2 - 1}
          onChange={value => updateStar({ blankBranchHeight: value })} />
        <p className="step-intro">Du creux à la pointe, dans le sens du rayon. Plus la hauteur augmente, plus les branches sont marquées.</p>
      </>}
      {shape === 'gear' && <>
        <DimensionField id="gear-tooth-count" label="Nombre de dents" unit="" value={plan.frame.definition.toothCount!} min={6} max={120}
          onChange={value => updateGear({ blankToothCount: value })} />
        <DimensionField id="gear-tooth-height" label="Hauteur des dents" step={.01} value={plan.frame.definition.toothHeight!} min={.5} max={Math.floor(plan.frame.definition.length / 2 - 2)}
          onChange={value => updateGear({ blankToothHeight: value })} />
        <label className="step-intro"><input type="checkbox" checked={!!plan.frame.definition.innerDiameter}
          onChange={event => updateGear({ blankInnerDiameter: event.target.checked ? Math.max(1, Math.floor(plan.frame.definition.length / 5)) : 0 })} /> Trou central</label>
        {!!plan.frame.definition.innerDiameter && <DimensionField id="gear-bore" label="Diamètre du trou central" value={plan.frame.definition.innerDiameter} min={1}
          max={Math.floor(2 * ((plan.frame.definition.length / 2 - plan.frame.definition.toothHeight!) * Math.cos(.45 * 2 * Math.PI / plan.frame.definition.toothCount!) - 1))}
          onChange={value => updateGear({ blankInnerDiameter: value })} />}
        <p className="step-intro">Dents trapézoïdales régulières. Pour un engrenage de transmission, un profil mécanique calculé est nécessaire.</p>
      </>}
    </div>}
  </>;
}
export function BlankFoldControls({ state, bendIndex, proMode, onChange }: {
  state: SheetMetalState; bendIndex: number; proMode: boolean; onChange: (next: SheetMetalState) => void;
}) {
  if (!state.blankShape || state.bendCount === 0) return null;
  const plan = blankBendPlan(state);
  return <div className="dimension-fields blank-fold-fields">
    <DimensionField id="blank-fold-orientation" label="Orientation commune des plis" unit="°" value={state.blankOrientation || 0} min={-90} max={90}
      onChange={value => onChange({ ...state, blankOrientation: value })} />
    {plan.bands.filter(band => proMode || band.index === bendIndex).map(band => <DimensionField key={band.index} id={`blank-fold-position-${band.index}`}
      label={`Position du pli ${band.index + 1}`} value={Math.round(band.position * 10) / 10} min={1} max={Math.floor(plan.frame.length - 1)}
      onChange={value => onChange({ ...state, blankBendPositions: plan.bands.map(item => item.index === band.index ? value : item.position) })} />)}
    <p className="step-intro">Les plis restent parallèles. Les positions sont mesurées depuis le bord du développé, perpendiculairement aux lignes de pli.</p>
  </div>;
}
