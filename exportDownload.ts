/** One gesture, one download: mobile browsers can block a second automatic file. */
export async function createManufacturingArchive(step: File, pdf: Blob): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const name = step.name.replace(/\.step$/i, '');
  const bytes = zipSync({
    [step.name]: new Uint8Array(await step.arrayBuffer()),
    [`${name}_Plan.pdf`]: new Uint8Array(await pdf.arrayBuffer()),
  });
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}

export function downloadExport(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.rel = 'noopener';
  document.body.appendChild(link); link.click(); link.remove();
  // Allow the browser to consume even larger PDFs before freeing the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
