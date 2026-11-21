#!/bin/sh
# Runs on the NAS (piped over SSH by deploy.yml): nas-deploy.sh <deploy-dir> <image> <tag>
set -eu

DEPLOY_DIR=$1
IMAGE=$2
TAG=$3
# Synology installs docker outside the default non-interactive SSH PATH.
PATH=/usr/local/bin:$PATH

cd "$DEPLOY_DIR"
if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi

APP_ENV=$(sed -n 's/^APP_ENV=//p' .env | tr -d '"' | head -n 1)
[ -n "$APP_ENV" ] || { echo "APP_ENV missing in $DEPLOY_DIR/.env"; exit 1; }
CONTAINER="community-site-$APP_ENV"
PREV=$(cat .deployed-tag 2>/dev/null || true)

mv compose.yaml.new compose.yaml
echo "Pulling $IMAGE:$TAG"
docker pull "$IMAGE:$TAG"

echo "Stopping ${PREV:-<none>}"
IMAGE_TAG=${PREV:-$TAG} $COMPOSE down

if [ -n "$PREV" ]; then
  echo "Copying data/pglite to data/pre-deploy/$PREV"
  # data/ belongs to uid 1000, so copy from inside a container rather than as the deploy user.
  docker run --rm --user 0 --entrypoint sh -e PREV="$PREV" -v "$DEPLOY_DIR/data:/data" "$IMAGE:$TAG" -c '
    set -eu
    [ -d /data/pglite ] || exit 0
    mkdir -p /data/pre-deploy
    rm -rf "/data/pre-deploy/$PREV"
    cp -a /data/pglite "/data/pre-deploy/$PREV"
    ls -1t /data/pre-deploy | tail -n +4 | while read -r old; do rm -rf "/data/pre-deploy/$old"; done
  '
fi

echo "Starting $TAG"
IMAGE_TAG=$TAG $COMPOSE up -d --remove-orphans

state=starting
i=0
while [ "$i" -lt 24 ]; do
  state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo missing)
  [ "$state" = healthy ] || [ "$state" = unhealthy ] && break
  sleep 5
  i=$((i + 1))
done

if [ "$state" = healthy ]; then
  echo "$TAG" > .deployed-tag
  echo "Deployed $TAG ($CONTAINER is healthy)"
  exit 0
fi

echo "Container did not become healthy (state: $state)."
# Job logs are public: print status only, never `docker logs` (its startup line lists private settings).
docker inspect -f 'status={{.State.Status}} exit_code={{.State.ExitCode}} restarts={{.RestartCount}}' "$CONTAINER" 2>/dev/null || true
docker inspect -f '{{if .State.Health}}{{range .State.Health.Log}}health_check exit={{.ExitCode}} {{.Output}}{{end}}{{end}}' "$CONTAINER" 2>/dev/null || true
echo "Full logs on the NAS: docker logs $CONTAINER"
IMAGE_TAG=$TAG $COMPOSE down
if [ -n "$PREV" ]; then
  echo "Rolling back to $PREV"
  IMAGE_TAG=$PREV $COMPOSE up -d
fi
exit 1
