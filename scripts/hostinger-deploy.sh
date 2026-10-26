#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="${1:-$(dirname "$ROOT")/esign-saas-hostinger.tar.gz}"
DOMAIN="${HOSTINGER_DEPLOY_DOMAIN:-sharehousemanagers.com}"
USERNAME="${HOSTINGER_DEPLOY_USER:-u700359906}"
ARCHIVE_NAME="${HOSTINGER_ARCHIVE_NAME:-esign-saas-hostinger.tar.gz}"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Archive not found: $ARCHIVE" >&2
  exit 1
fi

if [[ -z "${HOSTINGER_API_TOKEN:-}" ]]; then
  if [[ -f /workspace/.env.local ]]; then
    # shellcheck disable=SC1091
    set -a && source /workspace/.env.local && set +a
  fi
fi

if [[ -z "${HOSTINGER_API_TOKEN:-}" ]]; then
  echo "HOSTINGER_API_TOKEN is not set." >&2
  exit 1
fi

API="https://developers.hostinger.com"
AUTH=(-H "Authorization: Bearer ${HOSTINGER_API_TOKEN}" -H "Content-Type: application/json")

echo "Requesting upload URL for ${DOMAIN} (${USERNAME})..."
UPLOAD_JSON="$(curl -sS "${AUTH[@]}" -X POST "${API}/api/hosting/v1/files/upload-urls" \
  -d "{\"username\":\"${USERNAME}\",\"domain\":\"${DOMAIN}\"}")"

URL="$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d['url'])" <<<"$UPLOAD_JSON")"
AUTH_KEY="$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d['auth_key'])" <<<"$UPLOAD_JSON")"
REST_KEY="$(python3 -c "import json,sys; d=json.load(sys.stdin); print(d['rest_auth_key'])" <<<"$UPLOAD_JSON")"

SIZE="$(stat -c%s "$ARCHIVE")"
FILE_PATH="$ARCHIVE_NAME"

echo "Uploading ${ARCHIVE} (${SIZE} bytes) as ${FILE_PATH}..."
curl -sS -i -X POST "${URL}/${FILE_PATH}?override=true" \
  -H "X-Auth: ${AUTH_KEY}" \
  -H "X-Auth-Rest: ${REST_KEY}" \
  -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Length: ${SIZE}" \
  -H "Upload-Offset: 0" | head -5

curl -sS -i -X PATCH "${URL}/${FILE_PATH}?override=true" \
  -H "X-Auth: ${AUTH_KEY}" \
  -H "X-Auth-Rest: ${REST_KEY}" \
  -H "Tus-Resumable: 1.0.0" \
  -H "Content-Type: application/offset+octet-stream" \
  -H "Upload-Offset: 0" \
  --data-binary "@${ARCHIVE}" | head -10

echo "Fetching build settings from archive..."
SETTINGS="$(curl -sS "${AUTH[@]}" \
  "${API}/api/hosting/v1/accounts/${USERNAME}/websites/${DOMAIN}/nodejs/builds/settings/from-archive?archive_path=${FILE_PATH}")"
echo "$SETTINGS" | python3 -m json.tool 2>/dev/null || echo "$SETTINGS"

BUILD_BODY="$(SETTINGS="$SETTINGS" FILE_PATH="$FILE_PATH" python3 <<'PY'
import json
import os

raw = os.environ.get("SETTINGS", "")
file_path = os.environ["FILE_PATH"]
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    d = {}
if not isinstance(d, dict) or d.get("error"):
    d = {}

app_type = d.get("app_type") or "next"
node_version = int(d.get("node_version") or 22)
build_script = d.get("build_script") or "build"
entry_file = d.get("entry_file") or "server.js"
package_manager = d.get("package_manager") or "npm"
root_directory = d.get("root_directory") or ""
output_directory = d.get("output_directory") or ""
if app_type == "next" and not output_directory:
    output_directory = ".next"

payload = {
    "source_type": "archive",
    "source_options": {"archive_path": file_path},
    "node_version": node_version,
    "app_type": app_type,
    "build_script": build_script,
    "entry_file": entry_file,
    "package_manager": package_manager,
    "output_directory": output_directory,
}
if root_directory:
    payload["root_directory"] = root_directory
print(json.dumps(payload))
PY
)"

echo "Starting Node.js build on ${DOMAIN}..."
BUILD_RES="$(curl -sS "${AUTH[@]}" -X POST \
  "${API}/api/hosting/v1/accounts/${USERNAME}/websites/${DOMAIN}/nodejs/builds" \
  -d "$BUILD_BODY")"
echo "$BUILD_RES" | python3 -m json.tool 2>/dev/null || echo "$BUILD_RES"

echo "Deploy request submitted."
