# Inox cuir — référence utilisateur

La vignette utilise `leather-reference.jpg`, copie inchangée de la photo fournie
par Roland (`tole-inox-cuir.jpg`). Ne pas utiliser cette photo comme couleur
PBR : elle contient déjà des reflets.

`leather-height-v2.png` est une carte de relief dérivée de cette référence
avec l’outil Imagegen intégré. C’est une approximation visuelle, pas une
mesure physique du relief industriel. Le dos et les chants restent lisses.
La répétition actuelle correspond à un carré de 100 mm ; cette échelle est
indicative, la photo ne comportant pas de règle.

## Prompt de génération

Edit this reference into ONE square seamless grayscale height map for a Three.js bumpMap of embossed stainless steel 'inox cuir'. Preserve the reference's distinctive dense maze-like wriggly, lobed tiny irregular engraved lines and their scale: approximately 50-70 small lobes across. NOT leather pores, NOT Voronoi polygon cells, NOT circles. Output only the flat grayscale elevation map, uniform lighting-free medium-light gray plateaus and darker shallow narrow valleys, rounded transitions, no shiny highlights, no shadows, no directional illumination, no large-scale variation or gradient, no white border. Seamless on all four edges. The topology should closely match this real steel pattern. White means higher, black means lower, use a moderate grayscale contrast. No text or objects. This is a technical texture map, NOT a shaded photo or a rendered scene.
