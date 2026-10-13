import React, { lazy, Suspense, useState, useEffect, useMemo, useRef } from 'react';
import { createWorkflow } from './workflow';
import { BlankShapeControls, BlankFoldControls } from './components/BlankShapeControls';
import TextControls from './components/TextControls';
import TextPlacementView from './components/TextPlacementView';
import { hasPendingStencilText, type StencilText } from './stencilText';
import { useDimensionFeedback } from './useDimensionFeedback';
import { normalizeFormedBlank, blankHoleAllowed } from './formedBlank';
import { createDefaultProject } from './projectDefaults';
import { useManufacturingExports } from './hooks/useManufacturingExports';
import { downloadExport } from './exportDownload';
import type { GrainDirection } from './technicalDrawing';
import { resizeDraftHole, explicitHoles, saveHoles, holeSeries, clearAllHoles, type HoleSizeField } from './holeEditing';
import { WorkflowHeading } from './components/Controls';
import WorkspaceHeader from './components/WorkspaceHeader';
import RenderBoundary from './components/RenderBoundary';
import TextureNotice from './components/TextureNotice';
import GuidedNavigation from './components/GuidedNavigation';
import MobileControlDeck from './components/MobileControlDeck';
import { useMobileWorkspace } from './hooks/useMobileWorkspace';
import MaterialGuidance from './components/MaterialGuidance';
import ProjectShare from './components/ProjectShare';
import GrainDirectionControl from './components/GrainDirectionControl';
import { getGrainConstraints } from './grainConstraints';
import { PROJECT_HASH, PROJECT_QUERY, readProjectFromUrl } from './projectSharing';
import HoleList from './components/HoleList';
import HolePlacementPanel from './components/HolePlacementPanel';
import BendControls from './components/BendControls';
import DimensionControls from './components/DimensionControls';
import CornerRadiusControls from './components/CornerRadiusControls';
import { FinishControls, MaterialControls, ThicknessControls } from './components/MaterialControls';
import {
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Ruler, 
  Plus,
  Download, 
  Upload,
  AlertCircle, 
  AlertTriangle,
  ChevronRight,
  Weight,
  ShieldCheck,
  ShieldAlert,
  ClipboardCheck,
  Wrench,
  X,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHaptic } from './haptics';
import { 
  SheetMetalState, 
  calculateUnfoldedLength, 
  fitsSheetFormat,
  calculateWeight, 
  MATERIAL_CONFIG, 
  DEFAULT_FINISH,
  SHEET_FINISHES,
  getBendingRestriction,
  normalizeBendingSelection,
  getMinLegLength, 
  normalizeSheetThickness,
  getMaxLegLength, 
  getMaxWidth, 
  getHoleConstraints, 
  getMaxHoleCornerRadius,
  constrainHolePosition,
  getPatternPositions,
  HoleShape, 
  HolePatternConfig,
  checkSheetCollision, 
  FlatCornerRadii,
  checkSheetMetalFeasibility,
  generateSheetProfile,
  SheetMetalFeasibilityReport,
} from './sheetGeometry';

const Viewer = lazy(() => import('./Viewer'));

