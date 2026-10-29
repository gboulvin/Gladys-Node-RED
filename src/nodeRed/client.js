// -----------------------------------------------------------------------------
// Client of the Node-RED admin HTTP API.
//
// Node-RED runs in the `node-red` sub-container, on the private network of
// the integration: the integration reaches it by its DNS alias
// (http://node-red:1880), never through the host port published on the LAN.
//
// Admin API reference: https://nodered.org/docs/api/admin/methods/
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'node-red-client' });

export const REQUEST_TIMEOUT_MS = 10_000;

// Node-RED access tokens last 7 days: renew a bit earlier.
const TOKEN_SAFETY_MS = 60 * 60 * 1000;

// What a scene action may read back from an HTTP endpoint of a flow.
const MAX_RESPONSE_LENGTH = 10_000;

// Path of an `http in` node: absolute, plain characters, no traversal. The
// host is fixed (the Node-RED container): the path cannot leave it.
const HTTP_IN_PATH_PATTERN = /^\/[A-Za-z0-9._~\-/]{0,200}$/;

export class NodeRedError extends Error {
  constructor(message, { status = null, code = 'NODE_RED_ERROR' } = {}) {
    super(message);
    this.name = 'NodeRedError';
    this.status = status;
    this.code = code;
  }
}

export class NodeRedClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl e.g. http://node-red:1880
   * @param {string} options.username
   * @param {string} options.password
   * @param {boolean} [options.protectHttpNodes] send Basic auth to `http in` nodes
   * @param {typeof fetch} [options.fetch] injectable for the tests
   */
  constructor({ baseUrl, username, password, protectHttpNodes = true, fetch: fetchImpl }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.protectHttpNodes = protectHttpNodes;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  // --- Authentication --------------------------------------------------------

  async login() {
    const body = new URLSearchParams({
      client_id: 'node-red-admin',
      grant_type: 'password',
      scope: '*',
      username: this.username,
      password: this.password,
    });
    const response = await this.send('/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (response.status === 401 || response.status === 403) {
      throw new NodeRedError('Node-RED refused the credentials', {
        status: response.status,
        code: 'AUTH_REFUSED',
      });
    }
    if (!response.ok) {
      throw new NodeRedError(`Node-RED login failed (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    const { access_token: accessToken, expires_in: expiresIn } = await response.json();
    this.token = accessToken;
    this.tokenExpiresAt = Date.now() + Number(expiresIn ?? 0) * 1000 - TOKEN_SAFETY_MS;
  }

  invalidateToken() {
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Authenticated admin API call, with one retry on 401 (token revoked by a
   * Node-RED restart or a password change).
   */
  async admin(pathname, { method = 'GET', body, headers = {} } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.token || Date.now() >= this.tokenExpiresAt) {
        await this.login();
      }
      const response = await this.send(pathname, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'Node-RED-API-Version': 'v2',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (response.status === 401 && attempt === 0) {
        this.invalidateToken();
        continue;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new NodeRedError(
          `Node-RED ${method} ${pathname} failed (HTTP ${response.status}) ${text}`.trim(),
          { status: response.status },
        );
      }
      if (response.status === 204) {
        return null;
      }
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
    throw new NodeRedError('Node-RED refused the credentials', { code: 'AUTH_REFUSED' });
  }

  async send(pathname, init) {
    try {
      return await this.fetch(`${this.baseUrl}${pathname}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      logger.debug(`Node-RED unreachable on ${pathname}: ${err.message}`);
      throw new NodeRedError(`Node-RED is unreachable: ${err.message}`, { code: 'UNREACHABLE' });
    }
  }

  // --- Runtime ---------------------------------------------------------------

  /** Runtime settings, carrying the Node-RED version. */
  async getSettings() {
    return this.admin('/settings');
  }

  /** `true` when the flows are started (runtimeState is enabled by settings.js). */
  async getFlowsRunning() {
    const { state } = await this.admin('/flows/state');
    return state === 'start';
  }

  async setFlowsRunning(running) {
    const { state } = await this.admin('/flows/state', {
      method: 'POST',
      body: { state: running ? 'start' : 'stop' },
    });
    return state === 'start';
  }

  // --- Flows (tabs) ----------------------------------------------------------

  /** The flow tabs: `[{ id, label, disabled, info }]`, in editor order. */
  async getTabs() {
    const result = await this.admin('/flows');
    const flows = Array.isArray(result) ? result : (result?.flows ?? []);
    return flows
      .filter((node) => node.type === 'tab')
      .map((tab) => ({
        id: tab.id,
        label: tab.label || tab.id,
        disabled: tab.disabled === true,
        info: typeof tab.info === 'string' ? tab.info : '',
      }));
  }

  /** Enable or disable one flow tab, the same as the editor's toggle. */
  async setTabEnabled(id, enabled) {
    const encoded = encodeURIComponent(id);
    const flow = await this.admin(`/flow/${encoded}`);
    if (flow.disabled === !enabled) {
      return enabled;
    }
    await this.admin(`/flow/${encoded}`, { method: 'PUT', body: { ...flow, disabled: !enabled } });
    return enabled;
  }

  // --- HTTP endpoints of the flows -------------------------------------------

  /**
   * POST a JSON message to an `http in` node of a flow.
   * @returns {Promise<{ status: number, ok: boolean, body: string }>}
   */
  async callHttpIn(pathname, payload) {
    if (!isValidHttpInPath(pathname)) {
      throw new NodeRedError(`Invalid HTTP endpoint path: ${pathname}`, { code: 'INVALID_PATH' });
    }
    const headers = { 'content-type': 'application/json' };
    if (this.protectHttpNodes) {
      const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers.authorization = `Basic ${basic}`;
    }
    const response = await this.send(pathname, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const body = (await response.text().catch(() => '')).slice(0, MAX_RESPONSE_LENGTH);
    return { status: response.status, ok: response.ok, body };
  }
}

export function isValidHttpInPath(pathname) {
  return (
    typeof pathname === 'string' &&
    HTTP_IN_PATH_PATTERN.test(pathname) &&
    !pathname.split('/').includes('..')
  );
}
