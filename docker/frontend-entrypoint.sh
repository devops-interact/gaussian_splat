#!/bin/sh
set -eu

PORT="${PORT:-8080}"
BACKEND_URL="${BACKEND_URL:?Set BACKEND_URL to your Railway API service URL (no trailing slash)}"
BACKEND_URL="${BACKEND_URL%/}"
BACKEND_HOST=$(echo "$BACKEND_URL" | sed -e 's|https\?://||' -e 's|/.*||')

export PORT BACKEND_URL BACKEND_HOST

envsubst '${PORT} ${BACKEND_URL} ${BACKEND_HOST}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "Frontend nginx: PORT=${PORT} BACKEND_URL=${BACKEND_URL}"

exec nginx -g 'daemon off;'
