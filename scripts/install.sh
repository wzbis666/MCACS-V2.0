#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="wzbis666/MCACS-V2.0"
VERSION="${MCACS_VERSION:-latest}"
INSTALL_DIR="${MCACS_INSTALL_DIR:-/opt/mcacs}"
MINECRAFT_DIR="${MINECRAFT_DIR:-}"
ENGINE_HOST="${MCACS_ENGINE_HOST:-127.0.0.1}"
START_ENGINE=1

usage() {
  cat <<'EOF'
Install a released MCACS engine and Paper plugin.

Usage: install.sh [options]
  --version VERSION        Release tag such as v0.1.0 (default: latest)
  --install-dir PATH       Engine files directory (default: /opt/mcacs)
  --minecraft-dir PATH     Paper server root; installs JAR into PATH/plugins
  --engine-host HOST       Host used by the Paper plugin (default: 127.0.0.1)
  --no-start               Download and configure without starting Docker
  -h, --help               Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:?Missing value for --version}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:?Missing value for --install-dir}"; shift 2 ;;
    --minecraft-dir) MINECRAFT_DIR="${2:?Missing value for --minecraft-dir}"; shift 2 ;;
    --engine-host) ENGINE_HOST="${2:?Missing value for --engine-host}"; shift 2 ;;
    --no-start) START_ENGINE=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

for command_name in curl sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

if [[ "$START_ENGINE" -eq 1 ]]; then
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    echo "Docker with the Compose plugin is required. Install Docker, then retry." >&2
    exit 1
  fi
fi

if [[ "$VERSION" == "latest" ]]; then
  ASSET_BASE="https://github.com/${REPOSITORY}/releases/latest/download"
  IMAGE_VERSION="latest"
else
  [[ "$VERSION" == v* ]] || VERSION="v${VERSION}"
  ASSET_BASE="https://github.com/${REPOSITORY}/releases/download/${VERSION}"
  IMAGE_VERSION="${VERSION#v}"
fi

mkdir -p "$INSTALL_DIR"
DOWNLOAD_DIR="$(mktemp -d)"
trap 'rm -rf "$DOWNLOAD_DIR"' EXIT

download() {
  local asset="$1"
  echo "Downloading ${asset}..."
  curl --fail --location --retry 3 --silent --show-error \
    "${ASSET_BASE}/${asset}" -o "${DOWNLOAD_DIR}/${asset}"
}

for asset in compose.yml penalty-config.yml MCACS-Paper.jar SHA256SUMS.txt; do
  download "$asset"
done

for asset in compose.yml penalty-config.yml MCACS-Paper.jar; do
  checksum_line="$(grep -E "^[0-9a-fA-F]{64}  ${asset}$" "${DOWNLOAD_DIR}/SHA256SUMS.txt" || true)"
  if [[ -z "$checksum_line" ]]; then
    echo "No checksum published for ${asset}" >&2
    exit 1
  fi
  (cd "$DOWNLOAD_DIR" && printf '%s\n' "$checksum_line" | sha256sum -c -)
done

install -m 0644 "${DOWNLOAD_DIR}/compose.yml" "${INSTALL_DIR}/compose.yml"
if [[ ! -f "${INSTALL_DIR}/penalty-config.yml" ]]; then
  install -m 0644 "${DOWNLOAD_DIR}/penalty-config.yml" "${INSTALL_DIR}/penalty-config.yml"
else
  install -m 0644 "${DOWNLOAD_DIR}/penalty-config.yml" "${INSTALL_DIR}/penalty-config.yml.dist"
  echo "Existing penalty-config.yml preserved; new default saved as penalty-config.yml.dist."
fi
install -m 0644 "${DOWNLOAD_DIR}/MCACS-Paper.jar" "${INSTALL_DIR}/MCACS-Paper.jar"

ENV_FILE="${INSTALL_DIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    AUTH_SECRET="$(openssl rand -hex 32)"
  else
    AUTH_SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  cat > "$ENV_FILE" <<EOF
