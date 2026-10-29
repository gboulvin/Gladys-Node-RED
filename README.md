# Node-RED for Gladys Assistant

An **external integration** for [Gladys Assistant](https://gladysassistant.com)
that runs [Node-RED](https://nodered.org) and connects it to Gladys. It
replaces the Node-RED integration built into the Gladys core, built with the
JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
from the official
[integration template](https://github.com/GladysAssistant/integration-template-js).

| What                | Details                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Transport           | **Local** only (manifest `transports: ["local"]`): no account, no cloud                                |
| Countries / regions | **Worldwide**: no `countries` restriction, Node-RED runs on the user's machine                         |
| Languages           | English, French, German, Spanish (manifest, runtime messages, widgets, docs)                           |
| Gladys              | 5.1.0 or later (scene triggers, scene actions and widgets), installed with Docker, amd64 or arm64      |
| Node-RED            | 5.0 (`nodered/node-red:5.0`), sub-container started by the integration, editor port assigned by Gladys |
| Catalog categories  | `services`, `protocols`                                                                                |

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## What it does

- **Runs Node-RED** in a sub-container (`containers` manifest field,
  `start: manual`). The integration first writes the Node-RED `settings.js`
  (admin credentials, credential secret, Gladys event endpoint) into the
  volume of the sub-container, then starts it — Node-RED is never exposed on
  the LAN without a password. A configuration change rewrites the file and
  restarts Node-RED only when the file changed.
- **Devices**: a `Node-RED` switch (start / stop all the flows) and one switch
  per flow tab (enable / disable the flow), kept in sync every 30 seconds.
- **Scene triggers**: `node_red_event` (a flow sent an event — via the
  `global.get('gladys').trigger()` helper or an HTTP request with a bearer
  token) and `node_red_status_changed` (Node-RED came online / went offline).
- **Scene actions**: `send_to_flow` (POST to an `http in` node), `set_flows_state`,
  `set_flow_enabled`, `restart_node_red`.
- **Dashboard widgets**: `node_red_status` (status, version, flows, editor
  port, start / stop / restart buttons) and `node_red_flows` (the flows with
  their enabled badge).
- **Configuration actions**: `test_connection` and `restart_node_red`.

## How it fits together

```
 Gladys core ──WebSocket/host API──▶ integration container (this repo)
                                       │  admin API, http in   ▲ POST /event (bearer token)
                                       ▼  http://node-red:1880 │
                                     node-red sub-container ───┘
                                       │ port 1880 published on the LAN (port chosen by Gladys)
                                       ▼
                                     your browser (the editor)
```

The integration and Node-RED share a private Docker network created by
Gladys: the integration reaches Node-RED at `http://node-red:1880`, Node-RED
reaches the event endpoint at `http://gladys-<selector>:8080/event`
(`GLADYS_EVENT_URL`). The event endpoint is never published on the LAN.

## Project structure

```
.
├─ index.js                  # SDK bootstrap only
├─ src/
│  ├─ app.js                 # the integration: reconcile, monitor, operations
│  ├─ config.js              # config defaults, normalization, validation
│  ├─ secrets.js             # generated secrets persisted in /data
│  ├─ devices.js             # Node-RED instance + one device per flow tab
│  ├─ scenes.js              # scene actions
│  ├─ widgets.js             # dashboard widgets
│  ├─ eventServer.js         # Node-RED -> Gladys scene events
│  ├─ i18n.js                # runtime texts (en, fr, de, es)
│  └─ nodeRed/
│     ├─ settings.js         # generator of the Node-RED settings.js
│     ├─ client.js           # Node-RED admin API client
│     └─ container.js        # sub-container lifecycle
├─ docs/{en,fr,de,es}.md     # user documentation, re-hosted by Gladys
├─ test/                     # node --test, fake Gladys + simulated Node-RED
├─ gladys-assistant-integration.json
├─ Dockerfile                # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md · CLAUDE.md · SECURITY.md
└─ .github/                  # CI, release, build, GitHub releases, Dependabot
```

## Development

```bash
npm install
npm test                 # node --test (fake Gladys + simulated Node-RED, no network)
npm run lint
npm run format:check
```

Run it against a Gladys instance in developer mode:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="node-red" \
DATA_DIR=./data LOG_LEVEL=debug npm start
```

The store validator (`npx github:GladysAssistant/integration-store .`) checks
the manifest, the cover, the docs and the Docker images before a release.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.
   The workflow bumps `package.json` and the manifest (`version`,
   `docker_image`), rolls the changelog, tags `vX.Y.Z`, builds the
   `linux/amd64` + `linux/arm64` image to `ghcr.io/gboulvin/gladys-node-red`
   and publishes the GitHub Release.
3. The repository carries the `gladys-assistant-integration` topic: the store
   indexer picks the new version up.

The Node-RED image of the sub-container (`nodered/node-red:5.0`) is a
third-party image: the release keeps it as is. Changing it is a deliberate
change of the manifest.

## License

Apache-2.0
