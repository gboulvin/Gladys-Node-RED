// -----------------------------------------------------------------------------
// The generated Node-RED settings.js: loaded for real (like Node-RED does) to
// check the authentication it enforces.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSettings } from '../src/nodeRed/settings.js';
import { configProblem, normalizeConfig } from '../src/config.js';

const require = createRequire(import.meta.url);

const secrets = {
  credential_secret: 'c'.repeat(64),
  event_token: 'e'.repeat(64),
  password_salt: 'ab'.repeat(16),
};

async function loadSettings(t, rawConfig) {
  const dir = await mkdtemp(path.join(tmpdir(), 'node-red-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.js');
  const content = buildSettings({
    config: normalizeConfig(rawConfig),
    secrets,
    eventUrl: 'http://gladys-node-red:8080/event',
  });
  await writeFile(file, content);
  return { settings: require(file), content };
}

function fakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
    },
  };
}

function runMiddleware(settings, authorization) {
  const res = fakeResponse();
  let passed = false;
  settings.httpNodeMiddleware({ headers: { authorization } }, res, () => {
    passed = true;
  });
  return { passed, res };
}

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

test('the editor accepts the configured credentials only', async (t) => {
  const { settings } = await loadSettings(t, { username: 'admin', password: 'correct-horse' });
  const { adminAuth } = settings;
  assert.equal(adminAuth.type, 'credentials');
  assert.deepEqual(await adminAuth.authenticate('admin', 'correct-horse'), {
    username: 'admin',
    permissions: '*',
  });
  assert.equal(await adminAuth.authenticate('admin', 'wrong'), null);
  assert.equal(await adminAuth.authenticate('root', 'correct-horse'), null);
  assert.equal(await adminAuth.authenticate(undefined, undefined), null);
  assert.deepEqual(await adminAuth.users('admin'), { username: 'admin', permissions: '*' });
  assert.equal(await adminAuth.users('root'), null);
  assert.equal(settings.credentialSecret, secrets.credential_secret);
  assert.deepEqual(settings.runtimeState, { enabled: true, ui: true });
});

test('the HTTP endpoints of the flows require Basic auth when protected', async (t) => {
  const { settings } = await loadSettings(t, { username: 'admin', password: 'correct-horse' });
  assert.equal(runMiddleware(settings, basic('admin', 'correct-horse')).passed, true);
  // cached path
  assert.equal(runMiddleware(settings, basic('admin', 'correct-horse')).passed, true);
  const refused = runMiddleware(settings, basic('admin', 'nope'));
  assert.equal(refused.passed, false);
  assert.equal(refused.res.statusCode, 401);
  assert.match(refused.res.headers['WWW-Authenticate'], /^Basic/);
  assert.equal(runMiddleware(settings, undefined).passed, false);
});

test('the HTTP endpoints are open when the protection is off', async (t) => {
  const { settings } = await loadSettings(t, {
    username: 'admin',
    password: 'correct-horse',
    protect_http_nodes: false,
  });
  assert.equal(runMiddleware(settings, undefined).passed, true);
});

test('the flows get the event endpoint and the gladys helper', async (t) => {
  await loadSettings(t, { username: 'admin', password: 'correct-horse', persist_context: true });
  assert.equal(process.env.GLADYS_EVENT_URL, 'http://gladys-node-red:8080/event');
  assert.equal(process.env.GLADYS_EVENT_TOKEN, secrets.event_token);
  const { settings } = await loadSettings(t, {
    username: 'admin',
    password: 'correct-horse',
    persist_context: true,
  });
  assert.equal(typeof settings.functionGlobalContext.gladys.trigger, 'function');
  assert.equal(settings.contextStorage.default.module, 'localfilesystem');
});

test('the same configuration always gives the same file, without the clear password', async (t) => {
  const first = await loadSettings(t, { username: 'admin', password: 'correct-horse' });
  const second = await loadSettings(t, { username: 'admin', password: 'correct-horse' });
  assert.equal(first.content, second.content);
  assert.ok(!first.content.includes('correct-horse'));
});

test('a configuration cannot inject code into settings.js', () => {
  assert.ok(
    configProblem(
      normalizeConfig({ username: "admin'; process.exit(1); '", password: 'correct-horse' }),
    ),
  );
  assert.ok(configProblem(normalizeConfig({ username: 'admin', password: 'short' })));
  assert.equal(
    configProblem(normalizeConfig({ username: 'admin', password: 'correct-horse' })),
    null,
  );
  // Defense in depth: values are JSON-encoded even when the check is bypassed.
  const content = buildSettings({
    config: { ...normalizeConfig({ password: 'correct-horse' }), username: 'a"b\n' },
    secrets,
    eventUrl: 'http://x',
  });
  assert.match(content, /const ADMIN_USERNAME = "a\\"b\\n";/);
});
