// A small external store also catches failures that occur before React effects
// subscribe, including texture loads requested by the off-screen PDF renderer.
const failures = new Set<string>();
const listeners = new Set<() => void>();
export const getTextureFailureCount = () => failures.size;
export const subscribeTextureHealth = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function reportTextureFailure(url: string) {
  if (failures.has(url)) return;
  failures.add(url);
  listeners.forEach(listener => listener());
}

/** Neutral samples: normal maps are not colours; white would distort normals. */
export function getNeutralTexturePixel(url: string): [number, number, number, number] {
  if (/normal/i.test(url)) return [128, 128, 255, 255];
  if (/displacement|height/i.test(url)) return [128, 128, 128, 255];
  return [255, 255, 255, 255];
}
