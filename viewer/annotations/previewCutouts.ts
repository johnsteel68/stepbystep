/** Text paths must remain visible, but only physical holes get a number. */
export function numberPreviewCutouts<T extends { textCutout?: boolean }>(cutouts: T[]) {
  let number = 0;
  return cutouts.map(cutout => ({ ...cutout, number: cutout.textCutout ? undefined : ++number }));
}
