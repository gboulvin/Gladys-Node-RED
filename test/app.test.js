// -----------------------------------------------------------------------------
// End-to-end behaviour, against the fake Gladys of the SDK and a simulated
// Node-RED (test/helpers/fakeNodeRed.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { NodeRedIntegration, SCENE_TRIGGERS } from '../src/app.js';
import { CONTAINER_NAME, nodeRedDataDir } from '../src/nodeRed/container.js';
import { FLOWS_WIDGET, STATUS_WIDGET } from '../src/widgets.js';
import { MESSAGES } from '../src/i18n.js';
import { createFakeNodeRed } from './helpers/fakeNodeRed.js';

const PASSWORD = 'correct-horse';

function container({ status = 'stopped', hostPort = null } = {}) {
  return {
    name: CONTAINER_NAME,
    status,
    desired: status,
    started_at: null,
    ports: [
      {
        container_port: 1880,
        protocol: 'tcp',
        host_port: hostPort,
        label: { en: 'Node-RED editor' },
        name: 'editor',
        browsable: true,
      },
    ],
  };
}

async function setup(t, { config = { username: 'admin', password: PASSWORD }, nodeRed } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'gladys-node-red-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const fakeNodeRed = nodeRed ?? createFakeNodeRed({ password: PASSWORD });
  const gladys = createFakeGladys({ config, containers: [container({ hostPort: 41880 })] });
  const app = new NodeRedIntegration(gladys, {
    dataDir,
    fetch: fakeNodeRed.fetch,
    monitorIntervalMs: 0,
  });
  app.register();
  await gladys.connect();
  t.after(() => gladys.disconnect());
  return { app, gladys, nodeRed: fakeNodeRed, dataDir };
}

const containerCalls = (gladys) =>
  gladys.fake.requests
    .filter((request) => request.path.startsWith('/container/'))
    .map((request) => `${request.method} ${request.path}`);

test('does not start Node-RED without a password', async (t) => {
  const { gladys, dataDir } = await setup(t, { config: { username: 'admin' } });
  assert.deepEqual(containerCalls(gladys), []);
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.passwordMissing,
  });
  await assert.rejects(stat(path.join(nodeRedDataDir(dataDir), 'settings.js')));
});

test('writes settings.js, starts Node-RED and publishes its devices and states', async (t) => {
  const { app, gladys, dataDir } = await setup(t);

  assert.deepEqual(containerCalls(gladys), ['POST /container/node-red/start']);
  const settingsPath = path.join(nodeRedDataDir(dataDir), 'settings.js');
  const settings = await readFile(settingsPath, 'utf8');
  assert.match(settings, /const ADMIN_USERNAME = "admin";/);
  assert.ok(!settings.includes(PASSWORD), 'the password is only stored hashed');
  assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);

  assert.equal(app.hostPort, 41880);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });

  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Node-RED', 'Node-RED · Lights', 'Node-RED · Alarm'],
  );
  const [instance, lights, alarm] = devices;
  assert.equal(gladys.fake.lastState(instance.features[0].external_id), 1);
  assert.equal(gladys.fake.lastState(lights.features[0].external_id), 1);
  assert.equal(gladys.fake.lastState(alarm.features[0].external_id), 0);
  // Dotted Node-RED ids are made id-safe.
  assert.match(alarm.external_id, /:flow:f6f2187d_f17ca8$/);
});

test('restarts Node-RED only when the settings change', async (t) => {
  const { gladys } = await setup(t);
  gladys.fake.containers = [container({ status: 'running', hostPort: 41880 })];

  await gladys.fake.configUpdated({ username: 'admin', password: PASSWORD });
  assert.deepEqual(containerCalls(gladys), ['POST /container/node-red/start']);

  await gladys.fake.configUpdated({ username: 'admin', password: PASSWORD, persist_context: true });
  assert.deepEqual(containerCalls(gladys), [
    'POST /container/node-red/start',
    'POST /container/node-red/restart',
  ]);
});

test('the switches start / stop the flows and enable / disable a flow', async (t) => {
  const { gladys, nodeRed } = await setup(t);
  const [instance, , alarm] = gladys.fake.discoveredDevices;

  const flows = instance.features[0];
  assert.deepEqual(await gladys.fake.setValue(instance, flows, 0), { success: true });
  assert.equal(nodeRed.state.running, false);
  assert.equal(gladys.fake.lastState(flows.external_id), 0);

  const enabled = alarm.features[0];
  assert.deepEqual(await gladys.fake.setValue(alarm, enabled, 1), { success: true });
  assert.equal(nodeRed.state.tabs[1].disabled, false);
  assert.equal(gladys.fake.lastState(enabled.external_id), 1);
});

test('fires the status trigger on a transition, and reports it', async (t) => {
  const { app, gladys, nodeRed } = await setup(t);
  // started by setup: offline -> online already fired once
  assert.deepEqual(gladys.fake.sceneEvents, [
    { key: SCENE_TRIGGERS.STATUS_CHANGED, data: { status: 'online', version: '5.0.9' } },
  ]);

  nodeRed.state.online = false;
  await app.refresh();
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: SCENE_TRIGGERS.STATUS_CHANGED,
    data: { status: 'offline', version: '5.0.9' },
  });
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.unreachable,
  });

  // No new event while the state does not change.
  await app.refresh();
  assert.equal(gladys.fake.sceneEvents.length, 2);
});

test('reports refused credentials', async (t) => {
  const nodeRed = createFakeNodeRed({ password: 'another-password' });
  const { gladys } = await setup(t, { nodeRed });
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.authRefused,
  });
});

