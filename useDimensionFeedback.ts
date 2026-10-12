import { useEffect, useRef, useState, type SyntheticEvent } from 'react';

export interface DimensionFeedback { label: string; value: number; unit: 'mm' | '°' }

/** UI-only feedback: never writes project dimensions or persists in shared links.
 * Every edit restarts the expiry, including keyboard input and touch sliders.
 */
export function useDimensionFeedback() {
  const [dimension, setDimension] = useState<DimensionFeedback | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterCommit = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (expiry.current) clearTimeout(expiry.current); if (afterCommit.current) clearTimeout(afterCommit.current); }, []);
  function read(input: EventTarget | null) {
    if (!(input instanceof HTMLInputElement) || !['number', 'range'].includes(input.type)) return;
    const rawLabel = input.getAttribute('aria-label') || input.labels?.[0]?.textContent || input.closest('.dimension-field')?.querySelector('label')?.textContent || '';
    // Counts are not distances. Avoid displaying “24 mm” for 24 teeth/branches.
    if (!rawLabel || /nombre|colonnes|lignes|quantité|rotation horizontale/i.test(rawLabel)) return;
    const label = rawLabel.replace(/\s+en (millimètres|degrés)\s*$/i, '');
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) { setDimension(null); return; }
    setDimension({ label, value, unit: /angle|orientation|degré/i.test(rawLabel) ? '°' : 'mm' });
    if (expiry.current) clearTimeout(expiry.current);
    expiry.current = setTimeout(() => setDimension(null), 3000);
  }
  function capture(event: SyntheticEvent<HTMLElement>) {
    const input = event.target;
    if (afterCommit.current) clearTimeout(afterCommit.current);
    // Always wait until the input's own handlers have committed their value.
    // Updating App during input capture can restore a controlled range's old
    // DOM value before its onChange runs, effectively freezing the slider.
    // This also reads the clamped value after number fields commit on blur.
    afterCommit.current = setTimeout(() => read(input), 0);
  }
  return { dimension, capture };
}
