import * as THREE from 'three';
import type { LegConfig, LegTransform, HoleShape } from '../../sheetGeometry';

// Preview/CSG cutters only. STEP exports retain analytical OpenCascade curves.
// Profile coordinates use XY; sheet width uses Z. All distances are millimetres.
export function createOblongBufferGeometry(
  length: number, 
  width: number, 
  thickness: number, 
  orientation: 'along_length' | 'along_width' = 'along_length'
): THREE.BufferGeometry {
  const L = Math.max(2, length);
  const W = Math.max(1, width);
  const r = Math.min(W / 2, L / 2);
  const straight = Math.max(0, L - 2 * r);
  const hs = straight / 2;

  const shape = new THREE.Shape();
  if (orientation === 'along_length') {
    shape.absarc(hs, 0, r, -Math.PI / 2, Math.PI / 2, false);
    shape.absarc(-hs, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  } else {
    shape.absarc(0, hs, r, 0, Math.PI, false);
    shape.absarc(0, -hs, r, Math.PI, Math.PI * 2, false);
  }
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: thickness * 4,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 16,
  });
  geom.center();
  geom.rotateX(Math.PI / 2);
  return geom;
}

export function createRoundedRectShape(length: number, width: number, radius: number) {
  const halfLength = Math.max(1, length) / 2;
  const halfWidth = Math.max(1, width) / 2;
  const r = THREE.MathUtils.clamp(radius, 0, Math.min(halfLength, halfWidth));
  const shape = new THREE.Shape();
  if (r < 0.001) {
    shape.moveTo(-halfLength, -halfWidth);
    shape.lineTo(halfLength, -halfWidth);
    shape.lineTo(halfLength, halfWidth);
    shape.lineTo(-halfLength, halfWidth);
  } else {
    shape.moveTo(-halfLength + r, -halfWidth);
    shape.lineTo(halfLength - r, -halfWidth);
    shape.absarc(halfLength - r, -halfWidth + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(halfLength, halfWidth - r);
    shape.absarc(halfLength - r, halfWidth - r, r, 0, Math.PI / 2, false);
    shape.lineTo(-halfLength + r, halfWidth);
    shape.absarc(-halfLength + r, halfWidth - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(-halfLength, -halfWidth + r);
    shape.absarc(-halfLength + r, -halfWidth + r, r, Math.PI, Math.PI * 1.5, false);
  }
  shape.closePath();
  return shape;
}

export function createRoundedRectBufferGeometry(length: number, width: number, depth: number, radius: number) {
  const geometry = new THREE.ExtrudeGeometry(createRoundedRectShape(length, width, radius), {
    depth,
    bevelEnabled: false,
    curveSegments: 12,
  });
  geometry.center();
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function createVectorCutterGeometry(points: { x: number; y: number }[], thickness: number) {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, p.y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness * 4, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -thickness * 2);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function createFlatHolePreviewGeometry(leg: LegConfig, shapeType: HoleShape, orientation: 'along_length' | 'along_width', cornerRadius = 0) {
  const shape = new THREE.Shape();
  const diameter = Math.max(2, leg.holeDiam || 5);
  const length = Math.max(2, leg.holeLength || 25);
  const width = Math.max(2, leg.holeWidth || 12);
  if (leg.holeContour?.length) {
    // Flat preview uses screen-up Y, while the developed sheet/text datum
    // uses downwards offsets. Reverse local Y as well as the cutout centre.
    shape.moveTo(leg.holeContour[0].x, -leg.holeContour[0].y);
    for (const point of leg.holeContour.slice(1)) shape.lineTo(point.x, -point.y);
    shape.closePath();
  } else if (shapeType === 'round') {
    shape.absarc(0, 0, diameter / 2, 0, Math.PI * 2, false);
  } else if (shapeType === 'square') {
    const rounded = createRoundedRectShape(diameter, diameter, cornerRadius);
    shape.copy(rounded);
  } else if (shapeType === 'octagonal') {
    const radius = (diameter / 2) / Math.cos(Math.PI / 8);
    for (let index = 0; index < 8; index++) {
      const angle = (index * Math.PI) / 4 + Math.PI / 8;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      if (index === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
  } else if (shapeType === 'rect') {
    const halfLength = (orientation === 'along_length' ? length : width) / 2;
    const halfWidth = (orientation === 'along_length' ? width : length) / 2;
    shape.copy(createRoundedRectShape(halfLength * 2, halfWidth * 2, cornerRadius));
  } else {
    const longSize = length;
    const shortSize = width;
    const radius = Math.min(shortSize / 2, longSize / 2);
    const straightHalf = Math.max(0, (longSize - 2 * radius) / 2);
    if (orientation === 'along_length') {
      shape.absarc(straightHalf, 0, radius, -Math.PI / 2, Math.PI / 2, false);
      shape.absarc(-straightHalf, 0, radius, Math.PI / 2, Math.PI * 1.5, false);
    } else {
      shape.absarc(0, straightHalf, radius, 0, Math.PI, false);
      shape.absarc(0, -straightHalf, radius, Math.PI, Math.PI * 2, false);
    }
    shape.closePath();
  }
  return new THREE.ShapeGeometry(shape, 24);
}

export function createOctagonBufferGeometry(diam: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const d = Math.max(1, diam);
  const R = (d / 2) / Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 + Math.PI / 8;
    const px = R * Math.cos(angle);
    const pz = R * Math.sin(angle);
    if (i === 0) shape.moveTo(px, pz);
    else shape.lineTo(px, pz);
  }
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: thickness * 4,
    bevelEnabled: false,
    steps: 1,
  });
  geom.center();
  geom.rotateX(Math.PI / 2);
  return geom;
}

/**
 * Découpe le coin extérieur d'une extrémité du développé à plat.
 *
 * Le développé est extrudé dans Z, mais un rayon de coin se trouve sur la
 * face de l'aile : ses deux axes sont donc la longueur de l'aile et Z, et
 * son axe de traversée est la normale du profil 2D. L'ancienne version
 * extrudait le quart de cercle dans le mauvais repère (Y), ce qui produisait
 * uniquement l'étiquette R… sans enlever de matière.
 */
export function createFlatCornerCutGeometry(
  radius: number,
  side: 'left' | 'right',
  thickness: number,
  legT: LegTransform,
): THREE.BufferGeometry {
  const acrossSign = side === 'left' ? 1 : -1;
  const r = Math.max(0.5, radius);
  // Dépasser volontairement les deux bords extérieurs évite les faces
  // coplanaires dans le booléen CSG. Le dépassement est hors matière et ne
  // change donc pas le rayon, mais supprime aussi le petit "cadre" carré.
  const outside = Math.max(r, thickness * 4);
  const shape = new THREE.Shape();
  shape.moveTo(-outside, -outside);
  shape.lineTo(r, -outside);
  shape.lineTo(r, 0);
  const cornerSegments = 32;
  for (let i = 1; i <= cornerSegments; i++) {
    const angle = -Math.PI / 2 - (Math.PI / 2) * (i / cornerSegments);
    shape.lineTo(r + r * Math.cos(angle), r + r * Math.sin(angle));
  }
  // Le centre du cercle est (r, r) dans les deux axes dirigés vers la tôle.
  // Seule la matière extérieure à ce quart de cercle est retirée.
  shape.lineTo(-outside, r);
  shape.closePath();

  // Keep the cutter confined to the plate thickness. A wide cutter (4×t)
  // can pass through a nearby folded wing and remove it as well, which makes
  // large corner radii look like broken/intersecting sheet metal. A tiny
  // clearance on both faces is enough for a stable CSG subtraction.
  const cutDepth = Math.max(0.5, thickness + 0.2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: cutDepth,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 48,
  });

  // Transforme (longueur d'aile, largeur, traversée) vers
  // (profil X, profil Y, largeur Z), autour du coin placé à l'origine.
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const basisDeterminant = acrossSign * (
    legT.direction.y * legT.normal.x - legT.direction.x * legT.normal.y
  );
  // Le volume est centré sur l'épaisseur : inverser sa normale de traversée
  // ne change donc pas sa position, mais évite de fournir au BSP une base
  // miroir pour les deux coins diagonaux opposés.
  const throughNormalSign = basisDeterminant < 0 ? -1 : 1;
  const throughNormalX = legT.normal.x * throughNormalSign;
  const throughNormalY = legT.normal.y * throughNormalSign;
  for (let i = 0; i < positions.count; i++) {
    const along = positions.getX(i);
    const across = positions.getY(i) * acrossSign;
    const through = positions.getZ(i) - cutDepth / 2;
    positions.setXYZ(
      i,
      along * legT.direction.x + through * throughNormalX,
      along * legT.direction.y + through * throughNormalY,
      across,
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
