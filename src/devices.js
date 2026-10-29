// -----------------------------------------------------------------------------
// Devices published to Gladys.
//
//   - the Node-RED instance: a switch starting / stopping ALL the flows (the
//     runtime "flows state" of Node-RED 3.1+);
//   - one device per flow tab: a switch enabling / disabling that flow, like
//     the toggle of the editor.
//
// They make Node-RED usable from the standard Gladys surfaces: dashboard
// switches, scene "control a device" actions and "device state" triggers.
//
// External ids are forever: the flow devices are keyed on the Node-RED tab
// id (stable across renames), never on the tab label.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const INSTANCE_TYPE = 'instance';
export const INSTANCE_ID = 'node-red';
export const FLOW_TYPE = 'flow';

export const FEATURES = {
  FLOWS_RUNNING: 'flows-running',
  FLOW_ENABLED: 'enabled',
};

/** Node-RED ids are hex, sometimes dotted (`a1b2.c3d4`): keep id-safe chars. */
export function flowPlatformId(tabId) {
  return String(tabId).replace(/[^A-Za-z0-9_-]/g, '_');
}

export function instanceIds(gladys) {
  return gladys.externalIds(INSTANCE_TYPE, INSTANCE_ID);
}

export function flowIds(gladys, tabId) {
  return gladys.externalIds(FLOW_TYPE, flowPlatformId(tabId));
}

function switchFeature(name, externalId) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    read_only: false,
    // The state published after a command is the one Node-RED confirmed.
    has_feedback: true,
    keep_history: true,
    min: 0,
    max: 1,
  };
}

export function buildInstanceDevice(gladys) {
  const ids = instanceIds(gladys);
  return {
    name: 'Node-RED',
    external_id: ids.device,
    features: [switchFeature('Flows running', ids.feature(FEATURES.FLOWS_RUNNING))],
  };
}

export function buildFlowDevice(gladys, tab) {
  const ids = flowIds(gladys, tab.id);
  return {
    name: `Node-RED · ${tab.label}`,
    external_id: ids.device,
    params: [{ name: 'NODE_RED_FLOW_ID', value: tab.id }],
    features: [switchFeature('Flow enabled', ids.feature(FEATURES.FLOW_ENABLED))],
  };
}

/** The whole discovery list: the instance first, then the flows. */
export function buildDiscoveredDevices(gladys, tabs) {
  return [buildInstanceDevice(gladys), ...tabs.map((tab) => buildFlowDevice(gladys, tab))];
}

/** The states matching a Node-RED snapshot. */
export function buildStates(gladys, { flowsRunning, tabs }) {
  const states = [];
  if (typeof flowsRunning === 'boolean') {
    states.push({
      device_feature_external_id: instanceIds(gladys).feature(FEATURES.FLOWS_RUNNING),
      state: flowsRunning ? 1 : 0,
    });
  }
  for (const tab of tabs) {
    states.push({
      device_feature_external_id: flowIds(gladys, tab.id).feature(FEATURES.FLOW_ENABLED),
      state: tab.disabled ? 0 : 1,
    });
  }
  return states;
}

/**
 * What a device external id designates: `{ kind: 'instance' }`,
 * `{ kind: 'flow', tab }` or `null` (unknown, or a flow deleted since).
 */
export function resolveDevice(gladys, externalId, tabs) {
  if (externalId === instanceIds(gladys).device) {
    return { kind: 'instance' };
  }
  const tab = tabs.find((candidate) => flowIds(gladys, candidate.id).device === externalId);
  return tab ? { kind: 'flow', tab } : null;
}
