import { useLayoutEffect, useState } from 'react';
import {
  getMinLegLength,
  MATERIAL_CONFIG,
  SHEET_FINISHES,
  type MaterialType,
  type SheetFinish,
} from '../sheetGeometry';

type GuidanceStage = 'material' | 'finish' | 'thickness';
type ThreeTips = [string, string, string];
type GuidanceCopy = { intro: string; bullets: ThreeTips };

const MATERIAL_TIPS: Record<MaterialType, GuidanceCopy> = {
  Steel: { intro: 'L’acier : le costaud qui se plie à vos idées.', bullets: [
    'Solide et simple à plier.', 'À protéger de l’humidité pour éviter la rouille.', 'Exemples : équerre, support mural, pied de meuble.',
  ] },
  Stainless: { intro: 'L’inox : du style, sans craindre la rouille du quotidien.', bullets: [
    'Résiste bien à la corrosion au quotidien.', 'Son aspect dépend de la finition : brossé, brillant ou miroir.', 'Exemples : crédence, capot, décoration intérieure.',
  ] },
  Aluminum: { intro: 'L’aluminium : léger dans la main, malin dans vos projets.', bullets: [
    'Environ 3 fois plus léger que l’acier à volume égal.', 'Plus tendre : il peut se marquer plus facilement.', 'Exemples : habillage, capot léger, décoration de jardin.',
  ] },
};

const FINISH_TIPS: Record<SheetFinish, GuidanceCopy> = {
  'steel-raw': { intro: 'Acier brut : prêt à prendre la forme de vos idées.', bullets: ['Nuance S355MC, robuste et pliable.', 'À protéger de l’humidité pour éviter la rouille.', 'Exemples : support, équerre ou pièce à peindre.'] },
  'steel-galvanized': { intro: 'Galvanisé : l’acier sort son bouclier contre la rouille.', bullets: ['Le zinc aide à protéger la surface.', 'Évitez l’eau qui stagne et les rayures profondes.', 'Exemples : habillage ou pièce destinée à l’extérieur.'] },
  'steel-larme': { intro: 'Acier larmé : du relief qui ne passe pas inaperçu.', bullets: ['Relief présent sur une seule face.', 'Le relief est sur le dessus ; le dos reste lisse.', 'Exemples : seuil, marche ou petite plateforme.'] },
  'steel-corten': { intro: 'Corten : une patine vivante pour vos idées au grand air.', bullets: ['La patine évolue au contact des intempéries.', 'Laissez l’eau s’écouler et la surface sécher.', 'Exemples : bordure, jardinière ou décoration extérieure.'] },
  'aluminum-raw': { intro: 'Alu brut : le poids plume prêt à se plier à vos envies.', bullets: ['Léger et facile à façonner.', 'Plus tendre que l’acier : il se marque plus vite.', 'Exemples : capot, habillage ou panneau décoratif.'] },
  'aluminum-filmed': { intro: 'Alu filmé : protégé pendant la pose, impeccable après.', bullets: ['Un film protège la face pendant la manipulation.', 'Retirez-le après installation.', 'Exemples : habillage ou pièce décorative ajustée sur place.'] },
  'aluminum-antitrace': { intro: 'Anti-traces : une surface faite pour rester présentable.', bullets: ['La finition aide à atténuer les marques.', 'Elle reste sensible aux rayures.', 'Exemples : façade ou panneau souvent manipulé.'] },
  'aluminum-anodized': { intro: 'Anodisé : une allure nette qui tient la distance.', bullets: ['Surface régulière et protégée.', 'Nettoyez avec un chiffon doux.', 'Exemples : façade, crédence ou décoration intérieure.'] },
  'aluminum-perforated': { intro: 'Perforé : il habille sans bloquer l’air ni la lumière.', bullets: ['Ses ouvertures laissent circuler l’air.', 'La tôle est ajourée : elle ne ferme pas complètement.', 'Exemples : cache-radiateur, grille ou panneau déco.'] },
  'aluminum-larme': { intro: 'Alu larmé : du relief pratique sans poids superflu.', bullets: ['Léger, avec relief sur une seule face.', 'Le dos de la plaque reste lisse.', 'Exemples : seuil, marche ou protection de sol.'] },
  'stainless-brushed': { intro: 'Inox brossé : le chic discret qui aime la cuisine.', bullets: ['Rendu satiné et moderne.', 'Essuyez dans le sens du brossage pour limiter les traces.', 'Exemples : crédence, fond de hotte ou habillage.'] },
  'stainless-raw': { intro: 'Inox brut : efficace, sobre, prêt pour le service.', bullets: ['Nuance 304L, résistante à la corrosion.', 'Aspect utilitaire, moins brillant qu’un miroir.', 'Exemples : support, capot ou pièce de cuisine.'] },
  'stainless-bright': { intro: 'Inox brillant : un peu d’éclat, beaucoup de caractère.', bullets: ['Surface lisse et lumineuse.', 'Les traces de doigts et rayures se voient.', 'Exemples : crédence, habillage ou décoration.'] },
  'stainless-mirror': { intro: 'Inox miroir : votre projet voit les choses en grand.', bullets: ['La surface réfléchit nettement la lumière.', 'Protégez-la des rayures et nettoyez-la doucement.', 'Exemples : crédence, décoration ou panneau décoratif.'] },
  'stainless-antislip': { intro: 'Inox antidérapant : du relief là où ça compte.', bullets: ['Relief présent sur une seule face.', 'Le relief est sur le dessus ; le dos reste lisse.', 'Exemples : seuil ou marche en zone de passage.'] },
  'stainless-marine': { intro: 'Inox marin : il garde le cap près de la mer.', bullets: ['Nuance 316L adaptée aux environnements marins.', 'Rincez les dépôts salins pour préserver la surface.', 'Exemples : habillage ou pièce exposée à l’air marin.'] },
  'stainless-marine-raw': { intro: 'Inox marin brut : taillé pour les embruns, pas pour la légèreté.', bullets: ['Nuance 316L pour l’air salin.', 'Forte épaisseur : poids et effort de pliage augmentent.', 'Exemples : support ou pièce robuste en bord de mer.'] },
  'stainless-leather': { intro: 'Inox finition cuir : une texture qui a du répondant.', bullets: ['Son grain donne du relief à la surface.', 'Finition décorative : évitez les produits abrasifs.', 'Exemples : façade, crédence ou panneau déco.'] },
  'stainless-magnetic': { intro: 'Inox magnétique : votre panneau devient pense-bête.', bullets: ['Un aimant peut adhérer à cette nuance 430.', 'Plus adapté à l’intérieur qu’à un environnement marin.', 'Exemples : panneau mémo ou habillage intérieur.'] },
};

