import type { HolePosition } from './sheetGeometry.ts';

/** Dessins originaux : les ponts sont placés sur les frontières des rangées,
 * pas au milieu d'un trait. Cela évite les demi-traits minuscules du stencil
 * historique sans réduire la largeur de métal ou de découpe conservée. */
export const COMPACT_STENCIL_FONTS = [
  { id: 'stencil-micro-block', label: 'Micro Bloc', description: 'Petit texte · stencil massif, simple et lisible' },
  { id: 'stencil-micro-round', label: 'Micro Doux', description: 'Petit texte · coins adoucis, style signalétique' },
  { id: 'stencil-micro-tech', label: 'Micro Tech', description: 'Petit texte · coins biseautés, style industriel' },
] as const;
export function isCompactStencil(font?: string): boolean {
  return COMPACT_STENCIL_FONTS.some(item => item.id === font);
}
export const compactMinimumHeight = (thickness: number) => 8 * Math.max(2, thickness);

/** Ajouter les coins après la fusion des traits. Les contours sont communs
 * aux aperçus, au PDF et aux découpes 3D/STEP, pas un simple effet CSS. */
export function styleCompactCuts(cuts: HolePosition[], font: string, thickness: number): HolePosition[] {
  if (font === 'stencil-micro-block') return cuts;
  return cuts.map(cut => {
    const halfWidth = cut.length! / 2, halfHeight = cut.width! / 2;
    const radius = Math.min(Math.max(2, thickness) * .2, halfWidth / 3, halfHeight / 3);
    const contour: { x: number; y: number }[] = [];
    for (const [cx, cy, start] of [
      [halfWidth - radius, halfHeight - radius, 0],
      [-halfWidth + radius, halfHeight - radius, Math.PI / 2],
      [-halfWidth + radius, -halfHeight + radius, Math.PI],
      [halfWidth - radius, -halfHeight + radius, Math.PI * 1.5],
    ]) {
      const steps = font === 'stencil-micro-round' ? 4 : 1;
      for (let i = 0; i <= steps; i++) {
        const angle = start + Math.PI / 2 * i / steps;
        contour.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
      }
    }
    return { ...cut, contour };
  });
}
