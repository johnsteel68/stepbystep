import { useMemo } from 'react';
import type { SheetMetalState } from '../../sheetGeometry';
import { PlanarAnnotation } from './PlanarWingDimension';
import { flatDimensionLayouts } from './flatDimensionLayout';

export default function FlatSheetDimensions({ state, length, width }: { state: SheetMetalState; length: number; width: number }) {
  const layouts = useMemo(() => flatDimensionLayouts(state, length, width), [state, length, width]);
  return <group>{layouts.map((layout, index) => <PlanarAnnotation key={index} layout={layout}
    name={index === layouts.length - 1 ? 'Largeur à plat' : `Longueur aile ${state.legs[index]?.id || 'A'} à plat`} flat />)}</group>;
}
