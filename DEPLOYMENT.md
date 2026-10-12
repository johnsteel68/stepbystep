# Mise à jour de stepbystep.john-steel.com

Le site est servi par Nginx sur le port interne 8080, derrière Caddy,
sur le réseau Docker externe `web-network`. Aucun port hôte n'est publié.

## Publication depuis une machine avec Docker opérationnel

Renseigner `.env` depuis `.env.example`, sans versionner le mot de passe.
Le serveur de connexion doit correspondre au domaine de `REGISTRY_IMAGE`.

```sh
sh deploy-docker.sh
```

Le script construit et pousse une image `linux/amd64` dans le registry.
Le build du site est copié depuis `dist/client`; `dist/server` est le service
MCP distinct et n'est pas exécuté par ce conteneur Nginx.

Après publication réussie, télécharger et recréer le conteneur depuis
le dossier Compose sur le serveur avec un accès autorisant Docker :

```sh
docker compose pull app
docker compose up -d --no-build app
```

La clé dédiée ci-dessous redémarre le conteneur existant. La vérification
du 12 octobre 2026 a montré qu'elle ne charge pas la nouvelle image :

```sh
ssh -T -p 2222 -i ~/.ssh/vps_restart_key johnsteel_admin@72.61.108.238
```

Cet accès exécute une commande dédiée au conteneur et ne fournit pas
nécessairement un shell. `-T` évite la demande de terminal PTY.
Vérifier ensuite le site et le chargement des nouveaux fichiers JavaScript.

Si le compose du serveur doit être mis à jour, son administrateur doit
installer `docker-compose.yml` puis lancer `docker compose pull app` et
`docker compose up -d --no-build app` dans le dossier de déploiement.

## Publication via GitHub Actions

Si Docker local est indisponible, le workflow manuel
`.github/workflows/publish-docker.yml` construit l'image AMD64,
valide Nginx avec les restrictions du conteneur, puis publie les tags
du commit et `latest` au registry. Les identifiants sont stockés dans
les secrets du dépôt `STEP_REGISTRY_USER` et `STEP_REGISTRY_PASSWORD`.

```sh
gh workflow run publish-docker.yml --repo johnsteel68/stepbystep --ref main
gh run list --repo johnsteel68/stepbystep --workflow publish-docker.yml
```

Attendre une exécution réussie avant de télécharger et recréer le conteneur
sur le serveur. Le seul redémarrage SSH ne suffit pas à appliquer l'image.

## Dépôt Git

Le dépôt est `https://github.com/johnsteel68/stepbystep`, branche `main`.
