# Développement STEPbySTEP

## Lancer et vérifier

- `npm run dev -- --host 127.0.0.1` : aperçu local sur le port 3000.
- `npm run lint` : vérification TypeScript.
- `npm test` : tests de non-régression (Node 22.6 ou plus récent).
- `npm run build` : compilation de production dans `dist/`.

## Organisation

- `App.tsx` orchestre l'état de la pièce et les actions métier.
- `workflow.ts` définit l'ordre des étapes, leur titre et le pli/l'aile concerné.
- `components/` contient les contrôles de matière, épaisseur, dimensions, plis,
  arrondis, perçages, navigation et outils du visualiseur.
- `viewerTypes.ts` décrit le contrat entre l'interface et le visualiseur.
- `Viewer.tsx` garde la scène 3D, les animations et l'interaction avec la pièce.
  Il est chargé séparément pour ne pas bloquer l'affichage des contrôles.
- `sheetGeometry.ts` reste la source des contraintes et calculs de géométrie.
- `holeEditing.ts` isole les dimensions du prochain trou, sans modifier ceux
  déjà placés.
- `index.css` regroupe les couleurs, espacements et états des composants.

## Responsive

Au-dessus de 860 px : panneau à gauche et visualiseur à droite.
En dessous : visualiseur en haut et panneau de réglages paginé en dessous.
Le panneau peut être agrandi ou masqué sans démonter les contrôles. Les champs
restent accessibles au clavier ; la hauteur suit le viewport visible, y compris
quand le clavier virtuel apparaît. Le mode intégré conserve sa disposition.

## Vérifications manuelles avant livraison

1. Parcourir les étapes avec 1 puis 4 plis et basculer entre Guidé et Pro.
2. Saisir une longueur inférieure à 30 mm, puis vérifier la valeur corrigée.
3. Régler les rayons communs et individuels, puis revenir en vue 3D.
4. Ajouter deux trous de formes/dimensions différentes ; vérifier que le second
   ne modifie pas le premier. Tester les coins arrondis et l'orientation.
5. Quitter le placement par Annuler ou en changeant d'étape.
6. Vérifier à 390 px et sur ordinateur : champs lisibles, absence de débordement,
   navigation accessible. Les actions d'export sont dans Commander.

Les retours haptiques restent facultatifs : les navigateurs sans API de
vibration fonctionnent normalement sans vibration.

## Séparation des responsabilités

- `projectDefaults.ts` crée une pièce indépendante (1 pli, trous de 5 mm).
- `hooks/useManufacturingExports.ts` possède les états des téléchargements et
  de l’envoi au deck. Chaque opération fige la pièce avant de charger les outils
  lourds : modifier l’éditeur pendant un export ne modifie pas son contenu.
- `deckUpload.ts` gère le contrat HTTP, le délai maximal et la validation de
  la destination. Les tests utilisent un transport injecté, jamais le service réel.
- `lifecycle.ts` partage l’initialisation WASM entre les exports concurrents.
  Une promesse rejetée n’est pas conservée : le prochain export peut réessayer.
- `viewer/materials/` sépare le catalogue, le chargement des images et les
  matériaux. Les images du cache sont partagées ; seules les copies orientées
  pour le plan et les matériaux propres à la scène sont libérés par leurs propriétaires.
- `viewer/geometry/cutters.ts` contient uniquement les volumes de découpe du
  visualisateur. Le STEP conserve ses courbes analytiques OpenCascade.
- `viewer/camera/` pilote le cadrage et les transitions sans modifier la pièce.
- `viewer/annotations/` contient cotes, pastilles et surfaces de sélection.
  Les objets Three.js montés via `primitive` nécessitent une libération explicite :
  le retrait de la balise ne libère pas automatiquement leurs ressources GPU.
- `components/RenderBoundary.tsx` isole une panne de rendu. Une erreur de la
  scène laisse les contrôles et l’état de la pièce montés.

## Organisation des interactions et règles de maintenance

- `MobileControlDeck` ne contient que la présentation. Le hook
  `useMobileControlPages` mesure les champs et possède les observateurs DOM ;
  `mobileControlPages` calcule les limites des pages sans dépendre du navigateur.
- `useMobileWorkspace` possède le mode du panneau et la hauteur visible.
  Le seuil `MOBILE_MEDIA_QUERY` doit rester cohérent avec les 860 px de la CSS.
- `MeasureTool` affiche les repères. `useMeasurementSelection` possède les
  événements ; `measurementPicking` sélectionne les repères visibles ;
  `measurementGeometry` calcule les distances en millimètres.
- `ActiveBendCue` vérifie la présence du pli avant de monter son annotation.
  Ne pas introduire de retour conditionnel avant des hooks dans cette annotation.

Les commentaires expliquent une contrainte ou une décision, pas chaque ligne.
Nommer les tolérances avec leur unité, isoler les calculs testables, et libérer
les événements, observateurs et ressources GPU dans le composant qui les crée.
Un nettoyage de code ne doit pas changer les règles de fabrication ou les
conventions du PDF/STEP : ajouter un test si une correction de comportement
est nécessaire. Éviter une réécriture globale du visualiseur sans vérifications.

## Repères géométriques à préserver

Les distances sont en millimètres. Le profil est dans XY, la largeur dans Z.
Le dernier segment peut utiliser le bord libre comme origine locale : ne pas
interpréter directement son `holeDist` comme une coordonnée globale du développé.
Le plan, le STEP et le visualisateur doivent conserver cette convention.

Le relief larmé appartient à une seule face. Les chants, le dos et les parois
des trous utilisent un métal lisse. Le matériau de découpe doit rester une
instance distincte : le réutiliser pour plusieurs groupes CSG peut rendre une
plaque entièrement invisible.

## Pannes et récupération

1. Image de texture indisponible : carte neutre, pièce visible et avertissement.
   Ce rendu simplifié ne change pas la géométrie du STEP.
2. Perte du contexte WebGL : message contextualisé, bouton Réessayer ; l’éditeur
   reste monté. Un rechargement complet peut perdre les changements non partagés.
3. Module JavaScript périmé après publication : Réessayer peut ne pas suffire,
   car le navigateur conserve le module rejeté ; proposer un rechargement.
4. OpenCascade indisponible : erreur d’export et initialisation retentable.
5. Deck renvoyant du HTML ou une destination inattendue : erreur explicite,
   aucune navigation. Un HTTP 200 ne constitue pas à lui seul un succès.

Le test du ZIP doit aller au-delà du message de succès : ouvrir les deux fichiers,
réimporter le STEP, vérifier le solide et son volume, puis lire toutes les pages
du PDF. Le contexte WebGL du rendu PDF est détruit volontairement à sa fermeture ;
son message de destruction n’est pas une panne du visualisateur principal.
