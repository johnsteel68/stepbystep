/** Keyboard sequence used to reveal the optional STEP-only export. */
export const KONAMI_CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'] as const;

/** Advance the sequence, restarting safely when a key does not match. */
export function advanceKonamiCode(progress: number, key: string) {
  const expected = KONAMI_CODE[progress];
  const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
  if (normalizedKey === expected) {
    const nextProgress = progress + 1;
    return { progress: nextProgress, unlocked: nextProgress === KONAMI_CODE.length };
  }
  return { progress: normalizedKey === KONAMI_CODE[0] ? 1 : 0, unlocked: false };
}
