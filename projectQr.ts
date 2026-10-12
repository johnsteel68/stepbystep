import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';

/** Reuse the viewer's QR encoder, but keep PDF modules vector-sharp at any
 * print resolution. Four empty modules are retained as the scanner quiet zone.
 * Very large projects retain a clickable link instead of an unreadable QR. */
export function createProjectQr(link: string) {
  if (!link || link.length > 2200) return null;
  const svg = renderToStaticMarkup(createElement(QRCodeSVG, {
    value: link, level: 'M', boostLevel: false, marginSize: 4,
    fgColor: '#000000', bgColor: '#ffffff',
  }));
  const size = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
  const path = svg.match(/<path fill="#000000" d="([^"]+)"/)?.[1];
  if (!size || !path) throw new Error('Encodage QR indisponible.');
  // QRCodeSVG emits one horizontal rectangle per run of dark modules.
  // Validate the complete path so a future encoder update cannot silently
  // produce a partial, unscannable code.
  const run = /M(\d+)[ ,](\d+)\s*h(\d+)v1H(\d+)z/g;
  const rectangles = Array.from(path.matchAll(run), match => {
    if (match[1] !== match[4]) throw new Error('Contour QR invalide.');
    return { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]) };
  });
  if (!rectangles.length || path.replace(run, '').trim()) throw new Error('Contour QR non reconnu.');
  return { size, rectangles };
}
