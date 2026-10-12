import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function DimensionNumberInput({ id, label, value, min, max, step = 1, onCommit, onFocus, onBlur, className = '' }: {
  id: string; label: string; value: number; min: number; max: number; step?: number;
  onCommit: (value: number) => void; onFocus?: () => void; onBlur?: () => void; className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) { setDraft(String(value)); return; }
    const next = Math.max(min, Math.min(max, Math.round(parsed / step) * step));
    onCommit(next);
    setDraft(String(next));
  };
  return <input id={id} type="number" inputMode={step < 1 ? 'decimal' : 'numeric'} min={min} max={max} step={step}
    value={editing ? draft : String(value)} aria-label={label} className={className}
    onChange={event => setDraft(event.currentTarget.value)} onFocus={() => { setEditing(true); setDraft(String(value)); onFocus?.(); }}
    onBlur={() => { commit(); setEditing(false); onBlur?.(); }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value)); } }} />;
}

export function SignedAngleInput({ bendId, value, onCommit, onFocus }: {
  bendId: string; value: number; onCommit: (value: number) => void; onFocus?: () => void;
}) {
  return <div className="number-unit angle-number-field">
    <DimensionNumberInput id={`bend-angle-${bendId}`} label={`Saisir l’angle du pli ${bendId} en degrés`}
      value={value} min={-165} max={165} onFocus={onFocus}
      onCommit={next => onCommit(Math.abs(next) < 15 ? (next < 0 ? -15 : 15) : next)} />
    <span aria-hidden="true">°</span>
  </div>;
}

export function WorkflowHeading({ number, title, open, collapsible = false, onClick }: {
  number: number; title: string; hint?: string; open: boolean; collapsible?: boolean; onClick: () => void;
}) {
  const content = <><span className="workflow-number">{String(number).padStart(2, '0')}</span>
    <strong>{title}</strong>{collapsible && <ChevronDown className="workflow-chevron" size={16} aria-hidden="true" />}</>;
  return collapsible
    ? <button type="button" className={`workflow-heading ${open ? 'is-open' : ''}`} onClick={onClick} aria-expanded={open}>{content}</button>
    : <h2 className="workflow-heading is-open">{content}</h2>;
}
