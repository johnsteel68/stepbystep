# Texture sources

- `corten/`: **Metal 025**, from [ambientCG](https://ambientcg.com/view?id=Metal025). CC0. Bundled 4K color for large displays, with 2K color, OpenGL normal, roughness, displacement and metalness maps.
- `metal-raw/`: **Metal 041 A**, from [ambientCG](https://ambientcg.com/view?id=Metal041A). CC0 1.0. Bundled 4K color for large displays, with 2K color, OpenGL normal, roughness, displacement and metalness maps.
- `brushed/`: **Metal 009**, from [ambientCG](https://ambientcg.com/view?id=Metal009). CC0 1.0. Bundled 4K color for large displays, with 2K color, OpenGL normal, roughness, displacement and metalness maps.
- `aluminum/`: **Metal 050 A**, from [ambientCG](https://ambientcg.com/view?id=Metal050A). CC0 1.0. Bundled 4K color for large displays, with 2K color, OpenGL normal, roughness, displacement and metalness maps.
- `aluminum-raw/`: **Scratched Aluminium Metal Sheet (Metal 0071)**, from [TextureCan](https://www.texturecan.com/details/539/). CC0 1.0, including redistribution with projects. Bundled compressed 4K color for large displays, with 2K color and PBR maps; the 16-bit normal and height maps are quantized to 8-bit (as decoded by browsers) and stored as lossless WebP. Used only for the raw aluminum finish.
- `silver/`: **Metal 049 A**, from [ambientCG](https://ambientcg.com/view?id=Metal049A). CC0 1.0. Bundled 4K color for large displays, with 2K color, OpenGL normal, roughness, displacement and metalness maps.
- `stainless-mirror/`: **Metal 012**, from [ambientCG](https://ambientcg.com/view?id=Metal012). CC0 1.0. Bundled 4K color for large displays, with 2K color, OpenGL normal, roughness, displacement and metalness maps; used only for the stainless mirror finish.
- `galvanized/`: **Galvanized Metal Sheet (Metal 0010)**, from [TextureCan](https://www.texturecan.com/details/67/). CC0 1.0, including redistribution with projects. Bundled compressed 4K color for large displays, with 2K color and PBR maps for mobile-friendly rendering.
- `perforated/`: **Sheet Metal 001**, from [ambientCG](https://ambientcg.com/view?id=SheetMetal001). CC0 1.0. Bundled 1K PNG color, OpenGL normal, roughness, displacement, metalness and opacity maps.
- `tread/`: **Diamond Plate**, generated/exported from [ProcTexture](https://proctexture.com/textures/metal/plate/diamond-plate). CC0; bundled 1K PBR maps (base color, height, normal, roughness, AO and metalness).
- `tread-texturecan/`: **Dirt Tread Plate Metal Texture (Metal 0069)**, from [TextureCan](https://www.texturecan.com/details/508/). CC0 1.0. Bundled 1K color, OpenGL normal, roughness, height and metallic maps; used only for the steel tread finish.

ambientCG and TextureCan permit free commercial use under CC0. All selected maps are bundled locally, so the viewer does not make third-party texture requests at runtime. Finish variants reuse the appropriate metal texture set with distinct surface-response settings; the perforated finish uses an opacity map for its visual pattern.
