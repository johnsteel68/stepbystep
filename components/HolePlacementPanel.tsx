import { X, Circle, Square, RectangleHorizontal, Octagon } from 'lucide-react';
import { DimensionNumberInput } from './Controls';
import { getMaxHoleCornerRadius, getHoleConstraints, MAX_HOLE_PATTERN_COLUMNS, type HolePattern } from '../sheetGeometry';
import type { HoleShape } from '../sheetGeometry';
import type { ViewerProps } from '../viewerTypes';

type Props = { editing?: boolean; onWingSelect: (legId: string) => void } & Pick<ViewerProps, 'dimensions' | 'placementStage' | 'placementTargetLegId' | 'placementDraft' | 'placementHoleShape' | 'placementHoleOrientation' | 'placementHoleCornerRadius' | 'placementPatternChoice' | 'placementPatternConfig' | 'onPlacementShapeSelect' | 'onPlacementHoleOrientationChange' | 'onPlacementHoleCornerRadiusChange' | 'onPlacementPatternSelect' | 'onPlacementPatternChange' | 'onPlacementHoleSizeChange' | 'onPlacementCandidate' | 'onHolePlacement' | 'onCancelPlacement' | 'onPlacementPatternConfirm'>;


const holeShapes = [
  { id: 'round', label: 'Rond', short: 'Rond', Icon: Circle },
  { id: 'oblong', label: 'Oblong', short: 'Oblong', Icon: RectangleHorizontal },
  { id: 'square', label: 'Carré', short: 'Carré', Icon: Square },
  { id: 'rect', label: 'Rectangle', short: 'Rect.', Icon: RectangleHorizontal },
  { id: 'octagonal', label: 'Octogonal', short: 'Octo.', Icon: Octagon },
] as const;

function HoleShapePicker({ value, onChange }: { value: HoleShape; onChange?: (shape: HoleShape) => void }) {
  return <div className="hole-shape-options" role="group" aria-label="Forme du trou">
    {holeShapes.map(({ id, label, short, Icon }) => <button key={id} type="button" className="hole-shape-option" aria-label={label}
      aria-pressed={value === id} onClick={() => onChange?.(id)}>
      {id === 'oblong' ? <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="5" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg> : <Icon size={19} strokeWidth={1.7} />}
      <span>{short}</span>
    </button>)}
  </div>;
}

