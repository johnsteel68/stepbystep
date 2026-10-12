#!/bin/sh
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  printf '%s\n' "Fichier .env créé depuis .env.example. Ajoutez le mot de passe du registry, puis relancez ce script."
  exit 1
fi

read_env() {
  awk -v key="$1" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      prefix = key "="
      if (index(line, prefix) == 1) {
        value = substr(line, length(prefix) + 1)
        first = substr(value, 1, 1)
        last = substr(value, length(value), 1)
        if ((first == "\"" && last == "\"") || (first == "\047" && last == "\047")) {
          value = substr(value, 2, length(value) - 2)
        }
        print value
        exit
      }
    }
  ' .env
}

REGISTRY_LOGIN_HOST=$(read_env REGISTRY_LOGIN_HOST)
REGISTRY_USER=$(read_env REGISTRY_USER)
REGISTRY_PASSWORD=$(read_env REGISTRY_PASSWORD)
REGISTRY_IMAGE=$(read_env REGISTRY_IMAGE)
IMAGE_TAG=$(read_env IMAGE_TAG)

: "${REGISTRY_LOGIN_HOST:?Définissez REGISTRY_LOGIN_HOST dans .env}"
: "${REGISTRY_USER:?Définissez REGISTRY_USER dans .env}"
: "${REGISTRY_PASSWORD:?Définissez REGISTRY_PASSWORD dans .env}"
: "${REGISTRY_IMAGE:?Définissez REGISTRY_IMAGE dans .env}"
: "${IMAGE_TAG:?Définissez IMAGE_TAG dans .env}"

printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_LOGIN_HOST" \
  --username "$REGISTRY_USER" --password-stdin

docker buildx build --pull --platform linux/amd64 --push \
  --tag "$REGISTRY_IMAGE:$IMAGE_TAG" .

printf '%s\n' "Image linux/amd64 construite et poussée : $REGISTRY_IMAGE:$IMAGE_TAG. Aucun conteneur n’a été démarré sur cette machine."
