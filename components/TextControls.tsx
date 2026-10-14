import { useEffect, useMemo, useRef, useState } from 'react';
import { applyStencilText, fitStencilText, getStencilTexts, hasPendingStencilText, stencilCells, textMinimumHeight, textAvailabilityIssue, STENCIL_FONTS, type StencilText } from '../stencilText';
import type { SheetMetalState } from '../sheetGeometry';
import { DimensionField } from './DimensionControls';
import TextCutout from './TextCutout';
import StencilFontPicker from './StencilFontPicker';
import { normalizeTextRotation } from '../textRotation';

type Draft = { legId: string; config: StencilText };
type Placement = { legId: string; x: number; y: number; height?: number; rotation?: number } | null;

function newId() {
  return globalThis.crypto?.randomUUID?.().replace(/[^\w-]/g, '').slice(0, 36) ?? `txt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function TextControls({ state, onChange, onDraftChange, placement }: {
  state: SheetMetalState;
  onChange: (next: SheetMetalState) => void;
  onDraftChange: (value: Draft | null) => void;
  placement: Placement;
}) {
  const activeLegs = state.legs.slice(0, state.bendCount + 1);
  const [selection, setSelection] = useState<{ legId: string; id: string } | null>(null);
  const [draft, setDraft] = useState<StencilText | null>(null);
  const [sourceLeg, setSourceLeg] = useState<string | null>(null);
  const [error, setError] = useState('');
  const consumedPlacement = useRef<Placement>(null);
  const selectedLeg = selection ? state.legs.find(leg => leg.id === selection.legId) : undefined;
  const selectedConfig = selectedLeg && selection ? getStencilTexts(selectedLeg, selectedLeg.id).find(item => item.id === selection.id) : undefined;
  const selectedId = selection?.id;
  const config = draft ?? selectedConfig ?? null;
  const legId = selection?.legId ?? activeLegs[0].id;
  const leg = state.legs.find(item => item.id === legId) ?? activeLegs[0];

  useEffect(() => { onDraftChange(config ? { legId, config } : null); }, [legId, config, onDraftChange]);
  useEffect(() => {
    // Camera/viewport placement is a one-shot event, applied to the selected
    // block (or the new block being prepared) without replacing other text.
    if (!placement || placement === consumedPlacement.current) return;
    consumedPlacement.current = placement;
    const selected = selection && state.legs.find(item => item.id === selection.legId);
    const base = draft ?? (selected && selection ? getStencilTexts(selected, selection.legId).find(item => item.id === selection.id) : null);
    if (!base) return;
    const { legId: targetId, ...patch } = placement;
    try {
      const candidate = { ...base, ...patch };
      setDraft(candidate);
      setSelection({ legId: targetId, id: candidate.id ?? newId() });
    } catch (failure) { setError((failure as Error).message); }
  }, [placement, draft, state, selection, onChange]);

  const { candidate, message } = useMemo(() => {
    if (!config || !config.text.trim()) return { candidate: null, message: '' };
    try {
      const base = sourceLeg && sourceLeg !== legId ? applyStencilText(state, sourceLeg, null, config.id) : state;
      return { candidate: applyStencilText(base, legId, config, config.id), message: '' };
    }
    catch (failure) { return { candidate: null, message: (failure as Error).message }; }
  }, [state, legId, config, sourceLeg]);
  const cells = useMemo(() => {
    if (!config) return [];
    try { return stencilCells({ ...config, x: 0, y: 0 }, state.thickness); } catch { return []; }
  }, [config?.text, config?.font, config?.height, config?.rotation, state.thickness]);
  const update = (patch: Partial<StencilText>) => {
    if (!config) return;
    try {
      const proposed = { ...config, ...patch };
      const base = sourceLeg && sourceLeg !== legId ? applyStencilText(state, sourceLeg, null, config.id) : state;
      if ('x' in patch || 'y' in patch || 'rotation' in patch) {
        if (proposed.text.trim()) applyStencilText(base, legId, proposed, proposed.id);
        setDraft(proposed);
      } else setDraft(fitStencilText(base, legId, proposed));
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  };
  const startNew = (targetLegId = legId) => {
    if (hasPendingStencilText(state, draft && selection ? { legId: selection.legId, config: draft } : null)) {
      setError('Validez ou supprimez les modifications avant d’ajouter un autre bloc.');
      return;
    }
    const target = state.legs.find(item => item.id === targetLegId)!;
    const id = newId();
    setSelection({ legId: targetLegId, id });
    setSourceLeg(null);
    setDraft({ id, text: 'TEXT', font: 'stencil-micro-block', height: textMinimumHeight(state.thickness, 'stencil-micro-block'), x: target.length / 2, y: state.width / 2, rotation: 0 });
    setError('');
  };
  const selectBlock = (targetLegId: string, text: StencilText) => {
    if (hasPendingStencilText(state, draft && selection ? { legId: selection.legId, config: draft } : null)) {
      setError('Validez ou supprimez les modifications avant d’en sélectionner un autre.');
      return;
    }
    setSelection({ legId: targetLegId, id: text.id ?? `legacy-${targetLegId}` });
    setSourceLeg(targetLegId);
    setDraft(null);
    setError('');
  };
  const deleteBlock = () => {
    if (!config || !selection) return;
    const original = sourceLeg ?? legId;
    const saved = state.legs.find(item => item.id === original)
      && getStencilTexts(state.legs.find(item => item.id === original)!, original).some(item => item.id === selection.id);
    if (saved) onChange(applyStencilText(state, original, null, selection.id));
    setSelection(null);
    setDraft(null);
    setError('');
  };
  const unavailable = textAvailabilityIssue(state);
  const allTexts = activeLegs.flatMap(wing => getStencilTexts(wing, wing.id).map(item => ({ legId: wing.id, config: item })));
  const selectedFont = STENCIL_FONTS.find(font => font.id === (config?.font ?? 'pixel'))!;

  if (unavailable) return <div className="dimension-fields">
    <p role="status" className="step-intro">{unavailable}</p>
    {allTexts.length > 0 && <button type="button" className="btn-secondary" onClick={() => {
      let next = state;
      for (const item of allTexts) next = applyStencilText(next, item.legId, null, item.config.id);
      onChange(next);
    }}>Supprimer les textes incompatibles</button>}
  </div>;

  return <div className="dimension-fields">
    <p className="step-intro">Ajoutez plusieurs textes découpés, puis sélectionnez un bloc pour le modifier ou le supprimer.</p>
    <div className="text-block-manager" role="group" aria-label="Blocs de texte de la pièce">
      <div className="text-block-list">
        {allTexts.map(({ legId: itemLeg, config: item }, index) => {
          const id = item.id ?? `legacy-${itemLeg}`;
          const active = selection?.id === id && selection.legId === itemLeg;
          return <div key={`${itemLeg}-${id}`} className={`text-block-row${active ? ' is-selected' : ''}`}>
            <button type="button" className="text-block-select" aria-pressed={active} onClick={() => selectBlock(itemLeg, item)}>
              <span className="text-block-index">{index + 1}</span><span className="text-block-name">{item.text || 'Texte sans contenu'}</span><small>Aile {itemLeg} · {item.height} mm</small>
            </button>
            <button type="button" className="text-block-delete" aria-label={`Supprimer le texte ${item.text}`} onClick={() => {
              onChange(applyStencilText(state, itemLeg, null, id));
              if (active) { setSelection(null); setDraft(null); }
            }}>Supprimer</button>
          </div>;
        })}
      </div>
      <button type="button" className="btn-secondary" onClick={() => startNew()}>＋ Ajouter un texte</button>
    </div>

    {config && <>
      {state.bendCount > 0 && <label>Aile du texte <select value={legId} onChange={event => {
        const targetId = event.target.value;
        if (!config.text.trim()) { setSelection({ legId: targetId, id: config.id ?? newId() }); setDraft({ ...config, x: state.legs.find(item => item.id === targetId)!.length / 2 }); return; }
        try {
          const target = state.legs.find(item => item.id === targetId)!;
          const base = sourceLeg && sourceLeg !== legId ? applyStencilText(state, sourceLeg, null, config.id) : state;
          const moved = fitStencilText(base, targetId, { ...config, x: target.length / 2, y: state.width / 2 });
          setSourceLeg(sourceLeg ?? legId);
          setSelection({ legId: targetId, id: moved.id ?? '' }); setDraft(moved); setError('');
        } catch (failure) { setError((failure as Error).message); }
      }}>{activeLegs.map(item => <option key={item.id} value={item.id}>Aile {item.id}</option>)}</select></label>}
      <fieldset>
        <legend className="mb-2">Police du texte</legend>
        <StencilFontPicker value={selectedFont.id} text={config.text} thickness={state.thickness} onChange={font => update({ font, height: Math.max(config.height, textMinimumHeight(state.thickness, font)) })} />
        <p id="stencil-font-description" className="step-intro">{selectedFont.description}</p>
        {selectedFont.id === 'stencil-butler' && <a href="https://www.fabiandesmet.com" target="_blank" rel="noreferrer" className="step-intro underline">Butler par Fabian De Smet · site officiel</a>}
      </fieldset>
      <label htmlFor="stencil-text">Votre texte</label>
      <input id="stencil-text" type="text" maxLength={16} value={config.text} placeholder="EX. : A12" onChange={event => update({ text: event.target.value })} className="w-full rounded border border-hardware-border bg-hardware-bg p-3" />
      {cells.length > 0 && <svg viewBox={`${Math.min(...cells.map(c => c.dist - (c.length ?? c.diam!) / 2)) - 2} ${Math.min(...cells.map(c => c.offset - (c.width ?? c.diam!) / 2)) - 2} ${Math.max(...cells.map(c => c.dist + (c.length ?? c.diam!) / 2)) - Math.min(...cells.map(c => c.dist - (c.length ?? c.diam!) / 2)) + 4} ${Math.max(...cells.map(c => c.offset + (c.width ?? c.diam!) / 2)) - Math.min(...cells.map(c => c.offset - (c.width ?? c.diam!) / 2)) + 4}`} className="h-20 w-full" aria-label="Aperçu du texte stencil">
        <g fill="#e83c69">{cells.map((cell, i) => <TextCutout key={i} cut={cell} />)}</g>
      </svg>}
      <p className="step-intro">Cliquez sur la vue à plat pour placer le centre du bloc, ou faites glisser le texte. Les flèches du clavier déplacent le bloc de 1 mm.</p>
      <DimensionField id="text-height" label="Hauteur du texte" value={config.height} min={textMinimumHeight(state.thickness, config.font)} max={1000} onChange={height => update({ height })} />
      <button type="button" className="btn-secondary" disabled={config.height === textMinimumHeight(state.thickness, config.font)} onClick={() => update({ height: textMinimumHeight(state.thickness, config.font) })}>Réduire à la taille minimale</button>
      <DimensionField id="text-x" label="Position X du centre" value={config.x} min={0} max={leg.length} onChange={x => update({ x })} />
      <DimensionField id="text-y" label="Position Y du centre" value={config.y} min={0} max={state.width} onChange={y => update({ y })} />
      <DimensionField id="text-rotation" label="Rotation du texte" unit="°" value={normalizeTextRotation(config.rotation)} min={0} max={360} onChange={rotation => update({ rotation: normalizeTextRotation(rotation) })} />
      <p className="step-intro">Tour complet : 0°, 45°, 90°… 315°. La poignée près d’un coin tourne librement ; Maj accroche les angles à 45°.</p>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary" onClick={() => update({ x: leg.length / 2, y: state.width / 2 })}>Centrer</button>
        <button type="button" className="btn-secondary" onClick={() => update({ rotation: normalizeTextRotation(config.rotation - 45) })}>↶ −45°</button>
        <button type="button" className="btn-secondary" onClick={() => update({ rotation: normalizeTextRotation(config.rotation + 45) })}>↻ +45°</button>
      </div>
      <p className="step-intro">Minimum {textMinimumHeight(state.thickness, config.font)} mm. Les ponts et découpes sont adaptés à l’épaisseur ; validation atelier nécessaire.</p>
      {(message || error) && <p className="step-intro" role="alert">{message || error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={!candidate} onClick={() => { if (candidate) { onChange(candidate); setSourceLeg(legId); setDraft(null); setError(''); } }}>Valider ce texte</button>
        <button type="button" className="btn-secondary" onClick={deleteBlock}>Supprimer ce texte</button>
      </div>
    </>}
    {!config && allTexts.length === 0 && <p className="step-intro">Aucun texte pour le moment. Ajoutez un bloc pour commencer.</p>}
  </div>;
}
