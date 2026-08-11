# MCACS deployment guide

The supported distribution consists of two release artifacts:

- `ghcr.io/wzbis666/mcacs:<version>`: detection engine and monitoring panel.
- `MCACS-Paper.jar`: Paper data collection and action execution plugin.

Normal server operators should use a tagged release. Building from `main` is intended for contributors.

## Requirements

| Component | Requirement |
| --- | --- |
| Engine host | 64-bit Linux or Windows with Docker and Docker Compose |
| CPU | `amd64` or `arm64` |
| Paper server | Java 17 or newer |
| Network | TCP 55210 for the panel/API and TCP 55211 for WebSocket |

See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) before claiming support for a specific Paper version.

## Option 1: Linux installer

Download the installer from the latest GitHub Release, review it, and run it:

```bash
curl -fLO https://github.com/wzbis666/MCACS-V2.0/releases/latest/download/install.sh
less install.sh
sudo bash install.sh --minecraft-dir /srv/paper
```

The installer:

1. Downloads the released Compose file, default policy, Paper JAR, and checksums.
2. Verifies SHA-256 checksums before installing files.
3. Generates a unique `ACS_AUTH_SECRET` and stores it in `/opt/mcacs/.env` with restricted permissions.
4. Pulls the prebuilt container image and waits for the health endpoint.
5. Copies the JAR and creates the initial Paper plugin configuration when `--minecraft-dir` is supplied.

Useful options:

```text
--version v0.1.0        install or roll back to a specific release
--install-dir /srv/mcacs
--minecraft-dir /srv/paper
--engine-host 10.0.0.20 address Paper uses to reach the engine
--no-start              download and configure only
```

The installer preserves an existing `.env`, Paper plugin configuration, and `penalty-config.yml`. A newer default policy is written to `penalty-config.yml.dist` for manual comparison.

## Option 2: Windows installer

Install and start Docker Desktop, then run PowerShell as an administrator:

```powershell
Invoke-WebRequest https://github.com/wzbis666/MCACS-V2.0/releases/latest/download/install.ps1 -OutFile install.ps1
Get-Content .\install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1 -MinecraftDir "C:\Minecraft\Paper"
```

To install a specific version:

```powershell
.\install.ps1 -Version v0.1.0 -MinecraftDir "C:\Minecraft\Paper"
```

The default engine directory is `%ProgramData%\MCACS`.

## Option 3: Docker Compose

Download the stable release assets:

