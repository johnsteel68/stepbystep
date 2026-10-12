# Fondations mobiles

Cette référence complète le skill quand une décision concerne les contraintes de plateforme plutôt que le style.

## Points à vérifier

- Respecter les safe areas et les éléments système qui peuvent recouvrir le contenu.
- Concevoir pour plusieurs tailles, orientations, densités, langues et tailles de texte.
- Prévoir une zone tactile minimale de 44 pt sur iOS et 48 dp sur Android, sans supposer que la taille visuelle de l'icône suffit.
- Laisser assez d'espace entre deux contrôles pour éviter les activations accidentelles.
- Associer aux icônes et gestes un nom accessible, un état et une alternative quand ils portent une fonction importante.
- Tester les états chargement, vide, erreur, hors connexion, permission et succès.

## Sources de plateforme

- Apple Human Interface Guidelines, Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Apple, Positioning content relative to the safe area: https://developer.apple.com/documentation/uikit/positioning-content-relative-to-the-safe-area
- Material Design, Accessibility: https://m1.material.io/usability/accessibility.html
- Android Accessibility, touch target size: https://support.google.com/accessibility/android/answer/7101858
- WCAG 2.2, Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

## Source de direction anti-interface générique

Le système de direction reprend les idées publiques de TasteSkill v2 : lecture du brief avant la production, réglages de variation/mouvement/densité, verrous de cohérence, diversité de mise en page, règles anti-slop et préflight honnête.

- Documentation TasteSkill: https://www.tasteskill.dev/docs
- Prompt guide TasteSkill: https://www.tasteskill.dev/guide
- Site TasteSkill: https://www.tasteskill.dev/

Le skill ne copie pas une implémentation propriétaire. Il traduit ces principes dans un contexte mobile, en ajoutant les contraintes de geste, de plateforme, d'accessibilité et d'états produit.
