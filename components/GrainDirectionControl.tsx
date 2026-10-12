import { useId } from 'react';
import { Check } from 'lucide-react';
import type { GrainDirection } from '../technicalDrawing';

/** Native radios keep the two visual choices usable with touch, Tab and arrows. */
export default function GrainDirectionControl({ value, onChange, disabled = false, allowed, blocked = false }: {
  value: GrainDirection; onChange: (value: GrainDirection) => void; disabled?: boolean;
  allowed?: Record<GrainDirection, boolean>; blocked?: boolean;
}) {
  const id = useId();
  return <fieldset className="grain-choice" disabled={disabled} aria-describedby={`${id}-help`}>
    <legend>Sens du brossage</legend>
    <div className="grain-choice-options">
      {(['length', 'width'] as const).map(direction => <label className="grain-choice-option" key={direction}>
        <input type="radio" name={id} value={direction} checked={value === direction} disabled={allowed?.[direction] === false} onChange={() => onChange(direction)} />
        <span className={`grain-choice-surface grain-choice-surface--${direction}`} aria-hidden="true" />
        <span className="grain-choice-copy"><strong>{direction === 'length' ? 'Longueur' : 'Largeur'}</strong>
          <small>{allowed?.[direction] === false ? 'Dimensions incompatibles' : direction === 'length' ? 'Le long des ailes' : 'En travers des ailes'}</small>
        </span>
        <Check className="grain-choice-check" size={16} aria-hidden="true" />
      </label>)}
    </div>
    <p id={`${id}-help`} role={blocked ? 'alert' : undefined}>{blocked ? 'Dimensions trop grandes pour les deux sens : réduisez le développé ou choisissez une autre finition.' : 'Maximum : 2 980 mm dans le sens du brossage, 1 480 mm en travers. Contrôle sur la pièce dépliée.'}</p>
  </fieldset>;
}
