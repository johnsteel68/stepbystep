import React, { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Expand, QrCode, X } from 'lucide-react';
import { createProjectLink } from '../projectSharing';
import type { SheetMetalState } from '../sheetGeometry';
import type { GrainDirection } from '../technicalDrawing';

const desktop = '(min-width: 861px) and (pointer: fine)';
const subscribe = (callback: () => void) => {
  const query = window.matchMedia(desktop);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};
const getSnapshot = () => window.matchMedia(desktop).matches;
const getServerSnapshot = () => false;

function ShareControls({ state, grainDirection, locked }: { state: SheetMetalState; grainDirection: GrainDirection; locked: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const project = useMemo(() => {
    try { return { link: createProjectLink(state, grainDirection, window.location.href), error: '' }; }
    catch { return { link: '', error: 'Terminez les réglages pour partager la pièce.' }; }
  }, [state, grainDirection]);
  const qrAvailable = project.link.length > 0 && project.link.length <= 2200;
  useEffect(() => { setCopied(false); setManualCopy(false); }, [project.link]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => { if (manualCopy) { fallback.current?.focus(); fallback.current?.select(); } }, [manualCopy]);
  useEffect(() => { if (locked) dialog.current?.close(); }, [locked]);
  async function copyLink() {
    try { await navigator.clipboard.writeText(project.link); setCopied(true); }
    catch { dialog.current?.showModal(); setManualCopy(true); }
  }
  return <>
    <section className="project-share" aria-label="Partager le projet">
      <button type="button" className="project-share-code" disabled={locked || !project.link} onClick={() => dialog.current?.showModal()} aria-label="Agrandir le QR code du projet" title="Agrandir le QR code">
        {!locked && qrAvailable ? <QRCodeSVG value={project.link} size={112} marginSize={4} level="M" boostLevel={false} title="Lien vers cette configuration" /> : <QrCode size={38} aria-hidden="true" />}
        {!locked && <Expand size={12} className="project-share-expand" aria-hidden="true" />}
      </button>
      <div className="project-share-copy">
        <strong>Partager la pièce</strong>
        <p>{locked ? 'Confirmez ou annulez le trou.' : 'Avec un proche ou le service client.'}</p>
        <button type="button" onClick={copyLink} disabled={locked || !project.link}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? 'Lien copié' : 'Copier le lien'}
        </button>
        <span className="sr-only" role="status">{copied ? 'Le lien du projet a été copié.' : project.error}</span>
      </div>
    </section>
    <dialog ref={dialog} className="project-share-dialog" aria-labelledby="project-share-title" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <button type="button" className="project-share-close" aria-label="Fermer le partage" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button>
      <h2 id="project-share-title">Votre pièce, à partager</h2>
      <p>Scannez pour ouvrir une copie de cette configuration.</p>
      {qrAvailable ? <QRCodeSVG value={project.link} size={304} marginSize={4} level="M" boostLevel={false} title="QR code du projet" /> : <p>Cette pièce est trop détaillée pour un QR code. Partagez-la en copiant le lien.</p>}
      <button type="button" className="project-share-copy-button" onClick={copyLink}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? 'Lien copié' : 'Copier le lien'}</button>
      <label className="project-share-manual">{manualCopy ? 'Copiez ce lien avec Ctrl+C ou ⌘C' : 'Lien du projet'}<input ref={fallback} readOnly value={project.link} onFocus={event => event.currentTarget.select()} /></label>
      <small>Le lien contient les réglages actuels, pas les modifications futures. Le destinataire doit avoir accès au site. Aucun envoi automatique au service client.</small>
    </dialog>
  </>;
}

export default memo(function ProjectShare(props: { state: SheetMetalState; grainDirection: GrainDirection; locked: boolean }) {
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return isDesktop ? <ShareControls {...props} /> : null;
});
