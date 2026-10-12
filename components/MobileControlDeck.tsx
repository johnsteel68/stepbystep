import type { RefObject } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, SlidersHorizontal, Eye } from 'lucide-react';
import { useMobileControlPages, type MobileDockMode } from '../hooks/useMobileControlPages';

interface MobileControlDeckProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  stepKey: string;
  title: string;
  mode: MobileDockMode;
  onModeChange: (mode: MobileDockMode) => void;
}

/** Présentation seule : le calcul des pages et les événements DOM vivent dans le hook. */
export default function MobileControlDeck({
  scrollRef, stepKey, title, mode, onModeChange,
}: MobileControlDeckProps) {
  const { pages, page, navigate } = useMobileControlPages(scrollRef, stepKey, mode);
  return <>
    <div className="mobile-dock-heading">
      <button type="button" className="mobile-dock-title" onClick={() => onModeChange(mode === 'viewer' ? 'compact' : 'viewer')} aria-expanded={mode !== 'viewer'}>
        {mode === 'viewer' ? <SlidersHorizontal size={18} /> : <Eye size={18} />}<span>{mode === 'viewer' ? 'Afficher les réglages' : title}</span>
      </button>
      <button type="button" className="mobile-dock-expand" onClick={() => onModeChange(mode === 'expanded' ? 'compact' : 'expanded')} aria-label={mode === 'expanded' ? 'Réduire les réglages' : 'Agrandir les réglages'}>
        {mode === 'expanded' ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>
    </div>
    {pages.length > 1 && mode !== 'viewer' && <nav className="mobile-page-nav" aria-label="Pages des réglages">
      <button type="button" disabled={page === 0} onClick={() => navigate(page - 1)} aria-label="Réglages précédents"><ChevronLeft size={19} /></button>
      <span role="status">Réglages {page + 1}<span> / {pages.length}</span></span>
      <button type="button" disabled={page === pages.length - 1} onClick={() => navigate(page + 1)} aria-label="Suite des réglages"><span>Suite</span><ChevronRight size={19} /></button>
    </nav>}
  </>;
}
