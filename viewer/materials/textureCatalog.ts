import type { SheetFinish } from '../../sheetGeometry';

// Texture dimensions are expressed in millimetres, matching the continuous sheet UVs.
export type TextureSet = {
  color: string;
  colorHighResolution?: string;
  normal?: string;
  roughness?: string;
  height?: string;
  metalness?: string;
  alpha?: string;
  tileSize: number;
};

const ambientMetalSet = (
  folder: string,
  asset: string,
  tileSize: number,
  resolution: '1K-JPG' | '2K-JPG' = '1K-JPG',
): TextureSet => {
  const map = (name: string, size: '1K-JPG' | '2K-JPG' | '4K-JPG' = resolution) => `/textures/${folder}/${asset}_${size}_${name}.jpg`;
  return {
    color: map('Color'),
    ...(resolution === '2K-JPG' ? { colorHighResolution: map('Color', '4K-JPG') } : {}),
    normal: map('NormalGL'),
    roughness: map('Roughness'),
    height: map('Displacement'),
    metalness: map('Metalness'),
    tileSize,
  };
};

export const TEXTURE_SETS = {
  // Fine, parallel grain like the supplied product reference, rather than
  // crossing scratches. The physical scale stays constant across every wing.
  inoxBrushedPbr: ambientMetalSet('brushed', 'Metal009', 200, '2K-JPG'),
  inoxRawPbr: {
    color: '/textures/john-steel_inox-brut/john-steel_inox-brut_couleur.jpg',
    height: '/textures/john-steel_inox-brut/john-steel_inox-brut_hauteur.jpg',
    metalness: '/textures/john-steel_inox-brut/john-steel_inox-brut_metallicite.jpg',
    normal: '/textures/john-steel_inox-brut/john-steel_inox-brut_normale.jpg',
    roughness: '/textures/john-steel_inox-brut/john-steel_inox-brut_rugosite.jpg',
    tileSize: 1500,
  },
  inoxBrightPbr: {
    color: '/textures/john-steel_inox-brut-et-brillant/john-steel_inox-brut-et-brillant_couleur.jpg',
    metalness: '/textures/john-steel_inox-brut-et-brillant/john-steel_inox-brut-et-brillant_metallicite.jpg',
    normal: '/textures/john-steel_inox-brut-et-brillant/john-steel_inox-brut-et-brillant_normale.jpg',
    roughness: '/textures/john-steel_inox-brut-et-brillant/john-steel_inox-brut-et-brillant_rugosite.jpg',
    tileSize: 1500,
  },
  blendRawSteel: {
    // Packed Metal019 maps from the user's replacement Aged Gunmetal material.
    color: '/textures/blend-raw-steel/image-1.jpg',
    height: '/textures/blend-raw-steel/image-2.jpg',
    metalness: '/textures/blend-raw-steel/image-3.jpg',
    normal: '/textures/blend-raw-steel/image-4.jpg',
    roughness: '/textures/blend-raw-steel/image-5.jpg',
    tileSize: 1500,
  },
  blendFiveBar: {
    color: '/textures/aluminum-five-bar/color.png',
    normal: '/textures/blend-aluminum-five-bar/normal.png',
    tileSize: 80,
  },
  blendGalvanized: {
    color: '/textures/blend-galvanized/image-1.jpg',
    height: '/textures/blend-galvanized/image-2.png',
    metalness: '/textures/blend-galvanized/image-3.png',
    normal: '/textures/blend-galvanized/image-4.webp',
    roughness: '/textures/blend-galvanized/image-5.webp',
    tileSize: 1200,
  },
  blendAluminumRaw: {
    color: '/textures/blend-aluminum-raw/image-1.jpg',
    metalness: '/textures/blend-aluminum-raw/image-2.jpg',
    normal: '/textures/blend-aluminum-raw/image-3.jpg',
    roughness: '/textures/blend-aluminum-raw/image-4.jpg',
    tileSize: 1400,
  },
  aluminumFiveBar: {
    color: '/textures/aluminum-five-bar/color.png',
    normal: '/textures/aluminum-five-bar/normal.png',
    roughness: '/textures/aluminum-five-bar/roughness.png',
    height: '/textures/aluminum-five-bar/height.png',
    metalness: '/textures/aluminum-five-bar/metalness.png',
    tileSize: 160,
  },
  leatherStainless: {
    // Neutral polished base; only the supplied-reference-derived relief
    // varies on this face. No directional brushed normal map.
    color: '/textures/silver/Metal049A_2K-JPG_Color.jpg',
    height: '/textures/stainless-leather/leather-height-v2.png',
    tileSize: 100,
  },
  rawSteel: ambientMetalSet('metal-raw', 'Metal041A', 1500, '2K-JPG'),
  brushed: ambientMetalSet('brushed', 'Metal009', 1200, '2K-JPG'),
  aluminum: ambientMetalSet('aluminum', 'Metal050A', 1400, '2K-JPG'),
  aluminumRawTextureCan: {
    color: '/textures/aluminum-raw/metal_0071_color_2k.jpg',
    colorHighResolution: '/textures/aluminum-raw/metal_0071_color_4k.jpg',
    normal: '/textures/aluminum-raw/metal_0071_normal_opengl_2k.webp',
    roughness: '/textures/aluminum-raw/metal_0071_roughness_2k.jpg',
    height: '/textures/aluminum-raw/metal_0071_height_2k.webp',
    metalness: '/textures/aluminum-raw/metal_0071_metallic_2k.jpg',
    tileSize: 1400,
  },
  polishedSilver: ambientMetalSet('silver', 'Metal049A', 1500, '2K-JPG'),
  mirrorStainless: {
    // Keep the polished reflection shader; only the supplied base color is needed.
    color: '/textures/john-steel_inox-poli-miroir/john-steel_inox-poli-miroir_couleur.jpg',
    tileSize: 1500,
  },
  galvanized: {
    color: '/textures/galvanized/metal_0010_color_2k.jpg',
    colorHighResolution: '/textures/galvanized/metal_0010_color_4k.jpg',
    normal: '/textures/galvanized/metal_0010_normal_opengl_2k.png',
    roughness: '/textures/galvanized/metal_0010_roughness_2k.jpg',
    height: '/textures/galvanized/metal_0010_height_2k.png',
    metalness: '/textures/galvanized/metal_0010_metallic_2k.jpg',
    tileSize: 1200,
  },
  perforated: {
    color: '/textures/john-steel_aluminium-perfore-rond/john-steel_aluminium-perfore-rond_couleur.jpg',
    normal: '/textures/john-steel_aluminium-perfore-rond/john-steel_aluminium-perfore-rond_normale.jpg',
    roughness: '/textures/john-steel_aluminium-perfore-rond/john-steel_aluminium-perfore-rond_rugosite.jpg',
    height: '/textures/john-steel_aluminium-perfore-rond/john-steel_aluminium-perfore-rond_hauteur.jpg',
    metalness: '/textures/john-steel_aluminium-perfore-rond/john-steel_aluminium-perfore-rond_metallicite.jpg',
    alpha: '/textures/john-steel_aluminium-perfore-rond/john-steel_aluminium-perfore-rond_opacite.png',
    tileSize: 90,
  },
  corten: {
    color: '/textures/corten/metal025-base-color-2k.jpg',
    colorHighResolution: '/textures/corten/metal025-base-color-4k-web.jpg',
    normal: '/textures/corten/metal025-normal-gl-2k.jpg',
    roughness: '/textures/corten/metal025-roughness-2k.jpg',
    height: '/textures/corten/metal025-displacement-2k.jpg',
    metalness: '/textures/corten/metal025-metalness-2k.jpg',
    tileSize: 1200,
  },
  tread: {
    color: '/textures/tread/base-color.png',
    normal: '/textures/tread/normal.png',
    roughness: '/textures/tread/roughness.png',
    height: '/textures/tread/height.png',
    metalness: '/textures/tread/metalness.png',
    tileSize: 300,
  },
  textureCanTread: {
    color: '/textures/tread-texturecan/metal_0069_color_1k.jpg',
    normal: '/textures/tread-texturecan/metal_0069_normal_opengl_1k.png',
    roughness: '/textures/tread-texturecan/metal_0069_roughness_1k.jpg',
    height: '/textures/tread-texturecan/metal_0069_height_1k.png',
    metalness: '/textures/tread-texturecan/metal_0069_metallic_1k.jpg',
    tileSize: 300,
  },
} satisfies Record<string, TextureSet>;

