// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// Each handler receives the integration and the RESOLVED fields (scene
// variables substituted, defaults applied, validated by the core) and returns
// the declared `outputs`. Throwing fails this action only: the scene logs it
// and continues. A result the scene author may want to test (an HTTP status,
// "was it enabled") is an output, never a failure.
//
// Scene TRIGGERS are fired elsewhere: `node_red_event` by the event server
// (src/eventServer.js), `node_red_status_changed` by the monitor (src/app.js).
// No action here fires a trigger: a scene bound to it would loop.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { MESSAGES } from './i18n.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTIONS = {
  // POST a message to an `http in` node of a flow: Gladys -> Node-RED.
  async send_to_flow(app, fields) {
    const path = String(fields.path ?? '').trim();
    logger.info(`Scene action send_to_flow -> ${path}`);
    const body = {
      message: fields.message ?? null,
      value: typeof fields.value === 'number' ? fields.value : null,
      source: 'gladys-scene',
    };
    const { ok, status, body: response } = await app.requireClient().callHttpIn(path, body);
    return { success: ok, status_code: status, response };
  },

  async set_flows_state(app, fields) {
    const running = fields.state !== 'stop';
    logger.info(`Scene action set_flows_state -> ${running ? 'start' : 'stop'}`);
    return { running: await app.setFlowsRunning(running) };
  },

  async set_flow_enabled(app, fields) {
    const tab = app.flowTab(fields.flow);
    if (!tab) {
      throw new Error(MESSAGES.notAFlow.en);
    }
    const enabled = fields.enabled !== false;
    logger.info(`Scene action set_flow_enabled -> ${tab.label}: ${enabled}`);
    return { enabled: await app.setFlowEnabled(tab.id, enabled) };
  },

  async restart_node_red(app) {
    logger.info('Scene action restart_node_red');
    await app.restart();
    return { restarted: true };
  },
};