export default function HolePlacementPanel({ editing = false, onWingSelect, dimensions, placementStage, placementTargetLegId, placementDraft, placementHoleShape, placementHoleOrientation, placementHoleCornerRadius, placementPatternChoice, placementPatternConfig, onPlacementShapeSelect, onPlacementHoleOrientationChange, onPlacementHoleCornerRadiusChange, onPlacementPatternSelect, onPlacementPatternChange, onPlacementHoleSizeChange, onPlacementCandidate, onHolePlacement, onCancelPlacement, onPlacementPatternConfirm }: Props) {
  return (<div className="placement-panel">
          <div className="hole-editor-heading"><span className="eyebrow">{editing ? "Modifier le trou" : placementPatternChoice === "single" ? "Nouveau trou" : "Nouvelle série"}</span><button type="button" className="hole-cancel" onClick={onCancelPlacement} aria-label="Annuler le placement du trou"><X size={14} /><span>Annuler</span></button></div>
          <div className="flex items-center justify-center gap-2 text-center font-medium">
            <span className="h-2 w-2 shrink-0 rounded-full bg-pink-500" />
            {placementStage === 'select-wing'
              ? 'Vue à plat · sélectionnez une aile'
            : placementStage === 'choose-shape'
                ? `Aile ${placementTargetLegId} · choisissez la forme du trou`
                : placementStage === 'configure-single' && placementDraft?.valid
                  ? `Aile ${placementTargetLegId} · réglez votre trou`
                : placementDraft
              ? placementDraft.valid
                ? `Position choisie · aile ${placementDraft.legId}`
                : 'Trop près d’un pli · réduisez le trou ou repositionnez-le'
              : placementStage === 'choose-pattern'
                ? `Aile ${placementTargetLegId} · réglez la série`
              : placementTargetLegId
                ? `Vue dépliée · placez le trou sur l’aile ${placementTargetLegId}`
                : 'Choisissez le centre du trou sur la pièce'}
          </div>
          {placementStage === 'select-wing' && <div className="hole-wing-options" role="group" aria-label="Choisir l’aile">
            {dimensions.legs.slice(0, dimensions.bendCount + 1).map(leg => <button type="button" key={leg.id} onClick={() => onWingSelect(leg.id)}>Aile {leg.id}</button>)}
          </div>}
          {placementStage === 'choose-pattern' && <p className="field-description">Aile {placementTargetLegId} · configurez la série ci-dessous.</p>}
          {(['choose-shape', 'position', 'configure-single', 'choose-pattern'].includes(placementStage)) && <HoleShapePicker value={placementHoleShape} onChange={onPlacementShapeSelect} />}
          {(placementStage === 'position' || placementStage === 'configure-single' || placementStage === 'choose-pattern') && (placementHoleShape === 'oblong' || placementHoleShape === 'rect') && (
            <div className="mt-2 flex justify-center gap-1.5">
              {([
                ['along_length', 'Dans la longueur'], ['along_width', 'Dans la largeur'],
              ] as const).map(([orientation, label]) => (
                <button key={orientation} type="button" onClick={() => onPlacementHoleOrientationChange?.(orientation)} className={`rounded-lg border px-3 py-1 text-[10px] font-semibold ${placementHoleOrientation === orientation ? 'border-[#e83c69] bg-[#e83c69]/25 text-white' : 'border-white/15 bg-white/5 text-white/75'}`}>{label}</button>
              ))}
            </div>
          )}
          {placementStage === 'choose-pattern' && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {([
                ['corners', 'À chaque coin'],
                ['custom', 'Paramétrique'],
              ] as const).map(([mode, label]) => (
                <button key={mode} type="button" onClick={() => onPlacementPatternSelect?.(mode)} className={`rounded-lg border px-3 py-1.5 font-semibold ${placementPatternChoice === mode ? 'border-[#e83c69] bg-[#e83c69]/20 text-white' : 'border-white/15 bg-white/5 text-white/75'}`}>{label}</button>
              ))}
            </div>
          )}
          {placementStage === 'choose-pattern' && (
            <div className="hole-pattern-fields">
              {placementPatternChoice === 'custom' && <label className="text-[10px] text-white/70">Disposition
                <select value={placementPatternConfig.mode === 'square' ? 'square' : 'line'} onChange={event => onPlacementPatternChange?.({ ...placementPatternConfig, mode: event.target.value as HolePattern })} className="mt-1 w-full rounded-md border border-white/20 bg-slate-900 px-2 py-1.5 text-xs text-white">
                  <option value="line">En ligne</option><option value="square">En grille</option>
                </select>
              </label>}
              <label className="text-[10px] text-white/70">Marge (mm)
                <input type="number" min="3" value={placementPatternConfig.margin} onChange={event => onPlacementPatternChange?.({ ...placementPatternConfig, margin: Math.max(3, Number(event.target.value) || 3) })} className="mt-1 w-full rounded-md border border-white/20 bg-slate-900 px-2 py-1.5 text-xs text-white" />
              </label>
              {placementPatternChoice === 'custom' && (placementPatternConfig.mode === 'line' ? (
                <label className="text-[10px] text-white/70">Nombre de trous
                  <input type="number" min="2" max="20" value={placementPatternConfig.count} onChange={event => onPlacementPatternChange?.({ ...placementPatternConfig, count: Math.max(2, Math.min(20, Number(event.target.value) || 2)) })} className="mt-1 w-full rounded-md border border-white/20 bg-slate-900 px-2 py-1.5 text-xs text-white" />
                </label>
              ) : <div className="col-span-1 flex gap-1">
                <label className="flex-1 text-[10px] text-white/70">Lignes<input type="number" min="1" max="10" value={placementPatternConfig.rows} onChange={event => onPlacementPatternChange?.({ ...placementPatternConfig, rows: Math.max(1, Math.min(10, Number(event.target.value) || 1)) })} className="mt-1 w-full rounded-md border border-white/20 bg-slate-900 px-2 py-1.5 text-xs text-white" /></label>
                <label className="flex-1 text-[10px] text-white/70">Colonnes (max. {MAX_HOLE_PATTERN_COLUMNS})<input type="number" min="1" max={MAX_HOLE_PATTERN_COLUMNS} value={placementPatternConfig.columns} onChange={event => onPlacementPatternChange?.({ ...placementPatternConfig, columns: Math.max(1, Math.min(MAX_HOLE_PATTERN_COLUMNS, Number(event.target.value) || 1)) })} className="mt-1 w-full rounded-md border border-white/20 bg-slate-900 px-2 py-1.5 text-xs text-white" /></label>
              </div>)}
            </div>
          )}
          {(placementStage === 'configure-single' || placementStage === 'choose-pattern') && placementTargetLegId && (() => {
            const target = dimensions.legs.find(leg => leg.id === placementTargetLegId);
            if (!target) return null;
            const limits = getHoleConstraints(target, dimensions.thickness, dimensions.width, dimensions.bendCount > 0);
            const elongated = placementHoleShape === 'oblong' || placementHoleShape === 'rect';
            const fields = elongated
              ? [{ key: 'holeLength' as const, label: 'Longueur', value: target.holeLength || 25 }, { key: 'holeWidth' as const, label: 'Largeur', value: target.holeWidth || 12 }]
              : [{ key: 'holeDiam' as const, label: placementHoleShape === 'square' ? 'Côté' : 'Diamètre', value: target.holeDiam }];
            return <div className="hole-size-fields">
              {fields.map(field => <div key={field.key} className="field-heading">
                <label htmlFor={`hole-size-${field.key}`}>{field.label}</label>
                <div className="number-unit">
                  <DimensionNumberInput id={`hole-size-${field.key}`} label={`${field.label} du trou en millimètres`}
                    value={field.value} min={limits.minDiam} max={limits.maxDiam}
                    onCommit={value => onPlacementHoleSizeChange?.(target.id, field.key, value)} />
                  <span aria-hidden="true">mm</span>
                </div>
              </div>)}
            </div>;
          })()}
          {(placementStage === 'position' || placementStage === 'configure-single' || placementStage === 'choose-pattern') && (placementHoleShape === 'square' || placementHoleShape === 'rect') && (() => {
            const target = dimensions.legs.find(leg => leg.id === placementTargetLegId) || dimensions.legs[0];
            const radiusLimit = target ? getMaxHoleCornerRadius({ ...target, holeShape: placementHoleShape }) : 0;
            const radiusValue = Math.min(radiusLimit, Math.max(0, placementHoleCornerRadius));
            return (
              <div className="mt-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-2">
                <label className="flex items-center justify-between gap-3 text-[10px] font-semibold text-white/80">
                  <span>Arrondi des angles</span>
                  <span className="tabular-nums text-pink-200">{radiusValue} mm <span className="text-white/50">/ {radiusLimit} mm max.</span></span>
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max={radiusLimit}
                    step="0.5"
                    value={radiusValue}
                    aria-label="Rayon d’arrondi des coins du trou"
                    onChange={event => onPlacementHoleCornerRadiusChange?.(Number(event.target.value))}
                    className="min-w-0 flex-1 accent-pink-500"
                  />
                  <input
                    type="number"
                    min="0"
                    max={radiusLimit}
                    step="0.5"
                    value={radiusValue}
                    aria-label="Rayon d’arrondi des coins en millimètres"
                    onChange={event => onPlacementHoleCornerRadiusChange?.(Math.max(0, Math.min(radiusLimit, Number(event.target.value) || 0)))}
                    className="w-16 rounded-md border border-white/20 bg-slate-900 px-1.5 py-1 text-center text-[10px] text-white"
                  />
                </div>
              </div>
            );
          })()}
          {placementDraft && placementStage === 'configure-single' && (() => {
            const leg = dimensions.legs.find(item => item.id === placementDraft.legId);
            if (!leg) return null;
            const bounds = getHoleConstraints({ ...leg, holeShape: placementHoleShape, holeOrientation: placementHoleOrientation }, dimensions.thickness, dimensions.width, dimensions.bendCount > 0);
            return <div className="hole-size-fields hole-position-fields">
              <p className="field-label">Position du trou</p>
              {([{ key: 'dist', label: 'X', max: Math.max(0, bounds.maxDist) }, { key: 'offset', label: 'Y', max: dimensions.width }] as const).map(field => <div className="field-heading" key={field.key}>
                <label htmlFor={`hole-position-${field.key}`}>{field.label}</label><div className="number-unit"><DimensionNumberInput id={`hole-position-${field.key}`}
                  label={`${field.label} du trou en millimètres`} value={placementDraft[field.key]} min={0} max={field.max}
                  onCommit={value => onPlacementCandidate?.({ ...placementDraft, [field.key]: value })} /><span>mm</span></div>
              </div>)}
            </div>;
          })()}
          {placementDraft && (
            <div className="hole-confirm-actions">
              <button
                type="button"
                onClick={() => onPlacementCandidate?.(null)}
                className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
              >Repositionner</button>
              {placementDraft.valid && (
                <button
                  type="button"
                  onClick={() => onHolePlacement?.(placementDraft.legId, placementDraft.dist, placementDraft.offset)}
                  className="rounded-lg bg-[#e83c69] px-3.5 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-[#d72f5d]"
                >{editing ? 'Enregistrer' : 'Confirmer le trou'}</button>
              )}
              <button
                type="button"
                onClick={onCancelPlacement}
                className="rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] text-white/80 hover:bg-white/10"
              >Annuler</button>
            </div>
          )}
          {placementStage === 'choose-pattern' && (placementPatternChoice === 'corners' || placementPatternChoice === 'custom') && (
            <div className="hole-confirm-actions placement-final-actions">
              <button type="button" onClick={() => onPlacementPatternConfirm?.(placementPatternConfig)} className="placement-pattern-add">Ajouter la série</button>
              <button type="button" onClick={onCancelPlacement} className="placement-cancel-action">Annuler</button>
            </div>
          )}
          {!placementDraft && placementStage !== 'choose-pattern' && (
            <div className="hole-confirm-actions placement-final-actions">
              <button type="button" onClick={onCancelPlacement} className="placement-cancel-action">Annuler le placement</button>
            </div>
          )}
          {!placementDraft && placementStage === 'position' && (
            <div className="mt-1.5 text-center text-[10px] text-white/60">Le cercle rose montre le trou à l’échelle. Les distances sont indiquées le long des cotes.</div>
          )}
        </div>);
}
