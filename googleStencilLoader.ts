import { inflateSync, strFromU8 } from 'fflate';
import { GOOGLE_STENCIL_DATA } from './googleStencilGlyphs.ts';

type Glyphs = Record<string, { advance: number; contours: number[][][] }>;
const cache = new Map<string, Glyphs>();

/** Inflate only the selected design, once. The other fonts remain compact
 * strings rather than thousands of parsed arrays in the initial render.
 * Cached outlines are shared read-only; consumers create translated copies.
 */
export function getGoogleStencilGlyphs(id: string): Glyphs | undefined {
  const source = GOOGLE_STENCIL_DATA[id];
  if (!source) return undefined;
  let glyphs = cache.get(id);
  if (!glyphs) {
    const packed = Uint8Array.from(atob(source.compressed), character => character.charCodeAt(0));
    glyphs = JSON.parse(strFromU8(inflateSync(packed))) as Glyphs;
    cache.set(id, glyphs);
  }
  return glyphs;
}
