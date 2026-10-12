# Images intégrées extraites des fichiers Blender

Les originaux sont conservés dans `Textures/`. Le script `extractBlendImages.mjs`
lit leurs blocs de données sans exécuter les scènes ou les scripts Blender.

- `blend-galvanized` : `john-steel_acier-galvanise.blend`, cartes couleur,
  déplacement, métal, normales et rugosité.
- `blend-aluminum-raw` : `john-steel_aluminium-brut.blend`, cartes couleur,
  métal, normales OpenGL et rugosité. La carte spéculaire extraite reste inutilisée.
- `blend-aluminum-five-bar` : `john-steel_aluminium-larme-5-barres.blend`,
  normales du relief cinq barres, associées à une couleur métallique neutre.
  Le dos et les chants restent lisses.

Il s'agit de la récupération des images intégrées, pas d'une conversion complète
des shaders Blender. Les matériaux sans images intégrées conservent leur rendu
existant. Les cartes sont associées à partir des noms et de l'ordre des images
embarquées ; le script ne reconstitue pas le graphe des nœuds.
