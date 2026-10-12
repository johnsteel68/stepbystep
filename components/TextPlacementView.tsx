import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SheetMetalState } from '../sheetGeometry';
import { blankFrame } from '../formedBlank';
import { stencilCells, createStencilPlacementValidator, applyStencilText, fitStencilText, textMinimumHeight, type StencilText } from '../stencilText';
import { explicitHoles } from '../holeEditing';
import TextCutout from './TextCutout';

/** One flat datum for clicking, dragging and numeric fields. Terminal-wing X
 * is reversed, exactly as in applyStencilText and the export geometry. */
export default function TextPlacementView({ state, draft: externalDraft, onMove }: {
  state: SheetMetalState; draft: { legId: string; config: StencilText } | null;
  onMove: (position: { legId: string; x: number; y: number; height?: number; rotation?: 0 | 90 }) => void;
}) {
  // Pointer previews belong to this editor, not the application state. Publish
  // one final, validated placement when the gesture ends, avoiding sidebar,
  // feasibility and viewer updates for every painted frame.
  const [gestureDraft, setGestureDraft] = useState<typeof externalDraft>(null);
  const gesture = useRef<typeof externalDraft>(null);
  const dragging = useRef(false);
  const draft = gestureDraft ?? externalDraft;
  useEffect(() => {
    if (!dragging.current) { setGestureDraft(null); gesture.current = null; }
  }, [externalDraft, state]);
  const svg = useRef<SVGSVGElement>(null);
  const cutoutMask = useId().replace(/:/g, '');
  const grab = useRef({ x: 0, y: 0 });
  const resize = useRef<{ radius: number; height: number } | null>(null);
  const animationFrame = useRef<number | null>(null);
  const latestPointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
  }, []);
  const [zoom, setZoom] = useState(1);
  // A zoomed viewport must not chase the moving selection: that changes the
  // pointer-to-metal mapping while the user is dragging or resizing.
  const [viewportCenter, setViewportCenter] = useState<{ x: number; y: number } | null>(null);
  const [placementIssue, setPlacementIssue] = useState('');
  const legs = state.legs.slice(0, state.bendCount + 1);
  const total = legs.reduce((sum, leg) => sum + leg.length, 0);
  const frame = blankFrame({ ...state, bendCount: 0, legs: [{ ...legs[0], length: total }], blankLength: state.blankShape ? state.blankLength : total });
  const width = frame.width, length = frame.length;
  const index = Math.max(0, legs.findIndex(leg => leg.id === draft?.legId));
  const leg = legs[index];
  const start = legs.slice(0, index).reduce((sum, item) => sum + item.length, 0);
  const reverse = index === state.bendCount;
  // Translation does not change letter contours: retain them while dragging.
  const { cuts, issue } = useMemo(() => {
    try { return { cuts: draft?.config.text.trim() ? stencilCells({ ...draft.config, x: 0, y: 0 }, state.thickness) : [], issue: '' }; }
    catch (error) { return { cuts: [], issue: (error as Error).message }; }
  // Only geometry-changing fields invalidate the cached outlines.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.config.text, draft?.config.font, draft?.config.height, draft?.config.rotation, state.thickness]);
  const validatePlacement = useMemo(() => {
    if (!draft?.config.text.trim()) return null;
    try { return createStencilPlacementValidator(state, draft.legId, draft.config); } catch { return null; }
  // Translating does not invalidate the prepared geometry or manufacturing rules.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, draft?.legId, draft?.config.text, draft?.config.font, draft?.config.height, draft?.config.rotation]);
  const cx = start + (reverse ? leg.length - (draft?.config.x ?? leg.length / 2) : draft?.config.x ?? leg.length / 2);
  const cy = draft?.config.y ?? width / 2;
  const pad = Math.max(length, width) * .08;
  const boxWidth = (length + pad * 2) / zoom, boxHeight = (width + pad * 2) / zoom;
  const bounds = cuts.length ? {
    left: Math.min(...cuts.map(c => c.dist - (c.length ?? c.diam!) / 2)),
    right: Math.max(...cuts.map(c => c.dist + (c.length ?? c.diam!) / 2)),
    top: Math.min(...cuts.map(c => c.offset - (c.width ?? c.diam!) / 2)),
    bottom: Math.max(...cuts.map(c => c.offset + (c.width ?? c.diam!) / 2)),
  } : null;
  function place(x: number, y: number, targetId = draft?.legId) {
    if (!draft || !bounds) return;
    if (!targetId) return;
    const next = { ...draft.config, x, y };
    // Dragging and keyboard navigation obey the same contour/margin checks
    // as committing/exporting: never visually move the block outside metal.
    try {
      if (targetId !== draft.legId) {
        if (state.legs.find(l => l.id === targetId)?.cutText && targetId !== externalDraft?.legId) return;
        applyStencilText(state, targetId, next);
      } else { if (!validatePlacement) return; validatePlacement(next); }
    }
    catch (error) { setPlacementIssue((error as Error).message); return; }
    setPlacementIssue('');
    if (dragging.current) {
      gesture.current = { legId: targetId, config: next };
      setGestureDraft(gesture.current);
    } else onMove({ legId: targetId, x, y });
  }
  function move(clientX: number, clientY: number) {
    if (!draft || !svg.current) return;
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return;
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    if (resize.current) {
      const height = Math.max(textMinimumHeight(state.thickness, draft.config.font), Math.round(resize.current.height * Math.hypot(p.x - cx, p.y - cy) / resize.current.radius * 10) / 10);
      const next = { ...draft.config, height };
      try {
        applyStencilText(state, draft.legId, next);
        gesture.current = { legId: draft.legId, config: next };
        setGestureDraft(gesture.current);
        setPlacementIssue('');
      } catch (error) { setPlacementIssue((error as Error).message); /* Keep the last valid size at the edge. */ }
      return;
    }
    const x = p.x - grab.current.x, y = p.y - grab.current.y;
    let targetStart = 0;
    const targetIndex = legs.findIndex(wing => {
      if (x >= targetStart && x <= targetStart + wing.length) return true;
      targetStart += wing.length; return false;
    });
    if (targetIndex < 0) return;
    const target = legs[targetIndex];
    const localX = targetIndex === state.bendCount ? target.length - (x - targetStart) : x - targetStart;
    place(Math.round(localX * 10) / 10, Math.round(y * 10) / 10, target.id);
  }
  function flushPointer() {
    const point = latestPointer.current;
    latestPointer.current = null;
    if (point) move(point.x, point.y);
  }
  return <div className="absolute inset-0 z-20 flex flex-col bg-slate-100 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
      <span>Placement du texte · vue à plat {state.bendCount > 0 ? `· aile ${leg.id}` : ''}</span>
      <div className="flex gap-2">
        <button type="button" className="rounded border bg-white px-3 py-2" disabled={!draft?.config.text.trim()} onClick={() => {
          if (!draft) return;
          try { const config = fitStencilText(state, draft.legId, { ...draft.config, x: leg.length / 2, y: width / 2 }); onMove({ legId: draft.legId, ...config }); } catch {}
        }}>Centrer</button>
        <button type="button" className="rounded border bg-white px-3 py-2" disabled={!draft?.config.text.trim()} onClick={() => {
          if (!draft) return;
          try { const config = fitStencilText(state, draft.legId, { ...draft.config, rotation: draft.config.rotation === 0 ? 90 : 0 }); onMove({ legId: draft.legId, ...config }); } catch {}
        }}>↻ 90°</button>
        <button type="button" className="rounded border bg-white px-3 py-2" aria-label="Dézoomer le texte" onClick={() => setZoom(z => Math.max(1, z / 1.5))}>−</button>
        <button type="button" className="rounded border bg-white px-3 py-2" onClick={() => { setZoom(1); setViewportCenter(null); }}>Vue entière</button>
        <button type="button" className="rounded border bg-white px-3 py-2" aria-label="Zoomer sur le texte" onClick={() => { setViewportCenter({ x: cx, y: cy }); setZoom(z => Math.min(12, z * 1.5)); }}>+</button>
      </div>
    </div>
    <svg ref={svg} className="min-h-0 flex-1 touch-none" viewBox={`${(zoom === 1 ? length / 2 : viewportCenter?.x ?? cx) - boxWidth / 2} ${(zoom === 1 ? width / 2 : viewportCenter?.y ?? cy) - boxHeight / 2} ${boxWidth} ${boxHeight}`}
      aria-label="Pièce à plat : cliquez pour placer le bloc texte" onPointerDown={event => {
        dragging.current = true;
        gesture.current = draft;
        const matrix = svg.current?.getScreenCTM();
        const point = matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
        const insideBlock = (event.target as Element).closest('[data-text-block]');
        resize.current = (event.target as Element).closest('[data-text-resize]') && point && draft
          ? { radius: Math.max(.1, Math.hypot(point.x - cx, point.y - cy)), height: draft.config.height } : null;
        grab.current = insideBlock && point ? { x: point.x - cx, y: point.y - cy } : { x: 0, y: 0 };
        event.currentTarget.setPointerCapture(event.pointerId); move(event.clientX, event.clientY);
      }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        latestPointer.current = { x: event.clientX, y: event.clientY };
        // Coalesce high-frequency mouse/touch events into one validated move
        // per painted frame, always using the latest pointer coordinates.
        if (animationFrame.current === null) animationFrame.current = requestAnimationFrame(() => {
          animationFrame.current = null;
          flushPointer();
        });
      }}
      onPointerUp={event => {
        if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
        flushPointer();
        resize.current = null;
        dragging.current = false;
        const final = gesture.current;
        if (final) onMove({ legId: final.legId, ...final.config });
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null; latestPointer.current = null; resize.current = null;
        dragging.current = false; gesture.current = null; setGestureDraft(null);
      }}>
      <defs><mask id={cutoutMask} maskUnits="userSpaceOnUse" x={-pad} y={-pad} width={length + pad * 2} height={width + pad * 2}>
        <rect x={-pad} y={-pad} width={length + pad * 2} height={width + pad * 2} fill="white" />
        {/* Punch through the sheet rather than paint letters on it. Keep the
            actual vector contours, including stencil bridges, after saving. */}
        {legs.flatMap((wing, wingIndex) => explicitHoles(wing, state).filter(h => !h.textCutout || wing.id !== draft?.legId).map((h, holeIndex) => {
        const definition = { shape: h.shape ?? wing.holeShape, diam: h.diam ?? wing.holeDiam ?? 5, length: h.length ?? wing.holeLength ?? 25, width: h.width ?? wing.holeWidth ?? 12 };
        const x = legs.slice(0, wingIndex).reduce((sum, item) => sum + item.length, 0) + (wingIndex === state.bendCount ? wing.length - h.dist : h.dist);
        if (h.textCutout) return <g key={`${wingIndex}-${holeIndex}`} transform={`translate(${x},${h.offset})`} fill="black"><TextCutout cut={{ ...h, dist: 0, offset: 0 }} /></g>;
        return definition.shape === 'round' ? <circle key={`${wingIndex}-${holeIndex}`} cx={x} cy={h.offset} r={definition.diam / 2} fill="black" />
          : <rect key={`${wingIndex}-${holeIndex}`} x={x - (definition.shape === 'square' ? definition.diam : definition.length) / 2} y={h.offset - (definition.shape === 'square' ? definition.diam : definition.width) / 2}
            width={definition.shape === 'square' ? definition.diam : definition.length} height={definition.shape === 'square' ? definition.diam : definition.width} fill="black" />;
      }))}
        <g transform={`translate(${cx},${cy})`} fill="black" visibility={issue ? 'hidden' : 'visible'}>{cuts.map((c, i) => <TextCutout key={i} cut={c} />)}</g>
      </mask></defs>
      <polygon points={frame.outline.map(p => `${p.x},${p.y}`).join(' ')} fill="#cbd5e1" stroke="#64748b" strokeWidth={1} vectorEffect="non-scaling-stroke" mask={`url(#${cutoutMask})`} />
      {legs.slice(0, -1).map((_, i) => { const x = legs.slice(0, i + 1).reduce((sum, item) => sum + item.length, 0); return <line key={i} x1={x} x2={x} y1={0} y2={width} stroke="#e83c69" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />; })}
      <g data-text-block transform={`translate(${cx},${cy})`} fill="none" visibility={issue ? 'hidden' : 'visible'}>
        <g stroke="#99294b" strokeWidth={.3}>{cuts.map((c, i) => <TextCutout key={i} cut={c} />)}</g>
        {bounds && <rect x={bounds.left - 2} y={bounds.top - 2} width={bounds.right - bounds.left + 4} height={bounds.bottom - bounds.top + 4}
          fill="transparent" pointerEvents="all" style={{ cursor: 'move' }} stroke={issue ? '#b91c1c' : '#e83c69'} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" tabIndex={0} role="button" aria-label="Déplacer le bloc texte avec les flèches"
          onKeyDown={event => {
            if (!draft || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); const step = event.shiftKey ? 10 : 1;
            const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
            const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
            place(draft.config.x + (reverse ? -dx : dx), draft.config.y + dy);
          }} />}
        {bounds && [[bounds.left - 2, bounds.top - 2], [bounds.right + 2, bounds.top - 2], [bounds.left - 2, bounds.bottom + 2], [bounds.right + 2, bounds.bottom + 2]].map(([x, y], index) => <circle key={index} data-text-resize cx={x} cy={y} r={Math.max(length, width) * .012 / zoom} fill="#e83c69" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: index === 0 || index === 3 ? 'nwse-resize' : 'nesw-resize' }}><title>Glisser pour agrandir ou réduire proportionnellement</title></circle>)}
      </g>
    </svg>
    <p className="text-center text-sm text-slate-700" role="status">{issue || placementIssue || (draft?.config.text ? 'Glisser : déplacer · poignées : taille · ↻ : horizontal / vertical · flèches : 1 mm (Maj : 10 mm). Puis validez.' : 'Saisissez votre texte, puis placez-le sur la pièce.')}</p>
  </div>;
}
