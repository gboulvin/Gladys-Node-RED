// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. The SDK fetches it (`getConfig()`) and
// notifies every change (`onConfigUpdated()`); this module only applies the
// defaults, forces the types and tells whether Node-RED can be started.
// -----------------------------------------------------------------------------

import { MESSAGES } from './i18n.js';

// Defaults: they MUST stay consistent with the `default` values declared in
// the `config_schema` of the manifest (checked by test/manifest.test.js).
// The password is a `secret` field: no default, the user chooses it.
export const DEFAULT_CONFIG = {
  username: 'admin',
  protect_http_nodes: true,
  persist_context: false,
};

export const PASSWORD_MIN_LENGTH = 8;

// Written verbatim into the generated settings.js: keep it boring.
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const username = typeof raw.username === 'string' ? raw.username.trim() : '';
  return {
    username: username || DEFAULT_CONFIG.username,
    password: typeof raw.password === 'string' ? raw.password : '',
    // Booleans may arrive as strings from a form.
    protect_http_nodes: toBoolean(raw.protect_http_nodes, DEFAULT_CONFIG.protect_http_nodes),
    persist_context: toBoolean(raw.persist_context, DEFAULT_CONFIG.persist_context),
  };
}

/**
 * Why Node-RED cannot be started with this config, as a multi-language
 * message, or `null` when it can. Node-RED is never started without
 * credentials: its editor can run arbitrary code.
 */
export function configProblem(config) {
  if (!USERNAME_PATTERN.test(config.username)) {
    return MESSAGES.usernameInvalid;
  }
  if (config.password.length < PASSWORD_MIN_LENGTH) {
    return MESSAGES.passwordMissing;
  }
  return null;
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'string') {
    return value === 'true' || value === '1';
  }
  return Boolean(value);
}
