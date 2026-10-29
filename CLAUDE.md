# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

The **Node-RED** external integration of Gladys Assistant: a Node.js service
(Node 22+, ESM, no build step) that runs in its own sandboxed Docker container,
talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
(its only runtime dependency), and drives a `node-red` sub-container
(`nodered/node-red`) declared in the manifest. It replaces the Node-RED
integration built into the Gladys core and started from the official
JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "widget"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                 SDK wiring only: NodeRedIntegration.register() before connect()
src/app.js               NodeRedIntegration: reconcile (settings + container), monitor, operations
src/config.js            DEFAULT_CONFIG (mirrors the manifest defaults), normalization, validation
src/secrets.js           generated secrets in /data/secrets.json (credential secret, event token, salt)
src/nodeRed/settings.js  generator of the Node-RED settings.js (adminAuth, httpNodeMiddleware...)
src/nodeRed/client.js    Node-RED admin API client (http://node-red:1880 on the private network)
src/nodeRed/container.js sub-container lifecycle (start / restart / stop via the host API)
src/devices.js           instance device + one device per flow tab
src/scenes.js            scene action handlers (manifest `scene_actions`)
src/widgets.js           dashboard widget handlers (manifest `widgets`)
src/eventServer.js       POST /event from the flows -> `node_red_event` scene trigger
src/i18n.js              runtime texts in en / fr / de / es
docs/{en,fr,de,es}.md    user documentation, re-hosted by Gladys (en + fr mandatory)
test/                    node --test, fake Gladys (integration-sdk/testing) + test/helpers/fakeNodeRed.js
```

## Rules

- **Node-RED never runs without authentication.** The sub-container stays
  `start: manual`; `settings.js` (with `adminAuth`) is written before any
  `startContainer`. Never add a code path that starts it otherwise.
- **settings.js is generated.** Every value goes through `JSON.stringify`;
  never interpolate configuration into code. The clear password is never
  written to disk (scrypt hash only), never logged.
- **Secrets are forever.** `credential_secret` encrypts the users' flow
  credentials: never regenerate it when `/data/secrets.json` exists.
- **External ids are forever.** The instance is `instance:node-red`, a flow is
  `flow:<Node-RED tab id>` (made id-safe): never key a device on a label. The
  same goes for every key users store: manifest `config_schema`, `actions`,
  widget, scene trigger / action keys, their fields and outputs.
- **The container rootfs is read-only.** Write only under `/data` (the Node-RED
  user directory is `/data/containers/node-red/data`).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. The Node-RED image of the sub-container is third-party: changing it
  is a manual manifest change, mentioned in the changelog.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading.
- **Manifest.** Texts are multi-language objects with **`en`, `fr`, `de` and
  `es`**: `label`, `description` and `placeholder` alike (checked by
  `test/manifest.test.js`). The catalog `description` holds 10 to 100
  characters per language. `widgets`, `scene_triggers` and `scene_actions`
  require `gladys_version >=5.1.0`; `keywords` and `countries` would require
  5.3.0 — the integration is worldwide and declares no `countries`.
  `transports` stays `["local"]`.
- **User-facing text** exists in English, French, German and Spanish: runtime
  messages in `src/i18n.js` (checked by `test/i18n.test.js`), manifest texts,
  and `docs/*.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network: Node-RED is simulated by an
  injected `fetch`.
