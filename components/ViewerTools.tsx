import React, { useId, useRef, useState } from 'react';
import { Box, RotateCcw, Sparkles, Ruler, Info, Wrench } from 'lucide-react';

export default function ViewerTools({ realistic, isOrthographic, showDimensions, showDimensionInfo, onRealistic, onRecenter, onIsometric, onDimensions, onDimensionInfo }: {
  realistic: boolean; isOrthographic: boolean; showDimensions: boolean; showDimensionInfo: boolean;
  onRealistic: () => void; onRecenter: () => void; onIsometric: () => void; onDimensions: () => void; onDimensionInfo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const actions = [
    { label: 'Rendu réaliste', Icon: Sparkles, active: realistic, onClick: onRealistic },
    { label: 'Recentrer la pièce', Icon: RotateCcw, active: undefined, onClick: onRecenter },
    { label: 'Vue isométrique', Icon: Box, active: isOrthographic, onClick: onIsometric },
    { label: 'Lignes de cote', Icon: Ruler, active: showDimensions, onClick: onDimensions },
    { label: 'Informations de cotation', Icon: Info, active: showDimensionInfo, onClick: onDimensionInfo },
  ];
  return <div className={`viewer-tool-rail ${open ? 'is-open' : ''}`} onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="viewer-tool-trigger" aria-label={open ? 'Fermer les outils du visualiseur' : 'Ouvrir les outils du visualiseur'} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <Wrench size={20} className={open ? 'is-turned' : ''} /></button>
    <div id={id} className={`viewer-tool-items ${open ? 'is-visible' : ''}`} aria-hidden={!open} inert={!open}>
      {actions.map(({ label, Icon, active, onClick }, index) => <button key={label} type="button" className={`viewer-tool ${active ? 'is-active' : ''}`}
        style={{ '--tool-index': index } as React.CSSProperties} aria-label={label} aria-pressed={active} data-tooltip={label} onClick={onClick}><Icon size={19} /></button>)}
    </div>
  </div>;
}
