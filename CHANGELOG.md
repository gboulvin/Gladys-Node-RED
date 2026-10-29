# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-29

### Added

- Node-RED 5 as an external integration, replacing the Node-RED integration
  built into Gladys: the integration writes the Node-RED settings, then
  starts Node-RED in its own sub-container. The editor is protected by the
  username and password of the configuration, and never starts without them.
- Option to protect the HTTP endpoints of the flows with the same
  credentials (on by default), and option to keep the context on disk.
- Devices: a switch to start or stop all the flows, and one switch per flow
  to enable or disable it.
- Scene triggers: "Node-RED event" (sent by a flow) and "Node-RED started or
  stopped".
- Scene actions: send to a Node-RED flow, start or stop all flows, enable or
  disable a flow, restart Node-RED.
- Dashboard widgets: "Node-RED status" and "Node-RED flows".
- Configuration buttons: test the connection, restart Node-RED.
- English, French, German and Spanish everywhere: configuration, messages,
  widgets and documentation, with a migration guide from the built-in
  integration.

[Unreleased]: https://github.com/gboulvin/Gladys-Node-RED/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gboulvin/Gladys-Node-RED/releases/tag/v1.0.0
