import { useEffect, useMemo, useRef, useState } from 'react';
import { applyStencilText, fitStencilText, stencilCells, textMinimumHeight, textAvailabilityIssue, STENCIL_FONTS, type StencilText } from '../stencilText';
import type { SheetMetalState } from '../sheetGeometry';
import { DimensionField } from './DimensionControls';
import TextCutout from './TextCutout';
import StencilFontPicker from './StencilFontPicker';

export default function TextControls({ state, onChange, onDraftChange, placement }: { state: SheetMetalState; onChange: (next: SheetMetalState) => void;
  onDraftChange: (value: { legId: string; config: StencilText }) => void; placement: { legId: string; x: number; y: number; height?: number; rotation?: 0 | 90 } | null }) {
  const [legId, setLegId] = useState('A');
  const leg = state.legs.find(l => l.id === legId) ?? state.legs[0];
  // Start with the compact cutting design at its safe minimum, while keeping
  // saved projects (including their deliberately larger sizes) untouched.
  const defaults = (): StencilText => leg.cutText ?? { text: '', font: 'stencil-sign', height: textMinimumHeight(state.thickness, 'stencil-sign'), x: leg.length / 2, y: state.width / 2, rotation: 0 };
  const [draft, setDraft] = useState<StencilText>(defaults);
  const [sourceLeg, setSourceLeg] = useState<string | null>(leg.cutText ? leg.id : null);
  const [error, setError] = useState('');
  const consumedPlacement = useRef<typeof placement>(null);
  useEffect(() => { onDraftChange({ legId, config: draft }); }, [legId, draft, onDraftChange]);
  useEffect(() => {
    // Placements are one-shot events; never replay them after a rotation or commit.
    if (!placement || placement === consumedPlacement.current) return;
    consumedPlacement.current = placement;
    const target = placement.legId;
    if (target !== legId && target !== sourceLeg && state.legs.find(l => l.id === target)?.cutText) {
      setError('Cette aile contient déjà un texte.'); return;
    }
    setLegId(target);
    setDraft(value => {
      const { legId: _wing, ...patch } = placement;
      const candidate = { ...value, ...patch };
      try { if (candidate.text.trim()) applyStencilText(state, target, candidate); return candidate; }
      catch { return value; }
    });
  }, [placement, legId, state]);
  useEffect(() => {
    if (!state.legs.slice(0, state.bendCount + 1).some(wing => wing.id === legId)) {
      setLegId('A');
      setSourceLeg(state.legs[0].cutText ? 'A' : null);
      setDraft(state.legs[0].cutText ?? { text: '', font: 'stencil-sign', height: textMinimumHeight(state.thickness, 'stencil-sign'), x: state.legs[0].length / 2, y: state.width / 2, rotation: 0 });
    }
  }, [state, legId]);
  // The flat SVG previews drafts. Rebuild the expensive 3D cutouts only on
  // confirmation, not on every pointer movement behind the opaque editor.
  const { candidate, message } = useMemo(() => {
    try {
      const base = sourceLeg && sourceLeg !== legId ? applyStencilText(state, sourceLeg, null) : state;
      return { candidate: draft.text.trim() ? applyStencilText(base, legId, draft) : null, message: '' };
    }
    catch (e) { return { candidate: null, message: (e as Error).message }; }
  }, [state, legId, draft, sourceLeg]);
  const cells = useMemo(() => {
    try { return stencilCells({ ...draft, x: 0, y: 0 }, state.thickness); } catch { return []; }
  // Position changes only translate the existing outlines.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.text, draft.font, draft.height, draft.rotation, state.thickness]);
  const update = (patch: Partial<StencilText>) => {
    try {
      const proposed = { ...draft, ...patch };
      // Numeric positioning is exact; size/font/content edits may fit the
      // whole block, but a rejected edit never becomes a visible draft.
      if ('x' in patch || 'y' in patch) {
        if (proposed.text.trim()) applyStencilText(state, legId, proposed);
        setDraft(proposed);
      } else setDraft(fitStencilText(state, legId, proposed));
      setError('');
    } catch (failure) { setError((failure as Error).message); }
  };
  const unavailable = textAvailabilityIssue(state);
  const selectedFont = STENCIL_FONTS.find(font => font.id === (draft.font ?? 'pixel'))!;
  if (unavailable) return <div className="dimension-fields">
    <p role="status" className="step-intro">{unavailable}</p>
    {state.legs.some(wing => wing.cutText) && <button type="button" className="btn-secondary" onClick={() => {
      let next = state;
      for (const wing of state.legs.slice(0, state.bendCount + 1)) if (wing.cutText) next = applyStencilText(next, wing.id, null);
      onChange(next); setDraft(value => ({ ...value, text: '' }));
    }}>Supprimer les textes incompatibles</button>}
  </div>;
  return <div className="dimension-fields">
    <p className="step-intro">Texte découpé à ponts intégrés. Facultatif.</p>
    <fieldset>
      <legend className="mb-2">Police du texte</legend>
      <StencilFontPicker value={selectedFont.id} text={draft.text} onChange={font => update({ font, height: Math.max(draft.height, textMinimumHeight(state.thickness, font)) })} />
      <p id="stencil-font-description" className="step-intro">{selectedFont.description}</p>
      {selectedFont.id === 'stencil-butler' && <a href="https://www.fabiandesmet.com" target="_blank" rel="noreferrer" className="step-intro underline">Butler par Fabian De Smet · site officiel</a>}
    </fieldset>
    {state.bendCount > 0 && <label>Aile du texte <select value={legId} onChange={event => {
      const id = event.target.value, next = state.legs.find(l => l.id === id)!;
      try {
        if (draft.text.trim()) {
          if (next.cutText && id !== sourceLeg) throw new Error('Cette aile contient déjà un texte. Supprimez-le avant de déplacer ce bloc.');
          const transferred = fitStencilText(state, id, { ...draft, x: next.length / 2, y: state.width / 2 });
          setDraft(transferred);
        } else {
          setDraft(next.cutText ?? { ...draft, text: '', x: next.length / 2, y: state.width / 2 });
          setSourceLeg(next.cutText ? id : null);
        }
        setLegId(id); setError('');
      } catch (failure) { setError((failure as Error).message); }
    }}>{state.legs.slice(0, state.bendCount + 1).map(l => <option key={l.id} value={l.id}>Aile {l.id}</option>)}</select></label>}
    {state.bendCount > 0 && <p className="step-intro">Choisissez une autre aile pour y déplacer ce bloc, puis validez le texte.</p>}
    <label htmlFor="stencil-text">Votre texte</label>
    <input id="stencil-text" type="text" maxLength={16} value={draft.text} placeholder="EX. : A12" onChange={event => update({ text: event.target.value })} className="w-full rounded border border-hardware-border bg-hardware-bg p-3" />
    {cells.length > 0 && <svg viewBox={`${Math.min(...cells.map(c => c.dist - (c.length ?? c.diam!) / 2)) - 2} ${Math.min(...cells.map(c => c.offset - (c.width ?? c.diam!) / 2)) - 2} ${Math.max(...cells.map(c => c.dist + (c.length ?? c.diam!) / 2)) - Math.min(...cells.map(c => c.dist - (c.length ?? c.diam!) / 2)) + 4} ${Math.max(...cells.map(c => c.offset + (c.width ?? c.diam!) / 2)) - Math.min(...cells.map(c => c.offset - (c.width ?? c.diam!) / 2)) + 4}`} className="h-20 w-full" aria-label="Aperçu du texte stencil">
      <g fill="#e83c69">{cells.map((c, i) => <TextCutout key={i} cut={c} />)}</g>
    </svg>}
    <p className="step-intro">Cliquez sur la vue à plat pour placer le centre du bloc, ou faites glisser le texte. Les flèches du clavier déplacent le bloc de 1 mm.</p>
    <DimensionField id="text-height" label="Hauteur du texte" value={draft.height} min={textMinimumHeight(state.thickness, draft.font)} max={1000} onChange={height => update({ height })} />
    <DimensionField id="text-x" label="Position X du centre" value={draft.x} min={0} max={leg.length} onChange={x => update({ x })} />
    <DimensionField id="text-y" label="Position Y du centre" value={draft.y} min={0} max={state.width} onChange={y => update({ y })} />
    <label>Orientation <select value={draft.rotation} onChange={event => update({ rotation: Number(event.target.value) as 0 | 90 })}><option value={0}>Horizontale</option><option value={90}>Verticale · 90°</option></select></label>
    <p className="step-intro">Deux orientations uniquement : horizontale ou verticale. Chaque rotation conserve les marges et évite les plis.</p>
    <div className="flex gap-2">
      <button type="button" className="btn-secondary" disabled={!draft.text.trim()} onClick={() => update({ x: leg.length / 2, y: state.width / 2 })}>Centrer</button>
      <button type="button" className="btn-secondary" disabled={!draft.text.trim()} onClick={() => update({ rotation: draft.rotation === 0 ? 90 : 0 })}>Tourner de 90°</button>
    </div>
    <p className="step-intro">Minimum {textMinimumHeight(state.thickness, draft.font)} mm de haut. Les ponts et les découpes sont adaptés à l’épaisseur. Règles prudentes, à confirmer par l’atelier.</p>
    {(message || error) && <p className="step-intro" role="alert">{message || error}</p>}
    <button type="button" className="btn-primary" disabled={!candidate} onClick={() => { if (candidate) { onChange(candidate); setSourceLeg(legId); } }}>Valider le texte</button>
    {(leg.cutText || draft.text.trim()) && <button type="button" className="btn-secondary" onClick={() => {
      let next = applyStencilText(state, legId, null);
      if (sourceLeg && sourceLeg !== legId) next = applyStencilText(next, sourceLeg, null);
      onChange(next); setDraft({ ...draft, text: '' }); setSourceLeg(null);
    }}>Supprimer le texte</button>}
    {leg.cutText && <button type="button" className="btn-secondary" onClick={() => { setDraft(leg.cutText!); setError(''); }}>Annuler les modifications</button>}
  </div>;
}