type TextureSetName = keyof typeof TEXTURE_SETS;
type FinishTextureProfile = {
  set: TextureSetName;
  roughness: number;
  metalness: number;
  bumpScale: number;
  normalScale: number;
  clearcoat: number;
  tint?: string;
  smoothTint?: string;
  oneSidedRelief?: boolean;
  leatherRelief?: boolean;
  mirrorFace?: boolean;
};

export const FINISH_TEXTURE_PROFILES: Record<SheetFinish, FinishTextureProfile> = {
  'steel-raw': { set: 'blendRawSteel', roughness: 0.64, metalness: 0.88, bumpScale: 0.08, normalScale: 0.28, clearcoat: 0.04 },
  'steel-galvanized': { set: 'blendGalvanized', roughness: 0.68, metalness: 0.88, bumpScale: 0.12, normalScale: 0.22, clearcoat: 0.04 },
  'steel-larme': { set: 'textureCanTread', roughness: 0.62, metalness: 0.88, bumpScale: 1.5, normalScale: 1, clearcoat: 0.1, smoothTint: '#8d929a', oneSidedRelief: true },
  'steel-corten': { set: 'corten', roughness: 0.82, metalness: 0.28, bumpScale: 0.12, normalScale: 0.24, clearcoat: 0.015 },
  'aluminum-raw': { set: 'blendAluminumRaw', roughness: 0.62, metalness: 0.78, bumpScale: 0, normalScale: 0.22, clearcoat: 0.08 },
  'aluminum-filmed': { set: 'aluminum', roughness: 0.7, metalness: 0.62, bumpScale: 0.025, normalScale: 0.12, clearcoat: 0.015, tint: '#eef1f4' },
  'aluminum-antitrace': { set: 'brushed', roughness: 0.6, metalness: 0.78, bumpScale: 0.035, normalScale: 0.24, clearcoat: 0.08, tint: '#e8edf1' },
  'aluminum-anodized': { set: 'aluminum', roughness: 0.52, metalness: 0.82, bumpScale: 0.035, normalScale: 0.18, clearcoat: 0.18, tint: '#e4eaf0' },
  'aluminum-perforated': { set: 'perforated', roughness: 0.64, metalness: 0.8, bumpScale: 0.02, normalScale: 0.32, clearcoat: 0.04 },
  'aluminum-larme': { set: 'blendFiveBar', roughness: 0.32, metalness: 1, bumpScale: 0, normalScale: 1, clearcoat: 0.1, tint: '#ffffff', smoothTint: '#c4cbd2', oneSidedRelief: true },
  // A satin metal, not a varnished or mirror surface. Subtle micro-relief
  // avoids turning the brushed grain into visibly raised grooves.
  'stainless-brushed': { set: 'inoxBrushedPbr', roughness: 0.38, metalness: 1, bumpScale: 0.008, normalScale: 0.08, clearcoat: 0, tint: '#f3f1ed' },
  'stainless-raw': { set: 'inoxRawPbr', roughness: 0.64, metalness: 0.92, bumpScale: 0.06, normalScale: 0.24, clearcoat: 0.18, tint: '#e5e9ed' },
  'stainless-bright': { set: 'inoxBrightPbr', roughness: 0.38, metalness: 0.96, bumpScale: 0, normalScale: 0.12, clearcoat: 0.42 },
  'stainless-mirror': { set: 'mirrorStainless', roughness: 0.035, metalness: 1, bumpScale: 0, normalScale: 0, clearcoat: 0, mirrorFace: true, oneSidedRelief: true, smoothTint: '#b6bdc5' },
  'stainless-antislip': { set: 'tread', roughness: 0.6, metalness: 0.9, bumpScale: 1.5, normalScale: 1, clearcoat: 0.1, tint: '#e1e5e9', smoothTint: '#c5c9ce', oneSidedRelief: true },
  'stainless-marine': { set: 'polishedSilver', roughness: 0.4, metalness: 0.97, bumpScale: 0.02, normalScale: 0.12, clearcoat: 0.38 },
  'stainless-marine-raw': { set: 'rawSteel', roughness: 0.61, metalness: 0.93, bumpScale: 0.055, normalScale: 0.23, clearcoat: 0.18, tint: '#e8ecef' },
  'stainless-leather': { set: 'leatherStainless', roughness: 0.32, metalness: 1, bumpScale: 0.45, normalScale: 0, clearcoat: 0, leatherRelief: true, oneSidedRelief: true, tint: '#e4e6e8', smoothTint: '#b6bdc5' },
  'stainless-magnetic': { set: 'rawSteel', roughness: 0.6, metalness: 0.72, bumpScale: 0.06, normalScale: 0.24, clearcoat: 0.12, tint: '#e1e5e9' },
};
