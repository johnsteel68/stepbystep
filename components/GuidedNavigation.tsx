import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { workflowPageStatus, type WorkflowPage } from '../workflow';
import type { FeasibilityCheckItem } from '../sheetGeometry';

export default function GuidedNavigation({ pages, current, onNavigate, checks, locked = false, lockMessage }: {
  pages: WorkflowPage[]; current: number; onNavigate: (page: number) => void; checks: FeasibilityCheckItem[]; locked?: boolean; lockMessage?: string;
}) {
  const last = current === pages.length;
  return <nav className="guided-footer" aria-label="Navigation des étapes">
    <div className="guided-progress" role="progressbar" aria-label="Avancement de la configuration" aria-valuemin={1} aria-valuemax={pages.length} aria-valuenow={current}>
      {pages.map((page, index) => {
        const status = workflowPageStatus(page, index, current, checks);
        const statusLabel = status === 'current' ? 'en cours' : status === 'complete' ? 'validée' : status === 'problem' ? 'à corriger' : 'à venir';
        return <span key={`${page.section}-${index}`} className={`is-${status}`} title={`${page.title} · ${statusLabel}`} />;
      })}
    </div>
    <div className="guided-navigation-row">
      <button type="button" className="navigation-back" disabled={current === 1 || locked} onClick={() => onNavigate(current - 1)} aria-label="Étape précédente"><ArrowLeft size={18} /></button>
      <div className="navigation-status"><span>{String(current).padStart(2, '0')} <span>/ {String(pages.length).padStart(2, '0')}</span></span>
        <small>{locked ? lockMessage ?? 'Confirmez ou annulez le trou' : last ? 'Export & commande' : pages[current]?.title}</small></div>
      <button type="button" className="navigation-next" disabled={last || locked} onClick={() => onNavigate(current + 1)} aria-label="Étape suivante">
        <span>{last ? 'Terminé' : 'Continuer'}</span>{last ? <Check size={17} /> : <ArrowRight size={17} />}
      </button>
    </div>
  </nav>;
}
