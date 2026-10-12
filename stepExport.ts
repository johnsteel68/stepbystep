import { getOC } from 'replicad';
import type { Shape3D } from 'replicad';

/** Write actual AP214 data, rather than relabelling an AP242 exchange file. */
export function exportStepAp214(solid: Shape3D): string {
  const oc = getOC();
  const check = new oc.BRepCheck_Analyzer(solid.wrapped, true, false, false);
  try {
    if (!check.IsValid()) throw new Error('La géométrie de la pièce est invalide pour un export STEP.');
  } finally {
    check.delete();
  }

  const filename = '/stepbystep-ap214.step';
  const writer = new oc.STEPControl_Writer();
  const progress = new oc.Message_ProgressRange();
  let wroteFile = false;
  try {
    if (!oc.Interface_Static.SetCVal('write.step.schema', 'AP214IS')) {
      throw new Error('Impossible de sélectionner le format STEP AP214.');
    }
    oc.Interface_Static.SetCVal('write.step.unit', 'MM');
    oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM');
    const transferred = writer.Transfer(solid.wrapped, oc.STEPControl_StepModelType.STEPControl_ManifoldSolidBrep, true, progress);
    wroteFile = transferred === oc.IFSelect_ReturnStatus.IFSelect_RetDone
      && writer.Write(filename) === oc.IFSelect_ReturnStatus.IFSelect_RetDone;
    if (!wroteFile) {
      throw new Error('OpenCascade n’a pas pu exporter le solide STEP.');
    }
    const text = new TextDecoder().decode(oc.FS.readFile(filename));
    if (!text.includes('MANIFOLD_SOLID_BREP') || !text.includes('CLOSED_SHELL')) {
      throw new Error('Le fichier STEP ne contient pas de solide fermé.');
    }
    return text;
  } finally {
    writer.delete();
    progress.delete();
    if (wroteFile) oc.FS.unlink(filename);
  }
}