test('a new flow appears as a new device', async (t) => {
  const { app, gladys, nodeRed } = await setup(t);
  nodeRed.state.tabs.push({ id: 'c0ffee', type: 'tab', label: 'Garden', disabled: false });
  await app.refresh();
  assert.equal(gladys.fake.discoveredDevices.at(-1).name, 'Node-RED · Garden');
});

test('manifest actions: test the connection, restart', async (t) => {
  const { gladys } = await setup(t);
  const test1 = await gladys.fake.action('test_connection');
  assert.equal(test1.success, true);
  assert.match(
    test1.data.message.en,
    /Node-RED 5\.0\.9 is running: 2 flow\(s\), 1 enabled\. .*41880/,
  );
  const { fr, de, es } = test1.data.message;
  assert.ok(fr && de && es);

  const restart = await gladys.fake.action('restart_node_red');
  assert.deepEqual(restart, { success: true, data: { message: MESSAGES.restarted } });
  assert.ok(containerCalls(gladys).includes('POST /container/node-red/restart'));
});

test('scene actions reach Node-RED and return their outputs', async (t) => {
  const { gladys, nodeRed } = await setup(t);

  const sent = await gladys.fake.sceneAction('send_to_flow', {
    path: '/gladys/test',
    message: 'hello',
    value: 3,
  });
  assert.deepEqual(sent.data.outputs, { success: true, status_code: 200, response: 'ok' });
  assert.deepEqual(nodeRed.state.received, [
    {
      pathname: '/gladys/test',
      body: { message: 'hello', value: 3, source: 'gladys-scene' },
    },
  ]);

  const missing = await gladys.fake.sceneAction('send_to_flow', { path: '/nope' });
  assert.deepEqual(missing.data.outputs, {
    success: false,
    status_code: 404,
    response: '{"error":"not found"}',
  });

  const traversal = await gladys.fake.sceneAction('send_to_flow', { path: '/../auth/token' });
  assert.equal(traversal.success, false);

  const stopped = await gladys.fake.sceneAction('set_flows_state', { state: 'stop' });
  assert.deepEqual(stopped.data.outputs, { running: false });

  const [instance, lights] = gladys.fake.discoveredDevices;
  const disabled = await gladys.fake.sceneAction('set_flow_enabled', {
    flow: lights.external_id,
    enabled: false,
  });
  assert.deepEqual(disabled.data.outputs, { enabled: false });
  assert.equal(nodeRed.state.tabs[0].disabled, true);

  const notAFlow = await gladys.fake.sceneAction('set_flow_enabled', {
    flow: instance.external_id,
    enabled: true,
  });
  assert.equal(notAFlow.success, false);

  const restarted = await gladys.fake.sceneAction('restart_node_red');
  assert.deepEqual(restarted.data.outputs, { restarted: true });
});

test('widgets render exactly as sent, and their buttons work', async (t) => {
  const { app, gladys, nodeRed } = await setup(t);

  for (const key of [STATUS_WIDGET, FLOWS_WIDGET]) {
    const { success, data } = await gladys.fake.widgetGet(key);
    assert.equal(success, true);
    assert.deepEqual(validateWidgetContent(data.content), [], key);
  }

  const status = (await gladys.fake.widgetGet(STATUS_WIDGET)).data.content;
  const [instance] = gladys.fake.discoveredDevices;
  assert.equal(status.components[0].device_feature, instance.features[0].external_id);

  const stop = await gladys.fake.widgetAction(STATUS_WIDGET, 'stop_flows');
  assert.deepEqual(stop, { success: true, data: { message: MESSAGES.flowsStopped } });
  assert.equal(nodeRed.state.running, false);

  const start = await gladys.fake.widgetAction(STATUS_WIDGET, 'start_flows');
  assert.deepEqual(start, { success: true, data: { message: MESSAGES.flowsStarted } });
  assert.equal(nodeRed.state.running, true);

  const flows = (await gladys.fake.widgetGet(FLOWS_WIDGET)).data.content;
  const list = flows.components.find((component) => component.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.badge.text.en]),
    [
      ['Lights', 'Enabled'],
      ['Alarm', 'Disabled'],
    ],
  );

  // Offline: both widgets still render a valid content.
  nodeRed.state.online = false;
  await app.refresh();
  for (const key of [STATUS_WIDGET, FLOWS_WIDGET]) {
    const { data } = await gladys.fake.widgetGet(key);
    assert.deepEqual(validateWidgetContent(data.content), [], key);
  }
  assert.ok(gladys.fake.widgetRefreshes.includes(STATUS_WIDGET));
});

test('events posted by Node-RED fire the node_red_event trigger', async (t) => {
  const { app, gladys } = await setup(t);
  const port = await app.eventServer.listen(0, '127.0.0.1');
  t.after(() => app.eventServer.close());
  const url = `http://127.0.0.1:${port}/event`;
  const post = (body, token = app.secrets.event_token) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  const ok = await post({ event: 'door_opened', value: true, text: 'Front door', extra: 1 });
  assert.equal(ok.status, 200);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: SCENE_TRIGGERS.EVENT,
    data: { event: 'door_opened', value: 1, text: 'Front door' },
  });

  assert.equal((await post({ event: 'x' }, 'wrong-token')).status, 401);
  assert.equal((await post({ event: 'bad name!' })).status, 400);
  assert.equal((await post({ event: 'x', value: 'abc' })).status, 400);
  assert.equal((await fetch(url)).status, 405);
  assert.match(app.eventUrl, /^http:\/\/gladys-test-integration:8080\/event$/);
});
