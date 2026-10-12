/** Overlapping pages cover the entire control surface without relying on
 * manual scrolling. Prefer real row starts; always include the bottom edge. */
export function mobileControlPages(rows: number[], totalHeight: number, viewportHeight: number): number[] {
  if (viewportHeight < 1) return [0];
  const max = Math.max(0, totalHeight - viewportHeight), pages = [0];
  const overlap = Math.min(12, viewportHeight / 4);
  while (pages[pages.length - 1] < max - 2) {
    const top = pages[pages.length - 1], limit = top + viewportHeight - overlap;
    const candidates = rows.filter(row => row > top + viewportHeight * .4 && row <= limit);
    const end = Math.min(max, candidates.length ? candidates[candidates.length - 1] : limit);
    if (end <= top) break;
    pages.push(end);
  }
  return pages;
}