export default function App({ embedded = false }: { embedded?: boolean }) {
  const dimensionFeedback = useDimensionFeedback();
  const [sharedProject] = useState(() => !embedded && typeof window !== 'undefined' ? readProjectFromUrl(window.location.href) : null);
  const [grainDirection, setGrainDirection] = useState<GrainDirection>(sharedProject?.grainDirection ?? 'length');
  const [placementMode, setPlacementMode] = useState(false);
  const [textDraft, setTextDraft] = useState<{ legId: string; config: StencilText } | null>(null);
  const [textPlacement, setTextPlacement] = useState<{ legId: string; x: number; y: number; height?: number; rotation?: number } | null>(null);
  const [placementTargetLegId, setPlacementTargetLegId] = useState<string | null>(null);
  const [placementStage, setPlacementStage] = useState<'select-wing' | 'choose-shape' | 'choose-pattern' | 'position' | 'configure-single'>('select-wing');
  const [placementHoleShape, setPlacementHoleShape] = useState<HoleShape>('round');
  const [placementHoleOrientation, setPlacementHoleOrientation] = useState<'along_length' | 'along_width'>('along_length');
  const [placementHoleCornerRadius, setPlacementHoleCornerRadius] = useState(0);
  const [placementPatternChoice, setPlacementPatternChoice] = useState<'single' | 'corners' | 'custom' | null>(null);
  const [placementPatternConfig, setPlacementPatternConfig] = useState<HolePatternConfig>({ mode: 'line', count: 4, margin: 15, rows: 2, columns: 2 });
  const [placementDraft, setPlacementDraft] = useState<{ legId: string; dist: number; offset: number; holeIndex?: number; valid: boolean } | null>(null);
  const [movingHoleIndex, setMovingHoleIndex] = useState<number | null>(null);
  const [confirmClearAllHoles, setConfirmClearAllHoles] = useState(false);
  const [error, setError] = useState<string | null>(() => !embedded && typeof window !== 'undefined' && (window.location.hash.startsWith(PROJECT_HASH) || new URL(window.location.href).searchParams.has(PROJECT_QUERY)) && !sharedProject ? 'Ce lien de projet est invalide ou incomplet. La pièce par défaut a été chargée.' : null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState(4);
  const [proMode, setProMode] = useState(false);
  const { appRoot, mobileDock, setMobileDock } = useMobileWorkspace(setProMode);
  const [guidedStep, setGuidedStep] = useState(1);
  const [selectedProBendIndex, setSelectedProBendIndex] = useState(0);
  const [selectedProLegIndex, setSelectedProLegIndex] = useState(0);
  const [editingLengthLegIndex, setEditingLengthLegIndex] = useState<number | null>(null);
  const [independentCornerRadii, setIndependentCornerRadii] = useState(() => Boolean(sharedProject?.state.cornerRadii && new Set(Object.values(sharedProject.state.cornerRadii)).size > 1));
  const [activeCornerRadius, setActiveCornerRadius] = useState<keyof FlatCornerRadii | null>(null);
  const controlScrollRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const stepClass = (step: number) => `workflow-step ${openStep === step ? 'is-open' : 'is-closed'}`;

  const [state, setProjectState] = useState<SheetMetalState>(() => sharedProject?.state ? normalizeFormedBlank(sharedProject.state) : createDefaultProject());
  // Atomic barrier for shape/angle/thickness changes: never render a partially
  // updated blank with stale wing datums or physically overlapping fold bands.
  const setState: React.Dispatch<React.SetStateAction<SheetMetalState>> = update => setProjectState(previous => {
    const next = typeof update === 'function' ? update(previous) : update;
    try {
      const normalized = normalizeFormedBlank(next);
      if (!fitsSheetFormat(calculateUnfoldedLength(normalized), normalized.width)) {
        throw new Error('La pièce dépliée doit tenir dans une tôle de 2980 × 1480 mm (rotation possible). Réduisez ses dimensions.');
      }
      return normalized;
    }
    catch (failure) {
      queueMicrotask(() => setError(failure instanceof Error ? failure.message : 'Configuration de forme invalide.'));
      return previous;
    }
  });

  useEffect(() => {
    if (embedded) return;
    const restore = () => {
      if (!window.location.hash.startsWith(PROJECT_HASH)) return;
      const project = readProjectFromUrl(window.location.href);
      if (!project) { setError('Ce lien de projet est invalide ou incomplet.'); return; }
      setState(project.state);
      setGrainDirection(project.grainDirection);
      setIndependentCornerRadii(Boolean(project.state.cornerRadii && new Set(Object.values(project.state.cornerRadii)).size > 1));
      setPlacementMode(false);
      setPlacementDraft(null);
      setPlacementTargetLegId(null);
      setReadyDeck(null);
      setGuidedStep(1);
      setOpenStep(4);
      setProMode(false);
    };
    window.addEventListener('hashchange', restore);
    return () => window.removeEventListener('hashchange', restore);
  }, [embedded]);

  const workflow = useMemo(() => createWorkflow(state), [state]);
  const guidedPageCount = workflow.length;
  const currentPageNumber = Math.max(1, Math.min(guidedStep, guidedPageCount));
  const currentPage = workflow[currentPageNumber - 1];
  useEffect(() => {
    if (!proMode && window.matchMedia('(max-width: 860px)').matches) setOpenStep(currentPage.section);
  }, [proMode, currentPage.section]);
  const headingNumber = (section: number) => proMode ? workflow.findIndex(page => page.section === section) + 1 : currentPageNumber;
  const guidedAngleIndex = currentPage.bendIndex ?? 0;
  const guidedWorkflowStep = (page: number) => workflow[Math.max(0, Math.min(page, guidedPageCount) - 1)].section;
  const adviceStep = proMode ? openStep : currentPage.section;
  const textPending = adviceStep === 12 && hasPendingStencilText(state, textDraft);
  const guidanceStage = adviceStep === 1 ? 'material' : adviceStep === 2 ? 'finish' : adviceStep === 3 ? 'thickness' : null;
  const isStepVisible = (step: number) => {
    if (step === 12 && !workflow.some(page => page.section === 12)) return false;
    if ((step === 10 || step === 11) && state.bendCount > 0) return false;
    if (step === 6 && (state.blankShape || state.bendCount === 0)) return false;
    if (step === 7 && state.blankShape && !['rectangle', 'square', 'frame', 'mounting-plate'].includes(state.blankShape)) return false;
    if (step === 5 && state.bendCount === 0) return false;
    return proMode || guidedWorkflowStep(guidedStep) === step;
  };
  const goToGuidedStep = (page: number) => {
    const nextPage = Math.max(1, Math.min(guidedPageCount, page));
    if (placementMode && guidedWorkflowStep(nextPage) !== 8) return;
    if (textPending && guidedWorkflowStep(nextPage) !== 12) return;
    setMobileDock('compact');
    setEditingLengthLegIndex(null);
    setActiveCornerRadius(null);
    setGuidedStep(nextPage);
    setOpenStep(guidedWorkflowStep(nextPage));
  };
  const handleMobileStepSwipeStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (embedded || proMode || window.innerWidth > 860 || event.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea, label, a, [contenteditable="true"], [role="slider"]')) {
      touchStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleMobileStepSwipeEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || embedded || proMode || window.innerWidth > 860 || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    goToGuidedStep(guidedStep + (deltaX < 0 ? 1 : -1));
  };
  const toggleStep = (step: number) => {
    if (!proMode || placementMode || textPending) return;
    setEditingLengthLegIndex(null);
    setActiveCornerRadius(null);
    setOpenStep(openStep === step ? 0 : step);
  };

  useEffect(() => {
    if (!proMode) controlScrollRef.current?.scrollTo({ top: 0 });
  }, [guidedStep, proMode]);

  // Auto-clear messages
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  // Pli management (0 for a flat sheet, up to 4 bends)
  const bendingRestriction = getBendingRestriction(state.finish || DEFAULT_FINISH[state.material], state.thickness);
  const commitBlank = (next: SheetMetalState) => {
    try { setState(normalizeFormedBlank(next)); setError(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Configuration de forme invalide.'); }
  };
  const setBendCount = (count: number) => {
    const clamped = Math.max(0, Math.min(4, count));
    const compatible = normalizeBendingSelection(state, clamped);
    if (compatible.finish !== state.finish || compatible.thickness !== state.thickness) {
      setSuccessMsg('Choix adapté au pliage : finition et épaisseur compatibles sélectionnées.');
    }
    setSelectedProBendIndex(0);
    setGuidedStep(1);
    if (state.blankShape) commitBlank({ ...normalizeBendingSelection(state, clamped), blankBendPositions: undefined });
    else setState(prev => normalizeBendingSelection(prev, clamped));
    setOpenStep(4);
  };

  const handleSignedBendAngle = (index: number, rawVal: number) => {
    setSelectedProBendIndex(index);
    let signedVal = isNaN(rawVal) ? 90 : Math.round(rawVal);
    
    // Direction from sign: positive = + (Haut, 1), negative = - (Bas, -1)
    let targetDir: 1 | -1 = signedVal < 0 ? -1 : 1;
    let angleMag = Math.abs(signedVal);

    const minAngle = 15;
    const maxAngle = 165;

    if (angleMag < minAngle) {
      angleMag = minAngle;
      setError(`Angle machine de pliage limité au minimum technique (±${minAngle}°)`);
    } else if (angleMag > maxAngle) {
      angleMag = maxAngle;
      setError(`Angle machine de pliage limité au maximum technique (±${maxAngle}°)`);
    } else {
      setError(null);
    }

    const candidateState: SheetMetalState = {
      ...state,
      bends: state.bends.map((b, i) => i === index ? { ...b, angle: angleMag, direction: targetDir } : b),
    };

    if (state.blankShape) { commitBlank(candidateState); return; }

    const colCheck = checkSheetCollision(candidateState);
    if (colCheck.hasCollision) {
      setError(`Collision physique : l'${colCheck.featureA} bute contre l'${colCheck.featureB}. Le métal ne peut pas se traverser.`);
    }

    setState(candidateState);
  };

  // Handlers with strict Feasibility Clamping (Blocage à la faisabilité)
  const handleLegLengthChange = (index: number, rawVal: number) => {
    triggerHaptic('tap');
    const minL = getMinLegLength(state.thickness);
    const maxL = getMaxLegLength(state, index);
    let val = isNaN(rawVal) ? minL : rawVal;

    if (val < minL) {
      setError(`Aile ${state.legs[index].id} : bloquée au bord tombé minimum de pliage (${minL} mm)`);
      val = minL;
    } else if (val > maxL) {
      setError(`Aile ${state.legs[index].id} : bloquée au maximum réalisable de ${maxL} mm pour le format de tôle`);
      val = maxL;
    }

    const currentLen = state.legs[index]?.length ?? minL;

    const makeCandidate = (targetL: number): SheetMetalState => ({
      ...state,
      legs: state.legs.map((l, i) => {
        if (i !== index) return l;
        const bounds = getHoleConstraints(targetL, state.thickness, state.width, state.bendCount > 0);
        const safeDist = Math.max(bounds.minDist, Math.min(bounds.maxDist, l.holeDist));
        return { ...l, length: targetL, holeDist: safeDist };
      }),
    });

    const candidate = makeCandidate(val);
    const colCheck = checkSheetCollision(candidate);

    if (colCheck.hasCollision) {
      // Recherche de la longueur maximale sans collision
      let safeLen = currentLen;
      let low = currentLen;
      let high = val;

      for (let iter = 0; iter < 12; iter++) {
        const mid = parseFloat(((low + high) / 2).toFixed(1));
        if (Math.abs(mid - low) < 0.2 || Math.abs(mid - high) < 0.2) break;
        const testCol = checkSheetCollision(makeCandidate(mid));
        if (testCol.hasCollision) {
          high = mid;
        } else {
          safeLen = mid;
          low = mid;
        }
      }

      setError(`Collision évitée : Aile ${state.legs[index].id} bloquée à ${safeLen} mm (elle bute contre l'${colCheck.featureB}). Le métal ne peut pas se traverser.`);
      setState(makeCandidate(safeLen));
      return;
    }

    setError(null);
    setState(candidate);
  };

  const handleWidthChange = (rawVal: number) => {
    triggerHaptic('tap');
    const currentUnfolded = calculateUnfoldedLength(state);
    const maxW = getMaxWidth(currentUnfolded);
    const minW = 10;
    let val = isNaN(rawVal) ? minW : rawVal;

    if (val < minW) {
      setError(`Largeur minimale requise en atelier : ${minW} mm`);
      val = minW;
    } else if (val > maxW) {
      setError(`Largeur bloquée à la limite de tôle réalisable (${maxW} mm)`);
      val = maxW;
    }

    setState(prev => {
      const newLegs = prev.legs.map(leg => {
        const bounds = getHoleConstraints(leg.length, prev.thickness, val, prev.bendCount > 0);
        const safeOffset = Math.min(Math.max(leg.holeOffset, bounds.minOffset), bounds.maxOffset);
        return { ...leg, holeOffset: safeOffset };
      });
      return { ...prev, width: val, legs: newLegs };
    });
  };

  const handleThicknessChange = (rawVal: number) => {
    triggerHaptic('tap');
    const val = normalizeSheetThickness(rawVal, state.finish, state.bendCount);

    const newMinLeg = getMinLegLength(val);
    let anyLegAdjusted = false;
    const newLegs = state.legs.map((leg) => {
      let newLen = leg.length;
      if (newLen < newMinLeg) {
        newLen = newMinLeg;
        anyLegAdjusted = true;
      }
      const bounds = getHoleConstraints(newLen, val, state.width, state.bendCount > 0);
      const safeDist = Math.min(Math.max(leg.holeDist, bounds.minDist), bounds.maxDist);
      return { ...leg, length: newLen, holeDist: safeDist };
    });

    const candidate: SheetMetalState = { ...state, thickness: val, legs: newLegs };
    const colCheck = checkSheetCollision(candidate);
    if (colCheck.hasCollision) {
      setError(`Épaisseur ${val} mm impossible : collision détectée entre l'${colCheck.featureA} et l'${colCheck.featureB} (dégagement de matière insuffisant).`);
      return;
    }

    if (anyLegAdjusted) {
      setSuccessMsg(`Épaisseur ${val} mm : ailes ajustées au bord tombé minimum (${newMinLeg} mm)`);
    } else {
      setError(null);
    }
    setState(candidate);
  };

  // Presets
  const applyPreset = (preset: 'L' | 'L_SHELF' | 'L_SUPPORT' | 'U' | 'U_TRAY' | 'Z' | 'C' | 'C_RETURN' | 'OMEGA') => {
    setState(prev => {
      if (preset === 'L') {
        return {
          ...prev,
          bendCount: 1,
          legs: prev.legs.map((l, i) => i === 0 ? { ...l, length: 100 } : i === 1 ? { ...l, length: 100 } : l),
          bends: prev.bends.map((b, i) => i === 0 ? { ...b, angle: 90, direction: 1 } : b),
        };
      } else if (preset === 'L_SHELF') {
        return {
          ...prev,
          bendCount: 1,
          legs: prev.legs.map((l, i) => i === 0 ? { ...l, length: 120 } : i === 1 ? { ...l, length: 60 } : l),
          bends: prev.bends.map((b, i) => i === 0 ? { ...b, angle: 90, direction: -1 } : b),
        };
      } else if (preset === 'L_SUPPORT') {
        return {
          ...prev,
          bendCount: 1,
          legs: prev.legs.map((l, i) => i === 0 ? { ...l, length: 60 } : i === 1 ? { ...l, length: 120 } : l),
          bends: prev.bends.map((b, i) => i === 0 ? { ...b, angle: 90, direction: 1 } : b),
        };
      } else if (preset === 'U') {
        return {
          ...prev,
          bendCount: 2,
          legs: prev.legs.map((l, i) => i === 0 ? { ...l, length: 60 } : i === 1 ? { ...l, length: 100 } : i === 2 ? { ...l, length: 60 } : l),
          bends: prev.bends.map((b, i) => i === 0 ? { ...b, angle: 90, direction: 1 } : i === 1 ? { ...b, angle: 90, direction: 1 } : b),
        };
      } else if (preset === 'U_TRAY') {
        return {
          ...prev,
          bendCount: 2,
          legs: prev.legs.map((l, i) => i === 0 ? { ...l, length: 45 } : i === 1 ? { ...l, length: 120 } : i === 2 ? { ...l, length: 45 } : l),
          bends: prev.bends.map((b, i) => i === 0 ? { ...b, angle: 90, direction: 1 } : i === 1 ? { ...b, angle: 90, direction: 1 } : b),
        };
      } else if (preset === 'Z') {
        return {
          ...prev,
          bendCount: 2,
          legs: prev.legs.map((l, i) => i === 0 ? { ...l, length: 60 } : i === 1 ? { ...l, length: 80 } : i === 2 ? { ...l, length: 60 } : l),
          bends: prev.bends.map((b, i) => i === 0 ? { ...b, angle: 90, direction: 1 } : i === 1 ? { ...b, angle: 90, direction: -1 } : b),
        };
      } else if (preset === 'C') {
        return {
          ...prev,
          bendCount: 3,
          legs: prev.legs.map((l, i) => i === 0 ? { ...l, length: 30 } : i === 1 ? { ...l, length: 70 } : i === 2 ? { ...l, length: 120 } : { ...l, length: 70 }),
          bends: prev.bends.map((b) => ({ ...b, angle: 90, direction: 1 })),
        };
      } else if (preset === 'C_RETURN') {
        return {
          ...prev,
          bendCount: 3,
          legs: prev.legs.map((l, i) => i === 0 ? { ...l, length: 35 } : i === 1 ? { ...l, length: 90 } : i === 2 ? { ...l, length: 110 } : { ...l, length: 35 }),
          bends: prev.bends.map((b, i) => i === 0 ? { ...b, angle: 90, direction: 1 } : i === 1 ? { ...b, angle: 90, direction: -1 } : i === 2 ? { ...b, angle: 90, direction: 1 } : b),
        };
      } else if (preset === 'OMEGA') {
        return {
          ...prev,
          bendCount: 4,
          legs: prev.legs.map((l, i) => i === 0 ? { ...l, length: 35 } : i === 1 ? { ...l, length: 60 } : i === 2 ? { ...l, length: 80 } : i === 3 ? { ...l, length: 60 } : { ...l, length: 35 }),
          bends: prev.bends.map((b, i) => i === 0 ? { ...b, angle: 90, direction: 1 } : i === 1 ? { ...b, angle: 90, direction: -1 } : i === 2 ? { ...b, angle: 90, direction: 1 } : { ...b, angle: 90, direction: -1 }),
        };
      }
      return prev;
    });
    setSuccessMsg(`Gabarit appliqué (angles 90°)`);
  };

  // Calculations
  const profileData = useMemo(
    () => generateSheetProfile(state),
    [state.bendCount, state.legs, state.bends, state.thickness],
  );
  const collision = profileData.collision;
  const unfoldedLength = useMemo(
    () => calculateUnfoldedLength(state),
    [state.bendCount, state.legs, state.bends, state.thickness],
  );
  const partWeight = useMemo(
    () => calculateWeight(state, unfoldedLength),
    [unfoldedLength, state.width, state.thickness, state.material],
  );
  const maxWidthAllowed = getMaxWidth(unfoldedLength);

  // Re-apply the stock-sheet orientation limit after geometry changes such as
  // adding bends or applying a preset. A 2980 mm width is only possible while
  // the developed length stays within the 1480 mm side of the sheet.
  useEffect(() => {
    if (state.width <= maxWidthAllowed) return;

    setState((prev) => {
      const allowedWidth = getMaxWidth(calculateUnfoldedLength(prev));
      if (prev.width <= allowedWidth) return prev;

      const nextWidth = allowedWidth;
      const nextLegs = prev.legs.map((leg) => {
        const bounds = getHoleConstraints(leg.length, prev.thickness, nextWidth, prev.bendCount > 0);
        const safeOffset = Math.min(Math.max(leg.holeOffset, bounds.minOffset), bounds.maxOffset);
        return { ...leg, holeOffset: safeOffset };
      });
      return { ...prev, width: nextWidth, legs: nextLegs };
    });

    setError(`Largeur ajustée à ${maxWidthAllowed} mm pour respecter le format de tôle 1480 × 2980 mm.`);
  }, [maxWidthAllowed, state.width]);

  const cancelHolePlacement = () => {
    setPlacementDraft(null);
    setPlacementTargetLegId(null);
    setMovingHoleIndex(null);
    setPlacementMode(false);
    setPlacementStage('select-wing');
    setPlacementPatternChoice(null);
    setSuccessMsg(null);
  };

  const finishHolePlacement = () => {
    setPlacementDraft(null);
    setPlacementTargetLegId(null);
    setMovingHoleIndex(null);
    setPlacementMode(false);
    setPlacementStage('select-wing');
    setPlacementPatternChoice(null);
  };

  const handlePlacementCandidate = (draft: { legId: string; dist: number; offset: number; valid: boolean } | null) => {
    if (!draft) {
      setPlacementDraft(null);
      setPlacementStage('position');
      if (movingHoleIndex === null) setPlacementTargetLegId(null);
      return;
    }
    if (!draft.valid) {
      setError('Impossible de placer le trou dans la zone de pli. Éloignez-le du pli.');
      return;
    }
    setPlacementDraft({ ...draft, holeIndex: movingHoleIndex ?? undefined });
    setPlacementTargetLegId(draft.legId);
    if (placementPatternChoice === 'single') setPlacementStage('configure-single');
  };

  const handlePlacementHoleSizeChange = (legId: string, field: HoleSizeField, value: number) => {
    setState(previous => resizeDraftHole(previous, legId, field, value));
  };

  const handlePlacementWingSelect = (legId: string) => {
    setPlacementDraft(null);
    setPlacementTargetLegId(legId);
    setPlacementStage(placementPatternChoice === 'single' ? 'position' : 'choose-pattern');
    const selectedLeg = state.legs.find(leg => leg.id === legId);
    setPlacementHoleCornerRadius(selectedLeg?.holeCornerRadius || 0);
    setSuccessMsg(`Aile ${legId} sélectionnée · choisissez le type de perçage`);
  };

  const handlePlacementShapeSelect = (shape: HoleShape) => {
    setPlacementHoleShape(shape);
    const selectedLeg = state.legs.find(leg => leg.id === placementTargetLegId);
    const radiusForShape = selectedLeg ? getMaxHoleCornerRadius({ ...selectedLeg, holeShape: shape }) : 0;
    setPlacementHoleCornerRadius(Math.min(selectedLeg?.holeCornerRadius || 0, radiusForShape));
    if (!placementDraft && placementPatternChoice === 'single') setPlacementStage('position');
  };

  const handlePlacementPatternSelect = (choice: 'single' | 'corners' | 'custom') => {
    setPlacementPatternChoice(choice);
    if (choice === 'single') {
      setPlacementPatternConfig({ mode: 'single', count: 1, margin: 15, rows: 1, columns: 1 });
      setPlacementStage('position');
    } else if (choice === 'corners') {
      setPlacementPatternConfig({ mode: 'corners', count: 4, margin: 15, rows: 2, columns: 2 });
      setPlacementStage('choose-pattern');
    } else {
      setPlacementPatternConfig({ mode: 'line', count: 4, margin: 15, rows: 2, columns: 2 });
      setPlacementStage('choose-pattern');
    }
  };

  const handlePlacementPatternConfirm = (config: HolePatternConfig) => {
    if (!placementTargetLegId) return;
    const legIndex = state.legs.findIndex(leg => leg.id === placementTargetLegId);
    if (legIndex < 0) return;
    const leg = state.legs[legIndex];
    const configured = { ...leg, holeShape: placementHoleShape, holeOrientation: placementHoleOrientation, holeCornerRadius: Math.min(getMaxHoleCornerRadius({ ...leg, holeShape: placementHoleShape }), placementHoleCornerRadius), hasHole: true, holePattern: config, holePositions: undefined };
    const positions = holeSeries(configured, state);
    if (!positions.length) {
      setError('Cette série ne tient pas sur cette aile. Réduisez le nombre de trous, leur taille ou la marge.');
      return;
    }
    setState(previous => saveHoles(previous, leg.id, positions));
    setSuccessMsg(`${positions.length} perçage${positions.length > 1 ? 's' : ''} validé${positions.length > 1 ? 's' : ''} sur l’aile ${leg.id}`);
    finishHolePlacement();
  };

  const handleHoleDeleteRequest = (legId: string, holeIndex: number) => {
    const legIndex = state.legs.findIndex(leg => leg.id === legId);
    if (legIndex < 0) return;
    const leg = state.legs[legIndex];
    const positions = getPatternPositions(leg, state.width, leg.holePattern || state.holePattern, state.thickness, state.bendCount > 0, legIndex > 0 && legIndex < state.bendCount);
    if (holeIndex < 0 || holeIndex >= positions.length) return;
    const remaining = positions.filter((_, index) => index !== holeIndex);
    setState(previous => {
      const legs = [...previous.legs];
      const current = legs[legIndex];
      legs[legIndex] = remaining.length
        ? { ...current, hasHole: true, holePositions: remaining, holeDist: remaining[0].dist, holeOffset: remaining[0].offset }
        : { ...current, hasHole: false, holePositions: undefined, holePattern: { mode: 'single', count: 1, margin: 15, rows: 1, columns: 1 } };
      return { ...previous, legs };
    });
    setSuccessMsg(remaining.length
      ? `Trou supprimé sur l’aile ${legId} · ${remaining.length} restant${remaining.length > 1 ? 's' : ''}`
      : `Dernier trou supprimé de l’aile ${legId}`);
  };

  const handleMoveExistingHole = (legId: string, holeIndex: number) => {
    const leg = state.legs.find(item => item.id === legId);
    if (!leg) return;
    const hole = explicitHoles(leg, state)[holeIndex];
    if (!hole) return;
    setState(previous => {
      let next = resizeDraftHole(previous, legId, 'holeDiam', hole.diam!);
      next = resizeDraftHole(next, legId, 'holeLength', hole.length!);
      return resizeDraftHole(next, legId, 'holeWidth', hole.width!);
    });
    setMovingHoleIndex(holeIndex);
    setPlacementTargetLegId(legId);
    setPlacementDraft({ legId, dist: hole.dist, offset: hole.offset, holeIndex, valid: true });
    setPlacementHoleShape(hole.shape!);
    setPlacementHoleOrientation(hole.orientation!);
    setPlacementHoleCornerRadius(hole.cornerRadius!);
    setPlacementMode(true);
    setPlacementStage('configure-single');
    setPlacementPatternChoice('single');
    setOpenStep(7);
    if (!proMode) setGuidedStep(workflow.findIndex(page => page.section === 8) + 1);
    controlScrollRef.current?.scrollTo({ top: 0 });
  };

  // Commit only after the user confirms the candidate selected in the 3D view.
  const handleHolePlacement = (legId: string, dist: number, offset: number) => {
    const legIdx = state.legs.findIndex(l => l.id === legId);
    if (legIdx !== -1) {
      const leg = state.legs[legIdx];
      const safeCornerRadius = Math.min(
        getMaxHoleCornerRadius({ ...leg, holeShape: placementHoleShape }),
        Math.max(0, placementHoleCornerRadius),
      );
      const placementLeg = { ...leg, holeShape: placementHoleShape, holeOrientation: placementHoleOrientation, holeCornerRadius: safeCornerRadius };
      const hasBendAtStart = legIdx > 0 && legIdx < state.bendCount;
      const bounds = getHoleConstraints(placementLeg, state.thickness, state.width, state.bendCount > 0, undefined, undefined, undefined, state.bendCount > 0, hasBendAtStart);
      if (!bounds.isFeasible) {
        setError(`Aile ${legId} trop courte ou trop étroite : aucun trou ne peut respecter la distance minimale au pli et aux bords.`);
        finishHolePlacement();
        return;
      }
      const safePosition = constrainHolePosition(placementLeg, state.width, state.thickness, dist, offset, state.bendCount > 0, hasBendAtStart);
      const safeDist = safePosition.dist;
      const safeOffset = safePosition.offset;

      if (safeDist !== dist || safeOffset !== offset) {
        setError('Le trou est trop proche du pli : ajustez sa position avant de valider.');
        return;
      }
      setState(previous => saveHoles(previous, legId, [{
        dist, offset, shape: placementHoleShape, orientation: placementHoleOrientation,
        diam: leg.holeDiam, length: leg.holeLength || 25, width: leg.holeWidth || 12,
        cornerRadius: safeCornerRadius,
      }], movingHoleIndex ?? undefined));
      setSuccessMsg(`Trou confirmé sur l’aile ${legId} · ${safeDist} × ${safeOffset} mm`);
    }
    finishHolePlacement();
  };

  const validatedPlacementDraft = useMemo(() => {
    if (!placementDraft) return null;
    const leg = state.legs.find(item => item.id === placementDraft.legId);
    if (!leg) return null;
    const legIndex = state.legs.findIndex(item => item.id === placementDraft.legId);
    const bounds = getHoleConstraints({ ...leg, holeShape: placementHoleShape, holeOrientation: placementHoleOrientation }, state.thickness, state.width, state.bendCount > 0, undefined, undefined, undefined, state.bendCount > 0, legIndex > 0 && legIndex < state.bendCount);
    return { ...placementDraft, valid: bounds.isFeasible
      && placementDraft.dist >= bounds.minDist && placementDraft.dist <= bounds.maxDist
      && placementDraft.offset >= bounds.minOffset && placementDraft.offset <= bounds.maxOffset
      && (!state.blankShape || blankHoleAllowed(state, legIndex, placementDraft.dist, placementDraft.offset, bounds.rx, bounds.rz)) };
  }, [placementDraft, state, placementHoleShape, placementHoleOrientation]);

  // Contrôle de fabricabilité métallerie industrielle DIN 6935
  const grainLimits = getGrainConstraints(state, grainDirection);
  useEffect(() => {
    if (grainLimits.nextDirection !== grainDirection) {
      setGrainDirection(grainLimits.nextDirection);
      setError('Sens du brossage tourné de 90° pour respecter la tôle de 2 980 × 1 480 mm.');
    }
  }, [grainLimits.nextDirection, grainDirection]);
  const feasibility: SheetMetalFeasibilityReport = useMemo(() => {
    const report = checkSheetMetalFeasibility(state, profileData.collision);
    const grain = getGrainConstraints(state, grainDirection);
    if (grain.valid) return report;
    return { ...report, isFeasible: false, status: 'non_conform', checks: [...report.checks, {
      id: 'grain_stock', name: 'Sens du brossage', category: 'material', status: 'fail',
      value: `${Math.round(grain.length)} × ${state.width} mm`,
      criterion: '2 980 mm dans le sens du brossage / 1 480 mm en travers',
      message: 'Le développé ne tient pas dans la tôle avec ce sens de brossage.',
      recommendation: grain.blocked ? 'Réduisez les dimensions ou changez de finition.' : 'Tournez le brossage de 90°.',
    }] };
  }, [state, profileData, grainDirection]);
  const [showFeasibilityModal, setShowFeasibilityModal] = useState(false);

  // Correction automatique des non-conformités d'atelier
  const handleAutoFixFeasibility = () => {
    const minLeg = getMinLegLength(state.thickness);

    setState(prev => {
      const newLegs = prev.legs.map((leg, idx) => {
        let l = leg.length;
        if (idx <= prev.bendCount && l < minLeg) {
          l = minLeg;
        }
        let safeDist = leg.holeDist;
        let safeOffset = leg.holeOffset;
        let safeDiam = leg.holeDiam;
        if (safeDiam < prev.thickness) {
          safeDiam = prev.thickness;
        }
        if (leg.hasHole) {
          const bounds = getHoleConstraints(
            l, 
            prev.thickness, 
            prev.width, 
            leg.holeShape, 
            leg.holeLength, 
            leg.holeWidth, 
            leg.holeOrientation,
            prev.bendCount > 0
          );
          safeDist = Math.max(bounds.minDist, Math.min(bounds.maxDist, leg.holeDist));
          safeOffset = Math.max(bounds.minOffset, Math.min(bounds.maxOffset, leg.holeOffset));
        }
        return {
          ...leg,
          length: l,
          holeDiam: safeDiam,
          holeDist: safeDist,
          holeOffset: safeOffset,
        };
      });

      const newBends = prev.bends.map(b => {
        const mag = Math.max(15, Math.min(165, Math.abs(b.angle)));
        return { ...b, angle: mag };
      });

      return { ...prev, legs: newLegs, bends: newBends };
    });
    setSuccessMsg("Paramètres corrigés automatiquement selon les règles de métallerie DIN 6935 !");
  };

  const { loading, pdfLoading, sendingToDeck, readyDeck, setReadyDeck,
    handleDownloadPlan, handleDownload, handleSendToDeck } = useManufacturingExports({
      state, grainDirection, feasibility, setError, setSuccessMsg, setShowFeasibilityModal,
    });

  const activeLegs = state.legs.slice(0, state.bendCount + 1);
  const activeBends = state.bends.slice(0, state.bendCount);
  const holeCount = useMemo(
    () => state.legs.slice(0, state.bendCount + 1).reduce(
      (total, leg) => total + (leg.hasHole
        ? getPatternPositions(leg, state.width, leg.holePattern || state.holePattern, state.thickness, state.bendCount > 0, state.legs.indexOf(leg) > 0 && state.legs.indexOf(leg) < state.bendCount).filter(position => !position.textCutout).length
        : 0),
      0,
    ),
    [state.legs, state.bendCount, state.width, state.holePattern, state.thickness],
  );
  const handleClearAllHoles = () => {
    if (!holeCount) return;
    const removedCount = holeCount;
    setState(previous => clearAllHoles(previous));
    setConfirmClearAllHoles(false);
    setSuccessMsg(`Tous les trous ont été supprimés (${removedCount}).`);
  };
  const guidedDimensionIndex = currentPage.legIndex ?? -1;
  const isGuidedWidthPage = !proMode && !!currentPage.width;
  const viewerBendIndex = proMode
    ? Math.max(0, Math.min(selectedProBendIndex, activeBends.length - 1))
    : guidedAngleIndex;
  const showBendAngleCue = state.bendCount > 0 && openStep === 5 && (proMode || guidedWorkflowStep(guidedStep) === 5);
  const viewerLegIndex = editingLengthLegIndex ?? (proMode ? selectedProLegIndex : guidedDimensionIndex);
  const showLegLengthCue = editingLengthLegIndex !== null
    || (openStep === 6 && !isGuidedWidthPage && (proMode || guidedWorkflowStep(guidedStep) === 6));
  const cornerRadiusView = openStep === 7 && (proMode || guidedWorkflowStep(guidedStep) === 7);

  return (
    <div
      ref={appRoot}
      className={`app-shell mobile-dock--${mobileDock} ${proMode ? 'app-shell--pro' : ''} ${embedded ? 'app-shell--embedded' : ''} flex h-screen w-screen overflow-hidden bg-hardware-bg font-sans text-gray-200`}
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        const button = target.closest('button, [role="button"], [role="switch"]');
        if (button && !button.matches(':disabled, [aria-disabled="true"]')) triggerHaptic('tap');
      }}
    >
      {/* Sidebar Controls */}
      <aside
        onTouchStart={handleMobileStepSwipeStart}
        onTouchEnd={handleMobileStepSwipeEnd}
        onTouchCancel={() => { touchStartRef.current = null; }}
        className={`control-rail ${embedded ? 'embedded-control-rail' : ''} ${proMode ? 'w-[410px]' : 'w-[340px]'} bg-hardware-panel border-r border-hardware-border p-5 flex flex-col z-10 overflow-y-auto custom-scrollbar transition-[width] duration-300`}
      >
        <WorkspaceHeader proMode={proMode} disabled={placementMode || textPending} onModeChange={pro => {
          if (placementMode || textPending) return;
          const page = pro ? currentPageNumber : Math.max(1, workflow.findIndex(item => item.section === openStep) + 1);
          setProMode(pro);
          setGuidedStep(page);
          setOpenStep(guidedWorkflowStep(page));
          setEditingLengthLegIndex(null);
          setActiveCornerRadius(null);
        }} />
        {!embedded && <MobileControlDeck scrollRef={controlScrollRef} stepKey={`${currentPageNumber}-${placementStage}-${placementMode}`} title={currentPage.title} mode={mobileDock} onModeChange={setMobileDock} />}
        <div className="control-scroll" ref={controlScrollRef}
          onFocusCapture={dimensionFeedback.capture} onInputCapture={dimensionFeedback.capture} onBlurCapture={dimensionFeedback.capture}>
        {/* Notifications */}
        <AnimatePresence>
          {error && (
            <motion.div 
              role="alert"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-4 p-3 bg-red-950/60 border border-red-800/80 rounded-lg text-red-200 text-xs flex items-center gap-2"
            >
              <AlertCircle size={15} className="text-red-400 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          {successMsg && (
            <motion.div 
              role="status"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-4 p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-lg text-emerald-200 text-xs flex items-center gap-2"
            >
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="workflow-stack">

          {/* 3. SELECTION DU NOMBRE DE PLIS (0 à 4) */}
          <div className={`${!isStepVisible(4) ? '!hidden ' : ''}${stepClass(4)} workflow-order-4 p-4 bg-hardware-bg/70 border border-hardware-border rounded-xl`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(4)} title="Nombre de plis" hint="Ce choix détermine les finitions et épaisseurs disponibles" open={openStep === 4} onClick={() => toggleStep(4)} />

            {/* Choix explicite d'une tôle plane ou d'un profil plié */}
            <div className="grid grid-cols-5 gap-1 p-1 bg-zinc-900 rounded-lg border border-zinc-800 mb-3">
              {[0, 1, 2, 3, 4].map((count) => {
                const isActive = state.bendCount === count;
                const label = count === 0 ? 'Sans pli' : count === 1 ? 'Pli' : 'Plis';
                return (
                  <button
                    key={`bend-btn-${count}`}
                    onClick={() => setBendCount(count)}
                    aria-pressed={isActive}
                    aria-label={count === 0 ? 'Aucun pli, tôle plane' : `${count} ${count > 1 ? 'plis' : 'pli'}`}
                    className={`min-h-[64px] py-2 px-1 rounded-md font-mono font-medium transition-all flex flex-col items-center justify-center gap-1 ${
                      isActive 
                        ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(99,102,241,0.4)]' 
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
                    }`}
                  >
                    <span className="text-2xl leading-none font-bold">{count}</span>
                    <span className="text-[11px] leading-none font-semibold">{label}</span>
                  </button>
                );
              })}
            </div>

            {bendingRestriction && <p role="status" className="step-intro">{bendingRestriction}{state.bendCount > 0 ? ' Sélectionnez « Sans pli » pour continuer.' : ''}</p>}
            {state.bendCount === 0 && (
              <p className="rounded-lg border border-hardware-border bg-hardware-bg/60 px-3 py-2 text-xs text-zinc-400">
                La pièce restera plane : aucun angle ni pli à régler.
              </p>
            )}

            {/* Quick Shape Presets */}
            <div className={`${proMode && !bendingRestriction ? '' : 'hidden '}mt-3 pt-3 border-t border-zinc-800/80`}>
              <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-wider block mb-2">
                Gabarits standards :
              </span>
              <div className="flex flex-wrap gap-1.5">
                {state.bendCount === 1 && (
                  <>
                    <button onClick={() => applyPreset('L')} className="px-2.5 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-all" title="Deux ailes à 90°, usage général">
                      Équerre / support L
                    </button>
                    <button onClick={() => applyPreset('L_SHELF')} className="px-2.5 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-all" title="Étagère : grande tablette et petit retour">
                      Étagère murale
                    </button>
                    <button onClick={() => applyPreset('L_SUPPORT')} className="px-2.5 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-all" title="Support : petit socle et grande aile">
                      Patte de fixation
                    </button>
                  </>
                )}
                {state.bendCount === 2 && (
                  <>
                    <button 
                      onClick={() => applyPreset('U')}
                      className="px-2.5 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-all"
                    >
                      Profil en U
                    </button>
                    <button onClick={() => applyPreset('U_TRAY')} className="px-2.5 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-all" title="Goulotte / bac avec fond large">
                      Bac / goulotte
                    </button>
                    <button 
                      onClick={() => applyPreset('Z')}
                      className="px-2.5 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-all"
                    >
                      Profil en Z (Baïonnette)
                    </button>
                  </>
                )}
                {state.bendCount >= 3 && (
                  <>
                    <button 
                      onClick={() => applyPreset('C')}
                      className="px-2.5 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-all"
                    >
                      Profil en C (U avec retour)
                    </button>
                    <button onClick={() => applyPreset('C_RETURN')} className="px-2.5 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-all" title="Profil C avec retour court de rigidification">
                      C avec retour court
                    </button>
                    <button 
                      onClick={() => applyPreset('OMEGA')}
                      className="px-2.5 py-1 text-[10px] font-mono rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-all"
                    >
                      Chapeau / Oméga (Ω)
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className={`${!isStepVisible(10) ? '!hidden ' : ''}${stepClass(10)}`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(10)} title="Forme de la plaque" open={openStep === 10} onClick={() => toggleStep(10)} />
            <BlankShapeControls state={state} mode="select" onChange={commitBlank} />
          </div>
          <div className={`${!isStepVisible(11) ? '!hidden ' : ''}${stepClass(11)}`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(11)} title="Paramètres de la forme" open={openStep === 11} onClick={() => toggleStep(11)} />
            <BlankShapeControls state={state} mode="parameters" onChange={next => commitBlank({ ...next, blankShape: next.blankShape || 'rectangle' })} />
          </div>
          {/* 3b. ANGLES ET ORIENTATION DES PLIS */}
          {/* Matière */}
          <div className={`${!isStepVisible(1) ? '!hidden ' : ''}${stepClass(1)} workflow-order-1`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(1)} title="Matière" open={openStep === 1} onClick={() => toggleStep(1)} />
            <p className="step-intro">Choisissez la famille de métal de votre pièce.</p>
            <MaterialControls bendCount={state.bendCount} value={state.material} onChange={material => setState(previous => {
              const finish = DEFAULT_FINISH[material];
              return normalizeBendingSelection({ ...previous, material, finish }, previous.bendCount);
            })} />
          </div>

          {/* Nuance / finition */}
          <div className={`${!isStepVisible(2) ? '!hidden ' : ''}${stepClass(2)} workflow-order-2`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(2)} title="Nuance / finition" open={openStep === 2} onClick={() => toggleStep(2)} />
            <FinishControls bendCount={state.bendCount} material={state.material} value={state.finish} onChange={finish => setState(previous => normalizeBendingSelection({ ...previous, finish, material: SHEET_FINISHES[finish].family }, previous.bendCount))} />
            {state.finish === 'stainless-brushed' && <GrainDirectionControl value={grainDirection} onChange={setGrainDirection} allowed={grainLimits.allowed} blocked={grainLimits.blocked} disabled={loading || pdfLoading || sendingToDeck || placementMode} />}
          </div>

          {/* Épaisseur */}
          <div className={`${!isStepVisible(3) ? '!hidden ' : ''}${stepClass(3)} workflow-order-3`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(3)} title="Épaisseur" open={openStep === 3} onClick={() => toggleStep(3)} />
            <ThicknessControls bendCount={state.bendCount} value={state.thickness} finish={state.finish} onChange={handleThicknessChange} />
          </div>
          <div className={`${!isStepVisible(5) ? '!hidden ' : ''}${stepClass(5)} workflow-order-5 flex flex-col gap-2.5`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(5)} title={proMode ? 'Angles de pli' : `Angle du pli ${activeBends[guidedAngleIndex]?.id ?? '1'}`} open={openStep === 5} onClick={() => toggleStep(5)} />

            <BendControls state={state} proMode={proMode} bendIndex={guidedAngleIndex}
              onAngleChange={handleSignedBendAngle} onBendFocus={setSelectedProBendIndex} />
            <BlankFoldControls state={state} proMode={proMode} bendIndex={guidedAngleIndex} onChange={commitBlank} />
          </div>

          {/* Dimensions */}
          <div className={`${!isStepVisible(6) ? '!hidden ' : ''}${stepClass(6)} workflow-order-6`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(6)} title={proMode ? 'Dimensions' : isGuidedWidthPage ? 'Largeur' : `Longueur aile ${activeLegs[guidedDimensionIndex]?.id || 'A'}`} open={openStep === 6} onClick={() => toggleStep(6)} />
            <DimensionControls state={state} proMode={proMode} legIndex={guidedDimensionIndex} widthPage={isGuidedWidthPage}
              maxWidth={maxWidthAllowed} onLegChange={handleLegLengthChange} onWidthChange={handleWidthChange}
              onLegFocus={index => { setSelectedProLegIndex(index); setEditingLengthLegIndex(index); }}
              onLegBlur={index => setEditingLengthLegIndex(current => current === index ? null : current)} />
          </div>

          {/* Arrondis */}
          <div className={`${!isStepVisible(7) ? '!hidden ' : ''}${stepClass(7)} workflow-order-7`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(7)} title="Arrondis des coins" open={openStep === 7} onClick={() => toggleStep(7)} />
            <CornerRadiusControls state={state} setState={setState} independent={independentCornerRadii}
              onIndependentChange={setIndependentCornerRadii} activeCorner={activeCornerRadius} onActiveCornerChange={setActiveCornerRadius} />
          </div>

          <div className={`${!isStepVisible(12) ? '!hidden ' : ''}${stepClass(12)}`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(12)} title="Texte" open={openStep === 12} onClick={() => toggleStep(12)} />
            <TextControls state={state} onChange={setState} onDraftChange={setTextDraft} placement={textPlacement} />
          </div>
          {/* 7. PERÇAGES (HOLES) */}
          <div className={`${!isStepVisible(8) ? '!hidden ' : ''}${stepClass(8)} workflow-order-8 border-t border-hardware-border pt-5`}>
            <WorkflowHeading collapsible={proMode} number={headingNumber(8)} title="Trous" hint="Perçages, formes et positions" open={openStep === 8} onClick={() => toggleStep(8)} />
            {placementMode ? <>
              <p className="placement-navigation-lock" role="status">Terminez ce perçage avec « Confirmer » ou « Annuler » avant de poursuivre.</p>
              <HolePlacementPanel
              editing={movingHoleIndex !== null} onWingSelect={handlePlacementWingSelect}
              dimensions={state} placementStage={placementStage} placementTargetLegId={placementTargetLegId}
              placementDraft={validatedPlacementDraft} placementHoleShape={placementHoleShape}
              placementHoleOrientation={placementHoleOrientation} placementHoleCornerRadius={placementHoleCornerRadius}
              placementPatternChoice={placementPatternChoice} placementPatternConfig={placementPatternConfig}
              onPlacementShapeSelect={handlePlacementShapeSelect} onPlacementHoleOrientationChange={setPlacementHoleOrientation}
              onPlacementHoleCornerRadiusChange={setPlacementHoleCornerRadius}
              onPlacementPatternSelect={handlePlacementPatternSelect} onPlacementPatternChange={setPlacementPatternConfig}
              onPlacementHoleSizeChange={handlePlacementHoleSizeChange} onPlacementCandidate={handlePlacementCandidate}
              onHolePlacement={handleHolePlacement} onCancelPlacement={cancelHolePlacement}
              onPlacementPatternConfirm={handlePlacementPatternConfirm}
            /></> : <div className="mt-3 flex flex-col gap-2">
              <p className="field-description">Que souhaitez-vous ajouter ?</p>
              <div className="hole-start-choices">
                {(['single', 'series'] as const).map(choice => <button key={choice} type="button" onClick={() => {
                  setPlacementDraft(null); setMovingHoleIndex(null); setPlacementTargetLegId(null);
                  setPlacementStage(choice === 'single' ? 'position' : 'select-wing');
                  setPlacementPatternChoice(choice === 'single' ? 'single' : 'corners');
                  setPlacementPatternConfig({ mode: 'corners', count: 4, margin: 15, rows: 2, columns: 2 });
                  setPlacementHoleShape('round'); setPlacementHoleOrientation('along_length');
                  setState(previous => ({ ...previous, legs: previous.legs.map(leg => ({
                    ...leg, holePositions: explicitHoles(leg, previous), holeDiam: 5,
                  })) }));
                  setPlacementHoleCornerRadius(0); setPlacementMode(true);
                }}><Plus size={18} /><strong>{choice === 'single' ? 'Un trou' : 'Une série'}</strong><small>{choice === 'single' ? 'Placement libre' : 'Coins, ligne ou grille'}</small></button>)}
              </div>
              <aside className="hole-size-guide" aria-label="Repères pour choisir la taille des trous">
                <h3>Repères de diamètre</h3>
                <div className="hole-size-guide-row"><strong>Vis métriques</strong><span>M3 : 3,4 mm · M4 : 4,5 mm · M5 : 5,5 mm · M6 : 6,6 mm</span></div>
                <div className="hole-size-guide-row"><strong>Prise électrique</strong><span>Encastrement courant : Ø 67 mm</span></div>
                <p>Ce sont des repères usuels, pas des dimensions universelles. Vérifiez le diamètre de passage de la vis ou la notice de l’appareillage avant de percer.</p>
              </aside>
              <HoleList state={state} onEdit={handleMoveExistingHole} onDelete={handleHoleDeleteRequest} />
              {holeCount > 0 && <div className="hole-clear-all">
                {confirmClearAllHoles ? <div className="hole-clear-all-confirm" role="group" aria-label="Confirmer la suppression de tous les trous">
                  <span>Supprimer les {holeCount} trous de la pièce ?</span>
                  <div className="hole-clear-all-actions">
                    <button type="button" className="hole-clear-all-accept" onClick={handleClearAllHoles}><Trash2 size={16} />Tout supprimer</button>
                    <button type="button" className="hole-clear-all-cancel" onClick={() => setConfirmClearAllHoles(false)}>Annuler</button>
                  </div>
                </div> : <button type="button" className="hole-clear-all-trigger" onClick={() => setConfirmClearAllHoles(true)}><Trash2 size={16} />Supprimer tous les trous</button>}
              </div>}
              <p className="text-center text-[11px] text-zinc-400">
                {placementMode
                  ? 'Survolez une aile puis cliquez au centre souhaité.'
                  : holeCount === 0 ? 'Ajoutez un perçage où vous le souhaitez sur la pièce.' : `${holeCount} trou${holeCount > 1 ? 's' : ''} placé${holeCount > 1 ? 's' : ''} · sélectionnez un trou pour le modifier ou le supprimer.`}
              </p>
            </div>}



          </div>
          {/* 6. FABRICATION & VALIDATION CARD */}
          <div className={`${!proMode ? '!hidden ' : ''}workflow-order-7 p-4 bg-hardware-bg/70 border border-hardware-border rounded-xl`}>
            <div className="flex items-center justify-between mb-3">
              <span className="technical-label flex items-center gap-1.5">
                <Ruler size={13} />
                Développé & Faisabilité
              </span>
              <div className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider flex items-center gap-1 ${
                collision.hasCollision 
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-800' 
                  : 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/80'
              }`}>
                {collision.hasCollision ? (
                  <>
                    <AlertTriangle size={10} className="text-rose-400" />
                    <span>Auto-Collision</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={10} />
                    <span>100% Conforme Atelier</span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 font-mono text-xs">
              <div className="p-2.5 bg-zinc-900/80 rounded-lg border border-zinc-800">
                <span className="text-[9px] text-zinc-500 block uppercase">Développé Tôle</span>
                <span className="text-sm font-bold text-white">{unfoldedLength} mm</span>
              </div>
              <div className="p-2.5 bg-zinc-900/80 rounded-lg border border-zinc-800">
                <span className="text-[9px] text-zinc-500 block uppercase">Poids Estimé</span>
                <span className="text-sm font-bold text-white flex items-center gap-1">
                  <Weight size={12} className="text-zinc-400" />
                  {partWeight} kg
                </span>
              </div>
            </div>

            {collision.hasCollision && (
              <div className="mt-3 p-2 bg-rose-950/60 border border-rose-800/80 rounded-lg text-rose-200 text-[11px] font-mono flex items-start gap-2">
                <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                <span>{collision.message}</span>
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-zinc-800/60 text-[10px] text-zinc-400 font-mono flex flex-col gap-1">
              <div className="flex justify-between">
                <span>Rayon int. (Ri) : {state.thickness} mm</span>
                <span>Rayon ext. (Ro) : {state.thickness * 2} mm</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Perte par pli (DIN 6935) :</span>
                <span>~{((2 * state.thickness * 2) - (Math.PI / 2 * (state.thickness * 1.4))).toFixed(1)} mm</span>
              </div>
            </div>
          </div>


        </div>

        {/* 9. COMMANDER */}
        <div className={`${!isStepVisible(9) ? '!hidden ' : ''}${stepClass(9)} workflow-order-9 border-t border-hardware-border pt-5`}>
          <WorkflowHeading collapsible={proMode} number={headingNumber(9)} title="Commander" hint="Télécharger ou envoyer la pièce au deck" open={openStep === 9} onClick={() => toggleStep(9)} />
          {openStep === 9 && <div className="export-zone">
          <div className="order-summary">
            <span className="eyebrow">Votre pièce sur mesure</span>
            <strong>{MATERIAL_CONFIG[state.material].name} · {SHEET_FINISHES[state.finish || DEFAULT_FINISH[state.material]].name} ({SHEET_FINISHES[state.finish || DEFAULT_FINISH[state.material]].reference}) <span>· {state.thickness} mm</span></strong>
            <dl><div><dt>Développé</dt><dd>{unfoldedLength} × {state.width} mm</dd></div>
              <div><dt>Poids estimé</dt><dd>{partWeight} kg</dd></div>
              <div><dt>Plis</dt><dd>{state.bendCount}</dd></div></dl>
            <button type="button" className="audit-link" onClick={() => setShowFeasibilityModal(true)}>
              <ShieldCheck size={15} />{feasibility.isFeasible ? 'Consulter les vérifications' : 'Vérifier les points à corriger'}<ChevronRight size={15} />
            </button>
          </div>
          <button 
            onClick={handleDownload} 
            disabled={loading || pdfLoading || sendingToDeck}
            className={`w-full py-3.5 px-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-xl transition-all duration-300 text-sm ${
              loading 
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700' 
                : !feasibility.isFeasible
                ? 'bg-rose-950/80 hover:bg-rose-900/90 text-rose-200 border border-rose-600 shadow-rose-900/30'
                : 'bg-pink-600 hover:bg-pink-500 text-white shadow-pink-500/35 border border-pink-300'
            }`}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Génération ISO-10303-21...</span>
              </>
            ) : !feasibility.isFeasible ? (
              <>
                <ShieldAlert size={16} className="text-rose-300" />
                <span>Export Bloqué (Non Faisable - Voir Audit)</span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} className="text-white" />
                <span>Télécharger STEP + plan PDF</span>
              </>
            )}
          </button>
          <div className="technical-plan-options">
            <p>Plan atelier : cotes, perçages et face de finition F1.</p>
            {state.finish === 'stainless-brushed' && <p>Brossage : {grainDirection === 'length' ? 'le long des ailes' : 'en travers des ailes'}. Modifiable à l’étape Nuance / finition.</p>}
            <button type="button" onClick={handleDownloadPlan} disabled={loading || pdfLoading || sendingToDeck}>
              {pdfLoading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              Télécharger le plan PDF seul
            </button>
          </div>
          <button
            type="button"
            onClick={handleSendToDeck}
            disabled={loading || pdfLoading || sendingToDeck || !feasibility.isFeasible}
            className={`w-full rounded-xl border px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 ${
              sendingToDeck
                ? 'cursor-wait border-pink-300/40 bg-pink-500/20 text-pink-100'
                : !feasibility.isFeasible
                ? 'cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500'
                : 'border-pink-300/60 bg-pink-500/10 text-pink-200 hover:bg-pink-500/20 hover:border-pink-300'
            }`}
          >
            {sendingToDeck ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <span>Envoi vers le deck…</span>
              </>
            ) : (
              <>
                <Upload size={15} />
                <span>Envoyer dans le deck</span>
              </>
            )}
          </button>
          <p className="technical-plan-note">Le deck reçoit le STEP ; le plan PDF se télécharge sur votre appareil.</p>
          {readyDeck && <div className="technical-plan-options" role="status">
            <a href={readyDeck.url}>Ouvrir mon deck John Steel →</a>
            <button type="button" onClick={() => downloadExport(readyDeck.pdf, readyDeck.name)}>Retélécharger le plan de la pièce envoyée</button>
          </div>}
          </div>}
        </div>
        </div>
        {!proMode && <GuidedNavigation pages={workflow} current={currentPageNumber} onNavigate={goToGuidedStep} checks={feasibility.checks} locked={placementMode || textPending} lockMessage={textPending ? 'Validez ou supprimez le texte' : undefined} />}
      </aside>

      {/* Main 3D Viewport */}
      <div className={`viewport-shell ${embedded ? 'embedded-viewport-shell' : ''} flex-1 h-full relative`}>
        {guidanceStage && <MaterialGuidance
          stage={guidanceStage}
          material={state.material}
          finish={state.finish || DEFAULT_FINISH[state.material]}
          thickness={state.thickness}
          bendCount={state.bendCount}
        />}
        <RenderBoundary scope="viewer">
        <Suspense fallback={<div className="viewer-loading" role="status"><Loader2 size={24} className="animate-spin" /><span>Chargement de la vue 3D…</span></div>}>
        <Viewer
          dimensions={state}
          temporaryDimension={dimensionFeedback.dimension && {
            ...dimensionFeedback.dimension,
            value: /épaisseur/i.test(dimensionFeedback.dimension.label) ? state.thickness : dimensionFeedback.dimension.value,
          }}
          grainDirection={grainDirection}
          profileData={profileData}
          activeBendIndex={viewerBendIndex}
          showActiveBendCue={showBendAngleCue}
          activeLegIndex={viewerLegIndex}
          showActiveLegCue={showLegLengthCue}
          cornerRadiusView={cornerRadiusView && !placementMode}
          focusedCorner={cornerRadiusView && independentCornerRadii ? activeCornerRadius : null}
          realistic={true} 
          embedded={embedded}
          placementMode={placementMode}
          placementTargetLegId={placementTargetLegId}
          placementStage={placementStage}
          placementHoleShape={placementHoleShape}
          placementHoleOrientation={placementHoleOrientation}
          placementHoleCornerRadius={placementHoleCornerRadius}
          placementPatternChoice={placementPatternChoice}
          placementPatternConfig={placementPatternConfig}
          onHolePlacement={handleHolePlacement}
          onPlacementHoleSizeChange={handlePlacementHoleSizeChange}
          onPlacementCandidate={handlePlacementCandidate}
          onPlacementWingSelect={handlePlacementWingSelect}
          onPlacementShapeSelect={handlePlacementShapeSelect}
          onPlacementHoleOrientationChange={setPlacementHoleOrientation}
          onPlacementHoleCornerRadiusChange={setPlacementHoleCornerRadius}
          onPlacementPatternSelect={handlePlacementPatternSelect}
          onPlacementPatternChange={setPlacementPatternConfig}
          onPlacementPatternConfirm={handlePlacementPatternConfirm}
          onHoleDeleteRequest={handleHoleDeleteRequest}
          onHoleMoveRequest={handleMoveExistingHole}
          onCancelPlacement={cancelHolePlacement}
          placementDraft={validatedPlacementDraft}
          onLegLengthChange={handleLegLengthChange}
          onLegLengthEdit={(index, editing) => {
            setSelectedProLegIndex(index);
            setEditingLengthLegIndex(editing ? index : null);
          }}
          onWidthChange={handleWidthChange}
        />
        </Suspense>
        </RenderBoundary>
        {openStep === 12 && (proMode || guidedWorkflowStep(guidedStep) === 12) && <TextPlacementView state={state} draft={textDraft} onMove={setTextPlacement} />}
        <TextureNotice />

        {!embedded && !placementMode && !cornerRadiusView && <ProjectShare state={state} grainDirection={grainDirection} locked={false} />}

      </div>

      {/* MODAL AUDIT DE FABRICABILITÉ MÉTALLERIE INDUSTRIELLE */}
      <AnimatePresence>
        {showFeasibilityModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-2xl max-h-[90vh] bg-hardware-panel border border-hardware-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-hardware-border flex items-center justify-between bg-zinc-950/50">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border ${
                    feasibility.status === 'conform'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : feasibility.status === 'warning'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}>
                    <ClipboardCheck size={22} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-white tracking-tight">
                        Rapport d'Audit de Fabricabilité Métallerie
                      </h2>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                        DIN 6935 / CETIM
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">
                      Audit atelier : Découpe laser, rayon de pliage, bords tombés et perçages
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowFeasibilityModal(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Content Scrollable */}
              <div className="p-5 overflow-y-auto custom-scrollbar flex flex-col gap-4">
                {/* Global Status Banner */}
                <div className={`p-4 rounded-xl border flex items-center justify-between ${
                  feasibility.status === 'conform'
                    ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-200'
                    : feasibility.status === 'warning'
                    ? 'bg-amber-950/30 border-amber-700/70 text-amber-200'
                    : 'bg-rose-950/30 border-rose-700/70 text-rose-200'
                }`}>
                  <div className="flex items-center gap-3">
                    {feasibility.status === 'conform' ? (
                      <CheckCircle2 size={24} className="text-emerald-400 shrink-0" />
                    ) : feasibility.status === 'warning' ? (
                      <AlertTriangle size={24} className="text-amber-400 shrink-0" />
                    ) : (
                      <ShieldAlert size={24} className="text-rose-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-bold text-sm">
                        {feasibility.status === 'conform'
                          ? 'Pièce 100% Faisable en Atelier de Tôlerie'
                          : feasibility.status === 'warning'
                          ? 'Fabricable sous Réserve (Tolérances Limites)'
                          : 'Pièce Non Conforme (Bloquante en Atelier)'}
                      </div>
                      <div className="text-xs opacity-85">
                        {feasibility.status === 'conform'
                          ? 'Toutes les contraintes de pliage, de découpe laser et de matière sont respectées.'
                          : feasibility.status === 'warning'
                          ? 'Certains jeux de matière sont étroits mais restent usinables avec précaution.'
                          : 'Le métal s\'auto-traverse ou les cotes violent les capacités physiques de la presse.'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black font-mono">
                      {feasibility.score}%
                    </div>
                    <div className="text-[10px] uppercase tracking-wider opacity-75 font-mono">
                      Score Norme
                    </div>
                  </div>
                </div>

                {/* Technical Parameters Card */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono">
                  <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 block uppercase">Flan Déplié</span>
                    <span className="text-white font-bold">{feasibility.unfoldedLength} × {feasibility.width} mm</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 block uppercase">Poids Estimé</span>
                    <span className="text-white font-bold">{feasibility.weightKg} kg</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 block uppercase">Facteur K</span>
                    <span className="text-white font-bold">{feasibility.kFactor}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 block uppercase">Rayon Ri</span>
                    <span className="text-white font-bold">{feasibility.thickness} mm (1.0 × e)</span>
                  </div>
                </div>

                {/* Detailed Checklist */}
                <div>
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider font-mono mb-2">
                    Contrôles Industriels Détaillés ({feasibility.checks.length} points audités)
                  </h3>
                  <div className="flex flex-col gap-2">
                    {feasibility.checks.map((c) => (
                      <div
                        key={c.id}
                        className={`p-3 rounded-xl border flex flex-col gap-1 transition-colors ${
                          c.status === 'pass'
                            ? 'bg-zinc-900/40 border-zinc-800 text-zinc-300'
                            : c.status === 'warning'
                            ? 'bg-amber-950/20 border-amber-700/50 text-amber-200'
                            : 'bg-rose-950/30 border-rose-700/70 text-rose-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-semibold text-xs text-white">
                            {c.status === 'pass' ? (
                              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                            ) : c.status === 'warning' ? (
                              <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                            ) : (
                              <XCircle size={15} className="text-rose-400 shrink-0" />
                            )}
                            <span>{c.name}</span>
                          </div>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                            c.status === 'pass'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : c.status === 'warning'
                              ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                          }`}>
                            {c.status === 'pass' ? 'CONFORME' : c.status === 'warning' ? 'TOLÉRANCE' : 'NON CONFORME'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 px-0.5">
                          <span>Valeur actuelle : <strong className="text-zinc-200">{c.value}</strong></span>
                          <span>Critère atelier : <strong className="text-zinc-300">{c.criterion}</strong></span>
                        </div>

                        <p className="text-[11px] leading-relaxed text-zinc-300 mt-0.5">
                          {c.message}
                        </p>

                        {c.recommendation && (
                          <div className="text-[10px] text-amber-400 bg-amber-500/10 p-1.5 rounded border border-amber-500/20 font-mono mt-0.5">
                            Conseil atelier : {c.recommendation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-hardware-border bg-zinc-950/50 flex items-center justify-between gap-3">
                {!feasibility.isFeasible ? (
                  <button
                    onClick={handleAutoFixFeasibility}
                    className="py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-600/30 transition-all"
                  >
                    <Wrench size={15} />
                    <span>Corriger automatiquement selon les normes DIN 6935</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
                    <ShieldCheck size={16} />
                    <span>Pièce prête pour fabrication et export STEP</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowFeasibilityModal(false)}
                    className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-300 transition-colors"
                  >
                    Fermer
                  </button>
                  <button
                    onClick={() => {
                      setShowFeasibilityModal(false);
                      handleDownload();
                    }}
                    disabled={!feasibility.isFeasible}
                    className={`py-2.5 px-4 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg transition-all ${
                      feasibility.isFeasible
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                    }`}
                  >
                    <Download size={14} />
                    <span>Télécharger le .STEP</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
