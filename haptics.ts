export type HapticFeedback = 'tap' | 'impact';

const patterns: Record<HapticFeedback, number | number[]> = {
  tap: 8,
  impact: [24, 28, 54],
};

let nextTapAt = 0;

/** Request a short vibration where the browser and device expose the Vibration API. */
export function triggerHaptic(feedback: HapticFeedback): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (feedback === 'tap' && now < nextTapAt) return;
  nextTapAt = now + (feedback === 'impact' ? 130 : 60);

  try {
    navigator.vibrate(patterns[feedback]);
  } catch {
    // Haptics are an optional enhancement; unsupported/blocked devices stay silent.
  }
}
