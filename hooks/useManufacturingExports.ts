import { useState } from 'react';
import type { SheetMetalState, SheetMetalFeasibilityReport } from '../sheetGeometry';
import type { GrainDirection } from '../technicalDrawing';
import { uploadStepToDeck } from '../deckUpload';
import { downloadExport, createManufacturingArchive } from '../exportDownload';
import { createProjectLink } from '../projectSharing';

type Options = {
  guided: boolean;
  state: SheetMetalState;
  grainDirection: GrainDirection;
  feasibility: SheetMetalFeasibilityReport;
  setError: (message: string | null) => void;
  setSuccessMsg: (message: string | null) => void;
  setShowFeasibilityModal: (open: boolean) => void;
};

/**
 * Export jobs operate on a frozen part snapshot, not the live editor.
 * Keep heavy WASM/PDF dependencies lazy so none are required at startup.
 * Only this hook owns job status; the editor owns configuration and messages.
 */
export function useManufacturingExports({ state, grainDirection, feasibility, guided, setError, setSuccessMsg, setShowFeasibilityModal }: Options) {
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [sendingToDeck, setSendingToDeck] = useState(false);
  const [readyDeck, setReadyDeck] = useState<{ url: string; pdf: Blob; name: string } | null>(null);

  const createStepExportFile = async (snapshot: SheetMetalState) => {
    const { generateStepFile } = await import('../api');
    const { getExportBaseName } = await import('../technicalDrawing');
    const stepContent = await generateStepFile(snapshot);
    const fileName = `${getExportBaseName(snapshot)}.step`;
    return new File([stepContent], fileName, { type: 'application/step' });
  };

  const createPlan = async (snapshot: SheetMetalState) => {
    // Share exactly the exported snapshot, never the editor after an async job.
    const projectLink = createProjectLink(snapshot, grainDirection, window.location.href);
    const { generateTechnicalDrawing, getExportBaseName } = await import('../technicalDrawing');
    const { captureDrawingViews } = await import('../drawingViews');
    const views = await captureDrawingViews(snapshot, grainDirection);
    return { pdf: generateTechnicalDrawing(snapshot, { grainDirection, views, projectLink }), name: `${getExportBaseName(snapshot)}_Plan.pdf` };
  };

  const handleDownloadPlan = async () => {
    if (guided) {
      setError('Le téléchargement du plan PDF est désactivé en mode guidé.');
      return;
    }
    if (!feasibility.isFeasible) {
      setError('Plan atelier bloqué : corrigez les points de fabricabilité avant de transmettre les cotes.');
      setShowFeasibilityModal(true);
      return;
    }
    setPdfLoading(true); setError(null);
    try {
      const { pdf, name } = await createPlan(structuredClone(state));
      downloadExport(pdf, name);
      setSuccessMsg('Plan technique PDF téléchargé : face de finition, plis, perçages et QR code du projet.');
    } catch (e) {
      console.error(e); setError('Impossible de générer le plan technique PDF.');
    } finally { setPdfLoading(false); }
  };

  // Download STEP
  const handleDownload = async () => {
    if (!feasibility.isFeasible) {
      setError("Export STEP bloqué : la pièce ne respecte pas les critères de fabricabilité atelier. Consultez le rapport d'audit pour corriger.");
      setShowFeasibilityModal(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // OpenCascade/WASM is loaded only when the user actually exports.
      // This keeps the initial editor responsive and avoids paying the STEP
      // generation cost while configuring the part.
      const snapshot = structuredClone(state);
      if (guided) {
        const file = await createStepExportFile(snapshot);
        downloadExport(file, file.name);
        setSuccessMsg('Fichier STEP téléchargé.');
        return;
      }
      const [file, plan] = await Promise.all([createStepExportFile(snapshot), createPlan(snapshot)]);
      downloadExport(await createManufacturingArchive(file, plan.pdf), file.name.replace(/\.step$/i, '_Dossier.zip'));
      setSuccessMsg('Dossier téléchargé : STEP AP214 et plan technique PDF.');
    } catch (e) {
      console.error(e);
      setError('Erreur lors de la génération du dossier STEP + PDF. Le plan PDF seul reste disponible.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendToDeck = async () => {
    if (!feasibility.isFeasible) {
      setError("Envoi vers le deck bloqué : la pièce ne respecte pas les critères de fabricabilité atelier.");
      setShowFeasibilityModal(true);
      return;
    }

    setSendingToDeck(true);
    setError(null);
    setReadyDeck(null);
    let phase: 'preparation' | 'upload' = 'preparation';
    try {
      const snapshot = structuredClone(state);
      if (guided) {
        // Guided ordering has no PDF dependency: a drawing failure must not
        // prevent sending the manufactured STEP to the shop.
        const file = await createStepExportFile(snapshot);
        phase = 'upload';
        const deckUrl = await uploadStepToDeck(file);
        window.location.assign(deckUrl);
        return;
      }
      const [file, plan] = await Promise.all([createStepExportFile(snapshot), createPlan(snapshot)]);
      phase = 'upload';
      const deckUrl = await uploadStepToDeck(file);
      // The deck endpoint analyses one STEP; PDF attachment support is not
      // established. Download the companion plan, then let the user navigate
      // explicitly so an immediate redirect cannot interrupt the download.
      setReadyDeck({ url: deckUrl, ...plan });
      downloadExport(plan.pdf, plan.name);
      setSuccessMsg('STEP envoyé au deck. Votre plan PDF est téléchargé séparément ; ouvrez le deck ci-dessous.');
    } catch (e) {
      console.error(e);
      const reason = e instanceof TypeError && phase === 'upload'
        ? 'Connexion au service impossible (réseau ou autorisation du navigateur).'
        : e instanceof Error ? e.message : 'Erreur inconnue.';
      setError(`Échec de l’envoi dans le deck : ${reason}`);
    } finally {
      setSendingToDeck(false);
    }
  };

  return { loading, pdfLoading, sendingToDeck, readyDeck, setReadyDeck,
    handleDownloadPlan, handleDownload, handleSendToDeck };
}
