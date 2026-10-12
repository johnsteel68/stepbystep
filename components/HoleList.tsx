import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { explicitHoles } from '../holeEditing';
import type { SheetMetalState } from '../sheetGeometry';

const names = { round: 'Rond', square: 'Carré', rect: 'Rectangle', oblong: 'Oblong', octagonal: 'Octogonal' };
export default function HoleList({ state, onEdit, onDelete }: {
  state: SheetMetalState; onEdit: (legId: string, index: number) => void; onDelete: (legId: string, index: number) => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return <div className="hole-list">{state.legs.slice(0, state.bendCount + 1).map(leg => {
    const holes = explicitHoles(leg, state);
    const count = holes.filter(hole => !hole.textCutout).length;
    return count > 0 && <section key={leg.id} aria-label={`Trous de l’aile ${leg.id}`}>
      <h3>Aile {leg.id} <span>{count} trou{count > 1 ? 's' : ''}</span></h3>
      {holes.map((hole, index) => {
        if (hole.textCutout) return null;
        const key = `${leg.id}-${index}`;
        return <div key={key} className="hole-list-item">
          <button type="button" className="hole-list-edit" onClick={() => onEdit(leg.id, index)} aria-label={`Modifier le trou ${index + 1} de l’aile ${leg.id}`}>
            <span><strong>{index + 1}. {names[hole.shape]}</strong><small>X {Math.round(hole.dist)} · Y {Math.round(hole.offset)} mm</small></span><Pencil size={16} />
          </button>
          <button type="button" className="hole-list-delete" aria-label={`Supprimer le trou ${index + 1} de l’aile ${leg.id}`} onClick={() => setConfirm(key)}><Trash2 size={17} /></button>
          {confirm === key && <div className="hole-delete-confirm"><span>Supprimer ce trou ?</span><button type="button" onClick={() => setConfirm(null)}>Garder</button><button type="button" onClick={() => { onDelete(leg.id, index); setConfirm(null); }}>Supprimer</button></div>}
        </div>;
      })}
    </section>;
  })}</div>;
}