MCACS_VERSION=${IMAGE_VERSION}
ACS_AUTH_SECRET=${AUTH_SECRET}
ACS_HTTP_PORT=55210
ACS_WS_PORT=55211
ACS_MODE=dashboard
ACS_PRESET=survival
TZ=Asia/Shanghai
EOF
  chmod 0600 "$ENV_FILE"
else
  AUTH_SECRET="$(sed -n 's/^ACS_AUTH_SECRET=//p' "$ENV_FILE" | tail -n 1)"
  if [[ -z "$AUTH_SECRET" ]]; then
    echo "Existing ${ENV_FILE} must define a non-empty ACS_AUTH_SECRET." >&2
    exit 1
  fi
  if grep -q '^MCACS_VERSION=' "$ENV_FILE"; then
    sed -i.bak "s/^MCACS_VERSION=.*/MCACS_VERSION=${IMAGE_VERSION}/" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '\nMCACS_VERSION=%s\n' "$IMAGE_VERSION" >> "$ENV_FILE"
  fi
  echo "Existing .env preserved; MCACS_VERSION updated to ${IMAGE_VERSION}."
fi

if [[ ! "$AUTH_SECRET" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "ACS_AUTH_SECRET may contain only letters, numbers, dot, underscore, and hyphen." >&2
  exit 1
fi

HTTP_PORT="$(sed -n 's/^ACS_HTTP_PORT=//p' "$ENV_FILE" | tail -n 1)"
WS_PORT="$(sed -n 's/^ACS_WS_PORT=//p' "$ENV_FILE" | tail -n 1)"
HTTP_PORT="${HTTP_PORT:-55210}"
WS_PORT="${WS_PORT:-55211}"
if [[ ! "$HTTP_PORT" =~ ^[0-9]+$ || ! "$WS_PORT" =~ ^[0-9]+$ ]]; then
  echo "ACS_HTTP_PORT and ACS_WS_PORT must be numeric." >&2
  exit 1
fi

PLUGIN_TARGET="${INSTALL_DIR}/MCACS-Paper.jar"
if [[ -n "$MINECRAFT_DIR" ]]; then
  PLUGINS_DIR="${MINECRAFT_DIR%/}/plugins"
  CONFIG_DIR="${PLUGINS_DIR}/AntiCheatMonitor"
  mkdir -p "$CONFIG_DIR"
  install -m 0644 "${DOWNLOAD_DIR}/MCACS-Paper.jar" "${PLUGINS_DIR}/MCACS-Paper.jar"
  PLUGIN_TARGET="${PLUGINS_DIR}/MCACS-Paper.jar"
  if [[ ! -f "${CONFIG_DIR}/config.yml" ]]; then
    cat > "${CONFIG_DIR}/config.yml" <<EOF
ws-uri: "ws://${ENGINE_HOST}:${WS_PORT}/spigot"
auth-token: "${AUTH_SECRET}"
server-name: "main-server"
sample-interval: 50
EOF
  else
    echo "Existing Paper plugin config preserved: ${CONFIG_DIR}/config.yml"
  fi
fi

if [[ "$START_ENGINE" -eq 1 ]]; then
  echo "Starting MCACS engine..."
  (cd "$INSTALL_DIR" && docker compose --env-file .env -f compose.yml pull)
  (cd "$INSTALL_DIR" && docker compose --env-file .env -f compose.yml up -d)

  healthy=0
  for _ in {1..15}; do
    if curl --fail --silent "http://127.0.0.1:${HTTP_PORT}/api/health" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep 2
  done
  if [[ "$healthy" -ne 1 ]]; then
    echo "Engine did not become healthy. Check: cd ${INSTALL_DIR} && docker compose logs" >&2
    exit 1
  fi
fi

cat <<EOF

MCACS installation complete.
  Engine files: ${INSTALL_DIR}
  Paper plugin: ${PLUGIN_TARGET}
  Panel:        http://127.0.0.1:${HTTP_PORT}/?token=${AUTH_SECRET}
  WebSocket:    ws://${ENGINE_HOST}:${WS_PORT}/spigot

Keep ${ENV_FILE} private. Open TCP ports 55210 and 55211 only to trusted networks.
Restart the Paper server after installing or replacing the plugin JAR.
EOF
