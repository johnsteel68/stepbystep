# Interaction et sensation mobile

Cette référence synthétise les principes publics du dépôt `emilkowalski/skills` utiles à ce skill. Elle ne remplace pas la documentation de la librairie utilisée.

## Décision d'animation

Avant d'écrire une animation, décider si elle est nécessaire, puis nommer sa fonction : feedback, spatial, state, explanation ou delight. Les actions fréquentes doivent être instantanées ou presque. Les animations rares peuvent porter davantage d'expression.

## Choix de primitive

- transition d'état simple : transition CSS ou primitive d'état native ;
- montage, démontage ou reflow : layout animation ;
- écran à écran : navigation native ;
- doigt, drag ou scroll continu : valeur partagée et animation sur le thread UI en React Native ;
- sheet, drawer ou geste interrompu : spring avec transfert de vélocité ;
- mouvement sans doigt : timing court, `ease-out` pour entrer/sortir et `ease-in-out` pour se déplacer.

Éviter `ease-in` seul pour les éléments d'interface. Ne pas animer les onglets comme s'ils représentaient une profondeur. Ne pas animer `height`, `margin` ou d'autres propriétés de layout à chaque frame quand `transform` ou `opacity` suffit.

## Mobile web natif

Pour un site mobile ou une PWA :

- isoler les styles `:hover` dans `@media (hover: hover) and (pointer: fine)` ;
- fournir un feedback tactile `:active` et `touch-action: manipulation` ;
- utiliser `100dvh` pour un shell qui suit la barre du navigateur et `100svh` pour une hauteur stable ;
- gérer la notch et la home indicator avec `viewport-fit=cover` et les variables `env(safe-area-inset-*)` ;
- conserver le zoom accessible et éviter les champs de moins de 16 px sur iOS ;
- utiliser `overscroll-behavior` plutôt qu'un `touchmove` avec `preventDefault()` pour contrôler les chaînes de scroll ;
- vérifier le résultat sur un appareil physique, avec clavier ouvert et en paysage.

## Sources

- Dépôt: https://github.com/emilkowalski/skills
- `mobile-native`: https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md
- `animate-expo`: https://github.com/emilkowalski/skills/blob/main/skills/animate-expo/SKILL.md
- `emil-design-eng`: https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md
