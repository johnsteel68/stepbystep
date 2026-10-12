<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8d964ba0-350e-496f-b917-15cb57fce45e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
# Déploiement Docker

L’image est construite puis poussée dans `registry.steelhub.john-steel.com/step-generator`. Le conteneur Nginx écoute sur le port interne `8080` et n’expose aucun port de l’hôte ; Caddy doit le joindre sur le réseau Docker externe `web-network` (cible : `step-generator:8080`).

1. Copier `.env.example` en `.env` et renseigner `REGISTRY_PASSWORD`. L’hôte de connexion doit correspondre à celui de l’image (`registry.steelhub.john-steel.com`).
2. Vérifier que le réseau `web-network` existe et que la configuration Caddy route le domaine voulu vers `step-generator:8080`.
3. Depuis le dossier du projet, lancer `sh deploy-docker.sh` pour construire et pousser l’image. Le script ne démarre aucun conteneur ; sur le VPS, récupérer ensuite l’image avec `docker compose pull app`, puis démarrer le service lorsque vous le souhaitez.

Le script se connecte au registre, construit l’image et la pousse, sans lancer l’application. `.env` est ignoré par Git et son contenu n’est pas injecté dans le conteneur. Les identifiants ne sont donc pas exposés à l’application. Le mot de passe de votre message étant masqué, il doit être renseigné dans `.env` sur la machine qui réalise le build.
