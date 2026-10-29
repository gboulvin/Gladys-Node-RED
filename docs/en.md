# Node-RED

This integration runs [Node-RED](https://nodered.org) next to Gladys Assistant
and connects both: your flows can start Gladys scenes, Gladys scenes can call
your flows, and Node-RED shows up on your dashboards. It replaces the Node-RED
integration built into Gladys.

## Where it works

- **Every country, every region**: Node-RED runs on your own Gladys machine,
  no account and no cloud service are involved.
- **Local only**: everything stays on your network. Node-RED reaches the
  Internet only when one of your flows (or the palette manager) does.
- **Requirements**: Gladys Assistant 5.1 or later, installed with Docker
  (amd64 or arm64, e.g. a Raspberry Pi 4/5). Node-RED uses up to 512 MB of
  memory.

## Installation and configuration

1. Install the **Node-RED** integration from the Gladys integration catalog.
2. Open its **Configuration** tab, choose a **username** (default `admin`) and
   a **password** (8 characters minimum), then save.
3. Node-RED starts. Its editor opens at `http://<gladys-address>:<port>`: the
   port is chosen by Gladys and shown in the Configuration screen, in the
   **Node-RED status** widget and by the **Test the connection** button.

Node-RED never starts without a password: its editor can run any code on the
machine. Changing the username or the password restarts Node-RED.

Options:

- **Protect the HTTP endpoints of the flows** (on by default): the `http in`
  nodes ask for the same username and password (HTTP Basic authentication).
  Turn it off only if a device of your network must call them without
  credentials.
- **Keep the context after a restart**: stores the flow and global context on
  disk (`localfilesystem`) instead of memory only.

The configuration buttons:

- **Test the connection** — checks that Node-RED answers, shows its version,
  its flows and the editor port.
- **Restart Node-RED** — e.g. after installing nodes from the palette.

## Devices

In the **Discovery** tab of the integration:

- **Node-RED** — a switch that starts or stops all the flows;
- **Node-RED · <flow name>** — one device per flow tab, a switch that enables
  or disables that flow (like the toggle of the editor).

Add them to use them on dashboards and in scenes (“control a device”, “device
state” trigger). A new flow appears in the Discovery tab within 30 seconds.

## Scenes

The integration adds its own cards to the scene editor, in the
**Integrations** category.

### Triggers

- **Node-RED event** — a flow sent an event to Gladys. Fill in the event name
  to react to one event only, or leave it empty for all of them. The
  following actions read `{{triggerEvent.data.event}}`,
  `{{triggerEvent.data.value}}` (a number) and `{{triggerEvent.data.text}}`.
- **Node-RED started or stopped** — Node-RED came online or went offline
  (variables `status` and `version`).

To send an event from a **function** node:

```js
await global.get('gladys').trigger('door_opened', { value: 1, text: 'Front door' });
return msg;
```

Or with an **http request** node: method `POST`, URL `${GLADYS_EVENT_URL}`,
header `Authorization` = `Bearer ${GLADYS_EVENT_TOKEN}`, and a JSON body
`{ "event": "door_opened", "value": 1, "text": "Front door" }`. Both
variables are set by the integration. An event name holds 1 to 64 letters,
digits, `_`, `-`, `.` or `:`; `value` is a number (or a boolean, sent as 1/0)
and `text` up to 1,000 characters.

### Actions

- **Send to a Node-RED flow** — `POST`s `{ "message": …, "value": …,
"source": "gladys-scene" }` (JSON) to an `http in` node of your flows, e.g.
  path `/gladys/lights`. The message accepts scene variables. Outputs:
  `success` (HTTP 2xx), `status_code` and `response` (the body returned by the
  `http response` node, 10,000 characters max).
- **Start or stop all flows** — output `running`.
- **Enable or disable a flow** — pick the flow device; output `enabled`.
- **Restart Node-RED** — output `restarted`.

Example flow receiving the action: `http in` (POST, `/gladys/lights`) →
`function` (reads `msg.payload.message` and `msg.payload.value`) →
`http response`.

## Dashboard

Two widgets are available in the dashboard editor:

- **Node-RED status** — whether Node-RED runs, its version, the number of
  enabled flows and the editor port, with **Start / Stop flows** and
  **Restart** buttons;
- **Node-RED flows** — the list of the flows with their enabled / disabled
  badge.

## Migrating from the built-in integration

1. In the **old** Node-RED editor: menu **☰ → Export → All flows →
   Download**. Note the extra nodes installed in **Manage palette**.
2. Install and configure this integration (see above), open the new editor.
3. Install the same nodes from **Manage palette**, then **☰ → Import** the
   exported file.
4. Re-enter the passwords of the configuration nodes (MQTT broker, HTTP
   credentials…): they are encrypted and do not travel with the export.
5. In the MQTT broker nodes, replace `localhost` / `127.0.0.1` with the **IP
   address of the Gladys machine** (see the limitations below).
6. Disable the built-in Node-RED integration of Gladys
   (**Integrations → Node-RED**), so both do not run the same flows.

## Limitations

- Node-RED runs in its own isolated container, on a private network:
  `localhost` is Node-RED itself. Reach the other services of the machine
  (MQTT broker, Zigbee2MQTT…) with the IP address of the Gladys machine.
- No access to USB / serial ports and no network broadcast (mDNS, UDP
  discovery) from the flows: the container has no privileged access.
- Node-RED 5 is installed; it is updated with the integration.

## Troubleshooting

- **“Set a password”** in the Configuration screen: the password is missing
  or shorter than 8 characters.
- **“Node-RED refused the credentials”**: press **Restart Node-RED**.
- **The editor does not open**: Node-RED may still be starting (up to a
  minute on a Raspberry Pi), use **Test the connection**.
- The logs of the integration (with `LOG_LEVEL=debug` for the details) and
  of Node-RED are available in the Gladys supervision screen.
