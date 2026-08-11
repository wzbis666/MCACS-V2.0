# Compatibility

MCACS has three independently deployed layers. A successful TypeScript build does not prove Paper runtime compatibility, so only combinations verified in an actual server should be listed as supported.

## Current build targets

| Layer | Build target | Status |
| --- | --- | --- |
| Detection engine | Node.js 20, Linux `amd64` and `arm64` containers | Built by CI and release workflows |
| Paper plugin | Java 17 bytecode, Spigot API `1.20.1-R0.1-SNAPSHOT` | Compiled by CI |
| Monitoring panel | Current Chromium, Firefox, and Safari | Build-verified; browser runtime checks are release-gate work |

The deployment guide previously named Paper 1.20.4 while the plugin compiles against the Spigot 1.20.1 API. Until a server test matrix is automated, treat Paper 1.20.x as the intended family rather than a blanket compatibility guarantee.

## Release test matrix

Before marking a release stable, test at least:

- Plugin load, WebSocket reconnect, movement/combat/block events, and `/anticheat status` on each claimed Paper version.
- Engine startup and data persistence on `linux/amd64` and `linux/arm64`.
- Panel connection and primary investigation controls on desktop and a 390 x 844 mobile viewport.
- Upgrade from the previous stable release with an existing `data` directory and customized `penalty-config.yml`.

Open a bug report with the exact Paper build, Java version, image tag, and relevant redacted logs when a combination fails.
