// -----------------------------------------------------------------------------
// The Node-RED integration: state and behaviour, independent of the process.
//
// index.js creates ONE instance with the real SDK client; the tests create
// one with the fake Gladys of the SDK and a simulated Node-RED (injected
// `fetch`). Everything Gladys can call is registered by `register()`.
//
// Lifecycle:
//   1. on every (re)connection and configuration change, `reconcile()`
//      writes settings.js and brings the Node-RED sub-container up;
//   2. a monitor (`refresh()`, every 30 s) reads Node-RED through its admin
//      API and publishes what changed: devices, states, connection status,
//      the status scene trigger and the widgets;
//   3. the event server relays the events of the flows to the scenes.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { configProblem, normalizeConfig } from './config.js';
import { loadSecrets } from './secrets.js';
import { MESSAGES, connectionOk } from './i18n.js';
import { buildSettings } from './nodeRed/settings.js';
import { NodeRedClient } from './nodeRed/client.js';
import { NODE_RED_URL, ensureNodeRed, restartNodeRed } from './nodeRed/container.js';
import { EVENT_PATH, EVENT_SERVER_PORT, createEventServer } from './eventServer.js';
import {
  FEATURES,
  buildDiscoveredDevices,
  buildStates,
  flowIds,
  instanceIds,
  resolveDevice,
} from './devices.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGETS, refreshWidgets } from './widgets.js';

const logger = createLogger({ name: 'node-red' });

export const SCENE_TRIGGERS = {
  EVENT: 'node_red_event',
  STATUS_CHANGED: 'node_red_status_changed',
};
export const SCENE_TRIGGER_KEYS = Object.values(SCENE_TRIGGERS);

export const MONITOR_INTERVAL_MS = 30_000;
// An unchanged state is re-sent every 30 minutes, so it stays recently dated.
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

export class NodeRedIntegration {
  /**
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {object} [options]
   * @param {string} [options.dataDir] the integration data folder
   * @param {string} [options.nodeRedUrl] Node-RED as reached by the integration
   * @param {typeof fetch} [options.fetch] injectable for the tests
   * @param {number} [options.monitorIntervalMs] 0 disables the monitor timer
   * @param {number} [options.eventPort] port of the event server (0: random)
   */
  constructor(gladys, options = {}) {
    this.gladys = gladys;
    this.dataDir = options.dataDir ?? '/data';
    this.nodeRedUrl = options.nodeRedUrl ?? NODE_RED_URL;
    this.fetch = options.fetch;
    this.monitorIntervalMs = options.monitorIntervalMs ?? MONITOR_INTERVAL_MS;
    this.eventPort = options.eventPort ?? EVENT_SERVER_PORT;

    this.config = normalizeConfig();
    this.secrets = null;
    this.client = null;
    this.hostPort = null;
    // What the monitor last saw. `online: null` = not known yet: the status
    // trigger only fires on a transition between two known states.
    this.snapshot = { online: null, version: null, flowsRunning: null, tabs: [], error: null };
    this.publishedDevicesKey = null;
    this.connectionStatusKey = null;
    this.monitorTimer = null;
    this.queue = Promise.resolve();
    this.eventServer = createEventServer({
      getToken: () => this.secrets?.event_token ?? '',
      onEvent: (data) => this.gladys.publishSceneEvent(SCENE_TRIGGERS.EVENT, data),
    });
  }

  /** URL the flows post their events to (the integration container name). */
  get eventUrl() {
    return `http://gladys-${this.gladys.selector}:${EVENT_SERVER_PORT}${EVENT_PATH}`;
  }

  // --- Wiring ----------------------------------------------------------------

  register() {
    const { gladys } = this;

    gladys.onScanRequest(async () => {
      await this.refresh();
      await this.publishDevices({ force: true });
    });

    gladys.onSetValue((device, feature, value) => this.setValue(device, feature, value));

    gladys.onAction('test_connection', () => this.testConnection());
    gladys.onAction('restart_node_red', async () => {
      await this.restart();
      return MESSAGES.restarted;
    });

    for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
      gladys.onSceneAction(key, (fields) => handler(this, fields));
    }