```bash
mkdir mcacs && cd mcacs
curl -fLO https://github.com/wzbis666/MCACS-V2.0/releases/latest/download/compose.yml
curl -fLO https://github.com/wzbis666/MCACS-V2.0/releases/latest/download/penalty-config.yml
curl -fLO https://github.com/wzbis666/MCACS-V2.0/releases/latest/download/MCACS-Paper.jar
curl -fLO https://github.com/wzbis666/MCACS-V2.0/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

Create `.env`:

```dotenv
MCACS_VERSION=latest
ACS_AUTH_SECRET=replace-with-output-from-openssl
ACS_HTTP_PORT=55210
ACS_WS_PORT=55211
ACS_MODE=monitor
ACS_PRESET=balanced
TZ=Asia/Shanghai
```

Generate the secret with `openssl rand -hex 32`, then start the engine:

```bash
docker compose --env-file .env -f compose.yml pull
docker compose --env-file .env -f compose.yml up -d
docker compose --env-file .env -f compose.yml ps
```

For reproducible production deployments, replace `latest` with a release number such as `0.1.0`.

## Configure the Paper plugin

Copy `MCACS-Paper.jar` into the Paper server's `plugins` directory and start Paper once. Edit `plugins/AntiCheatMonitor/config.yml`:

```yaml
ws-uri: "ws://127.0.0.1:55211/spigot"
auth-token: "the-same-value-as-ACS_AUTH_SECRET"
server-name: "main-server"
sample-interval: 50
```

Use the engine host's private IP instead of `127.0.0.1` when Paper and Docker run on different machines. Restart Paper after changing the plugin JAR or connection configuration. Avoid `/reload` for plugin upgrades.

Run `/anticheat status` in the Paper console or as an authorized operator. The status should report a connected WebSocket.

## Open the monitoring panel

The panel URL is:

```text
http://ENGINE_HOST:55210/?token=ACS_AUTH_SECRET
```

The token is shared with the Paper plugin. Keep it private and avoid exposing the panel directly to the public internet. Prefer a firewall allowlist, VPN, or HTTPS reverse proxy.

## Verify a deployment

```bash
curl --fail http://127.0.0.1:55210/api/health
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=100 anticheat-engine
```

Also verify:

- `/anticheat status` reports connected.
- A test player's join and movement events appear in the panel.
- `data/` receives persistent records.
- Restarting the container does not remove records or custom policy settings.

## Upgrade

Back up the persistent files first:

```bash
cd /opt/mcacs
tar -czf "mcacs-backup-$(date +%Y%m%d-%H%M%S).tar.gz" data .env penalty-config.yml
```

With the installer:

```bash
sudo bash install.sh --version v0.2.0 --minecraft-dir /srv/paper
```

With Compose, update `MCACS_VERSION`, then run:

```bash
docker compose --env-file .env -f compose.yml pull
docker compose --env-file .env -f compose.yml up -d
```

Restart Paper after replacing `MCACS-Paper.jar`. Compare `penalty-config.yml.dist` with the active policy instead of overwriting local policy changes.

## Roll back

Use the installer with the previous tag, or set `MCACS_VERSION` to the previous image version. Restore the matching Paper JAR from that GitHub Release:

```bash
sudo bash install.sh --version v0.1.0 --minecraft-dir /srv/paper
```

Restore the `data` backup if release notes identify a non-backward-compatible data migration.

## Build from source

Contributor requirements are Node.js 20, Java 17, Maven 3.6 or newer, and Docker for the container build.

```bash
npm ci
npm ci --prefix town-frontend
npm test
npm run build
npm run build:paper
npm --prefix town-frontend run build
docker compose up -d --build
```

Source builds use `docker-compose.yml`. Released deployments use `compose.release.yml` or the `compose.yml` attached to a GitHub Release.

## Release process for maintainers

1. Update the version in both `package.json`/lock files, both frontend package files, `spigot-plugin/pom.xml`, and `spigot-plugin/src/main/resources/plugin.yml`.
2. Run `node scripts/check-release-version.mjs 0.2.0` and the complete local verification gate.
3. Commit and push the release changes.
4. Create and push a signed or annotated semantic-version tag such as `v0.2.0`.

The Release workflow verifies version consistency, runs all tests and builds, publishes `linux/amd64` and `linux/arm64` images to GHCR, and creates a GitHub Release containing:

```text
MCACS-Paper.jar
compose.yml
penalty-config.yml
install.sh
install.ps1
SHA256SUMS.txt
```

After the first image publish, open the `mcacs` package settings on GitHub, link it to this repository if necessary, and set package visibility to **Public**. The public installers cannot pull a private GHCR image.

## Operations

```bash
# Status
docker compose --env-file .env -f compose.yml ps

# Logs
docker compose --env-file .env -f compose.yml logs -f anticheat-engine

# Restart
docker compose --env-file .env -f compose.yml restart anticheat-engine

# Stop without deleting persistent data
docker compose --env-file .env -f compose.yml down
```

Persistent runtime records are stored in the local `data/` directory. `penalty-config.yml` is mounted read-only and is watched by the engine for policy reloads.

## Troubleshooting

### Paper cannot connect

- Confirm the container environment contains `ACS_WS_HOST=0.0.0.0`.
- Confirm TCP 55211 is reachable from the Paper host.
- Confirm `ws-uri` ends with `/spigot`.
- Confirm `auth-token` exactly matches `ACS_AUTH_SECRET`.
- Check `docker compose logs anticheat-engine` for authentication or connection errors.

### The panel cannot connect

- Open the panel with the `token` query parameter.
- Confirm TCP 55210 and 55211 are reachable from the browser.
- When using HTTPS, proxy both HTTP and WebSocket traffic and configure TLS consistently to avoid mixed-content blocking.

### The engine is unhealthy

```bash
docker compose --env-file .env -f compose.yml logs --tail=200 anticheat-engine
curl -v http://127.0.0.1:55210/api/health
```

Common causes are occupied host ports, a directory accidentally created at `penalty-config.yml`, or insufficient write permission for `data/`.

### Report a problem

Use the repository bug report form and include the exact release tag, image architecture, Paper build, Java version, and redacted logs. Report exploitable vulnerabilities privately according to [SECURITY.md](SECURITY.md).
