// -----------------------------------------------------------------------------
// Event endpoint: Node-RED -> Gladys scenes.
//
// A small HTTP server inside the integration container. The Node-RED
// sub-container reaches it over the private network of the integration (the
// integration container name, `gladys-<selector>`), and every accepted
// request fires the `node_red_event` scene trigger.
//
//   POST /event
//   Authorization: Bearer <GLADYS_EVENT_TOKEN>
//   { "event": "door_opened", "value": 1, "text": "Front door" }
//
// The port is NOT published on the LAN, but the integration container also
// sits on the network shared by every external integration: the bearer token
// (generated, see src/secrets.js) keeps the others out.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'event-server' });

export const EVENT_SERVER_PORT = 8080;
export const EVENT_PATH = '/event';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT_LENGTH = 1000;
const EVENT_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export class EventValidationError extends Error {}

/**
 * Validate and normalize the body sent by Node-RED into the flat scene event
 * data `{ event, value, text }` (value: number | null, text: string | null).
 */
export function parseEvent(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new EventValidationError('the body must be a JSON object');
  }
  const { event } = body;
  if (typeof event !== 'string' || !EVENT_NAME_PATTERN.test(event)) {
    throw new EventValidationError(
      '"event" must be 1 to 64 letters, digits, "_", "-", "." or ":" (e.g. "door_opened")',
    );
  }
  return { event, value: parseValue(body.value), text: parseText(body.text) };
}

function parseValue(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    throw new EventValidationError('"value" must be a finite number, a boolean or null');
  }
  return number;
}

function parseText(text) {
  if (text === undefined || text === null) {
    return null;
  }
  if (typeof text !== 'string') {
    throw new EventValidationError('"text" must be a string');
  }
  return text.slice(0, MAX_TEXT_LENGTH);
}

function sameToken(received, expected) {
  const hash = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(received), hash(expected));
}

function reply(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {object} options
 * @param {() => string} options.getToken current bearer token
 * @param {(data: object) => Promise<void>} options.onEvent fires the scene trigger
 */
export function createEventServer({ getToken, onEvent }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== EVENT_PATH) {
      return reply(res, 404, { error: 'not found' });
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return reply(res, 405, { error: 'method not allowed' });
    }
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (!match || !sameToken(match[1].trim(), getToken())) {
      return reply(res, 401, { error: 'invalid or missing bearer token (GLADYS_EVENT_TOKEN)' });
    }
    let data;
    try {
      data = parseEvent(JSON.parse(await readBody(req)));
    } catch (err) {
      if (err.status === 413) {
        return reply(res, 413, { error: 'body too large (16 KB max)' });
      }
      return reply(res, 400, { error: err instanceof SyntaxError ? 'invalid JSON' : err.message });
    }
    try {
      await onEvent(data);
      return reply(res, 200, { success: true });
    } catch (err) {
      logger.warn(`Event "${data.event}" refused by Gladys: ${err.message}`);
      // 429: the core admits 300 scene events per minute per integration.
      const status = err.status === 429 ? 429 : 502;
      return reply(res, status, { error: err.message });
    }
  });

  return {
    server,
    listen(port = EVENT_SERVER_PORT, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