    for (const [key, widget] of Object.entries(WIDGETS)) {
      gladys.onWidgetGet(key, (request) => widget.get(this, request));
      if (typeof widget.action === 'function') {
        gladys.onWidgetAction(key, (actionKey, params) => widget.action(this, actionKey, params));
      }
    }

    gladys.onConfigUpdated(async (newConfig) => {
      logger.info('Configuration updated');
      await this.reconcile(newConfig);
    });

    gladys.on('connected', async () => {
      try {
        await this.reconcile(await gladys.getConfig());
      } catch (err) {
        logger.error('Post-connection initialization failed', err);
        await this.reportStatus(false, MESSAGES.startFailed);
      }
    });

    gladys.on('disconnected', () => this.stopMonitor());
  }

  async startEventServer() {
    const port = await this.eventServer.listen(this.eventPort);
    logger.info(`Event endpoint listening on port ${port}`);
    return port;
  }

  async shutdown() {
    this.stopMonitor();
    await this.eventServer.close();
  }

  // --- Container & configuration ---------------------------------------------

  /** Serialize the operations that touch the container. */
  exclusive(operation) {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Apply a configuration: write settings.js, start or restart Node-RED,
   * then read it back. A configuration that cannot start Node-RED (no
   * password yet) changes nothing and is reported in the Configuration screen.
   */
  reconcile(rawConfig) {
    return this.exclusive(async () => {
      const config = normalizeConfig(rawConfig);
      const problem = configProblem(config);
      if (problem) {
        logger.warn('Node-RED not (re)configured: the configuration is incomplete');
        await this.reportStatus(false, problem);
        return;
      }
      this.secrets = await loadSecrets(this.dataDir);
      const settings = buildSettings({ config, secrets: this.secrets, eventUrl: this.eventUrl });
      const { action, hostPort } = await ensureNodeRed(this.gladys, {
        dataDir: this.dataDir,
        settings,
      });
      this.config = config;
      this.hostPort = hostPort;
      this.client = new NodeRedClient({
        baseUrl: this.nodeRedUrl,
        username: config.username,
        password: config.password,
        protectHttpNodes: config.protect_http_nodes,
        fetch: this.fetch,
      });
      if (action !== 'unchanged') {
        // Node-RED is (re)starting: it is offline, and coming back online
        // is a transition worth a scene trigger.
        logger.info(`Node-RED ${action} (editor on host port ${hostPort ?? 'not assigned yet'})`);
        this.snapshot = { ...this.snapshot, online: false };
      }
      // The instance device exists even before Node-RED answers.
      await this.publishDevices();
      this.startMonitor();
      await this.refresh();
    });
  }

  restart() {
    return this.exclusive(async () => {
      await restartNodeRed(this.gladys);
      this.client?.invalidateToken();
      if (this.snapshot.online) {
        await this.updateSnapshot({ online: false, error: 'RESTARTING' });
      }
    });
  }

  // --- Monitor ---------------------------------------------------------------

  startMonitor() {
    this.stopMonitor();
    if (this.monitorIntervalMs > 0) {
      this.monitorTimer = setInterval(() => {
        this.refresh().catch((err) => logger.error('Node-RED refresh failed', err));
      }, this.monitorIntervalMs);
      this.monitorTimer.unref?.();
    }
  }

  stopMonitor() {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  /**
   * Read Node-RED and publish what changed. Never throws: an unreachable
   * Node-RED is a state, not an error.
   */
  async refresh() {
    if (!this.client) {
      return this.snapshot;
    }
    try {
      const [settings, flowsRunning, tabs] = await Promise.all([
        this.client.getSettings(),
        this.client.getFlowsRunning(),
        this.client.getTabs(),
      ]);
      await this.updateSnapshot({
        online: true,
        version: settings?.version ?? null,
        flowsRunning,
        tabs,
        error: null,
      });
    } catch (err) {
      logger.debug(`Node-RED not available: ${err.message}`);
      await this.updateSnapshot({ online: false, error: err.code ?? 'ERROR' });
    }
    return this.snapshot;
  }

  async updateSnapshot(next) {
    const previous = this.snapshot;
    this.snapshot = { ...previous, ...next };
    const current = this.snapshot;

    if (current.online) {
      await this.reportStatus(true);
    } else {
      await this.reportStatus(
        false,
        current.error === 'AUTH_REFUSED' ? MESSAGES.authRefused : MESSAGES.unreachable,
      );
    }

    if (previous.online !== null && previous.online !== current.online) {
      await this.fireStatusChanged(current);
    }

    await this.publishDevices();
    if (current.online) {
      await this.publishStates();
    }

    if (snapshotKey(previous) !== snapshotKey(current)) {
      refreshWidgets(this.gladys);
    }
  }

  async fireStatusChanged({ online, version }) {
    try {
      await this.gladys.publishSceneEvent(SCENE_TRIGGERS.STATUS_CHANGED, {
        status: online ? 'online' : 'offline',
        version: version ?? null,
      });
    } catch (err) {
      logger.warn(`Unable to fire the status scene trigger: ${err.message}`);
    }
  }

  async reportStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.connectionStatusKey) {
      return;
    }
    await this.gladys.setConnectionStatus(connected, message);
    this.connectionStatusKey = key;
  }

  async publishDevices({ force = false } = {}) {
    const devices = buildDiscoveredDevices(this.gladys, this.snapshot.tabs);
    const key = JSON.stringify(devices);
    if (!force && key === this.publishedDevicesKey) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(devices);
    this.publishedDevicesKey = key;
  }

  async publishStates() {
    const states = buildStates(this.gladys, this.snapshot);
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
  }

  // --- Operations (devices, actions, scenes, widgets) ------------------------

  requireClient() {
    if (!this.client) {
      throw new Error(MESSAGES.passwordMissing.en);
    }
    return this.client;
  }

  async setFlowsRunning(running) {
    const result = await this.requireClient().setFlowsRunning(running);
    await this.updateSnapshot({ flowsRunning: result });
    return result;
  }

  async setFlowEnabled(tabId, enabled) {
    const result = await this.requireClient().setTabEnabled(tabId, enabled);
    const tabs = this.snapshot.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, disabled: !result } : tab,
    );
    await this.updateSnapshot({ tabs });
    return result;
  }

  async setValue(device, feature, value) {
    const target = resolveDevice(this.gladys, device.external_id, this.snapshot.tabs);
    const on = Number(value) === 1;
    if (
      target?.kind === 'instance' &&
      feature.external_id === instanceIds(this.gladys).feature(FEATURES.FLOWS_RUNNING)
    ) {
      await this.setFlowsRunning(on);
      return;
    }
    if (
      target?.kind === 'flow' &&
      feature.external_id === flowIds(this.gladys, target.tab.id).feature(FEATURES.FLOW_ENABLED)
    ) {
      await this.setFlowEnabled(target.tab.id, on);
      return;
    }
    // Throwing acks the command as failed, with this message.
    throw new Error(`Unknown Node-RED feature ${feature.external_id}`);
  }

  /** Resolve a flow device chosen in a form (`"source": "devices"`). */
  flowTab(externalId) {
    const target = resolveDevice(this.gladys, externalId, this.snapshot.tabs);
    return target?.kind === 'flow' ? target.tab : null;
  }

  async testConnection() {
    const snapshot = await this.refresh();
    if (!this.client) {
      return MESSAGES.passwordMissing;
    }
    if (!snapshot.online) {
      return snapshot.error === 'AUTH_REFUSED' ? MESSAGES.authRefused : MESSAGES.unreachable;
    }
    return connectionOk({
      version: snapshot.version ?? '?',
      total: snapshot.tabs.length,
      enabled: snapshot.tabs.filter((tab) => !tab.disabled).length,
      hostPort: this.hostPort,
    });
  }
}

// What the widgets show: they are only nudged when it changes.
function snapshotKey({ online, version, flowsRunning, tabs }) {
  return JSON.stringify([online, version, flowsRunning, tabs]);
}