function adviceTips(stage: GuidanceStage, material: MaterialType, finish: SheetFinish, thickness: number, bendCount: number): GuidanceCopy {
  if (stage === 'material') return MATERIAL_TIPS[material];
  if (stage === 'finish') return FINISH_TIPS[finish];

  const density = MATERIAL_CONFIG[material].density;
  const weight = (density * thickness).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const stiffness = thickness <= 2
    ? 'Fine et légère : prévoyez des appuis rapprochés si elle porte.'
    : thickness <= 4
      ? 'Un bon compromis pour une pièce compacte.'
      : thickness <= 6
        ? 'Plus épaisse : elle résiste mieux à la flexion, à forme égale.'
        : 'Très épaisse : poids et effort de pliage augmentent nettement.';
  const bendTip = `Pour le pliage, aile d’au moins ${getMinLegLength(thickness)} mm.`;
  const thirdTip = finish.includes('larme')
    ? 'Repère : relief sur une face, mais pas de charge garantie sans calcul.'
    : 'Exemples : crédence, couvercle de regard ou panneau déco selon les appuis.';

  return {
    intro: `${thickness} mm : le bon équilibre, c’est celui de votre projet.`,
    bullets: [`Poids indicatif : environ ${weight} kg/m², hors relief et découpes.`, stiffness, bendCount > 0 ? bendTip : thirdTip],
  };
}

export default function MaterialGuidance({
  stage, material, finish, thickness, bendCount,
}: {
  stage: GuidanceStage;
  material: MaterialType;
  finish: SheetFinish;
  thickness: number;
  bendCount: number;
}) {
  const copy = adviceTips(stage, material, finish, thickness, bendCount);
  const message = [`“${copy.intro}”`, ...copy.bullets].join('\n');
  const name = stage === 'material'
    ? MATERIAL_CONFIG[material].name
    : stage === 'finish'
      ? `${MATERIAL_CONFIG[material].name.split(' ')[0]} ${SHEET_FINISHES[finish].name}`
      : `${MATERIAL_CONFIG[material].name.split(' ')[0]} · ${thickness} mm`;
  const [typed, setTyped] = useState('');

  useLayoutEffect(() => {
    let current = '';
    setTyped('');
    const timer = window.setInterval(() => {
      if (current.length < message.length) {
        current = message.slice(0, current.length + 1);
      } else {
        window.clearInterval(timer);
        return;
      }
      setTyped(current);
    }, 28);
    return () => window.clearInterval(timer);
  }, [message]);

  const lines = typed.split('\n');
  const isComplete = typed.length === message.length;

  return (
    <div className="material-guidance" aria-live="polite" aria-label="Conseils matière">
      <strong className="material-guidance-name">{name}</strong>
      <ul className="material-guidance-bullets">
        {lines.map((line, index) => index === 0 ? (
          <li className="material-guidance-intro" key="intro"><span>{line}{index === lines.length - 1 && !isComplete && <i className="material-guidance-cursor" aria-hidden="true" />}</span></li>
        ) : (
          <li key={`tip-${index}`}>
            <i className="material-guidance-hash" aria-hidden="true">#</i>
            <span>{line}{index === lines.length - 1 && !isComplete && <i className="material-guidance-cursor" aria-hidden="true" />}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
