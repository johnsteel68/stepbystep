import { useSyncExternalStore } from 'react';
import { getTextureFailureCount, subscribeTextureHealth } from '../viewer/materials/textureHealth';

export default function TextureNotice() {
  const failures = useSyncExternalStore(subscribeTextureHealth, getTextureFailureCount, () => 0);
  if (!failures) return null;
  return <p className="texture-notice" role="status">Une texture n’a pas chargé. La pièce reste visible avec un rendu simplifié ; le STEP conserve sa géométrie.</p>;
}
