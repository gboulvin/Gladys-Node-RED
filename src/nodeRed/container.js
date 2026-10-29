// -----------------------------------------------------------------------------
// Lifecycle of the Node-RED sub-container.
//
// The manifest declares the `node-red` sub-container with `start: manual`:
// the supervisor creates nothing until the integration has written
// settings.js (credentials included) and calls startContainer. Node-RED is
// therefore never exposed on the LAN without authentication.
//
// The sub-container mounts its `/data` (the Node-RED user directory: flows,
// credentials, installed palette nodes) from the integration data folder; the
// integration sees it under `/data/containers/node-red/data`.
// -----------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'node-red-container' });

// Sub-container name: manifest `containers[].name` AND DNS alias on the
// private network of the integration.
export const CONTAINER_NAME = 'node-red';
export const CONTAINER_PORT = 1880;
export const NODE_RED_URL = `http://${CONTAINER_NAME}:${CONTAINER_PORT}`;

/** Folder of the Node-RED user directory, as seen by the integration. */
export function nodeRedDataDir(dataDir) {
  return path.join(dataDir, 'containers', CONTAINER_NAME, 'data');
}

/**
 * Write settings.js when its content changed.
 * @returns {Promise<boolean>} true when the file was (re)written
 */
export async function writeSettings(dataDir, content) {
  const folder = nodeRedDataDir(dataDir);
  const filePath = path.join(folder, 'settings.js');
  let current = null;
  try {
    current = await readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
  if (current === content) {
    return false;
  }
  await mkdir(folder, { recursive: true });
  // Owner-only: the file holds the credential secret and the event token.
  // Node-RED runs with the same uid (1000) as the integration.
  await writeFile(filePath, content, { mode: 0o600 });
  return true;
}

/** The sub-container as reported by Gladys, or undefined. */
export async function findContainer(gladys) {
  const containers = await gladys.getContainers();
  return containers.find((container) => container.name === CONTAINER_NAME);
}

/** Host port Gladys assigned to the editor, `null` until the first start. */
export function editorHostPort(container) {
  const port = (container?.ports ?? []).find((p) => p.container_port === CONTAINER_PORT);
  return port?.host_port ?? null;
}

/**
 * Bring the sub-container to the running state with the given settings:
 * write settings.js, then start the container — or restart it when it was
 * already running with other settings.
 * @returns {Promise<{ action: 'started' | 'restarted' | 'unchanged', hostPort: number | null }>}
 */
export async function ensureNodeRed(gladys, { dataDir, settings }) {
  const settingsChanged = await writeSettings(dataDir, settings);
  const container = await findContainer(gladys);
  let action = 'unchanged';
  if (container?.status !== 'running') {
    logger.info('Starting the Node-RED container...');
    await gladys.startContainer(CONTAINER_NAME);
    action = 'started';
  } else if (settingsChanged) {
    logger.info('Node-RED settings changed: restarting the container...');
    await gladys.restartContainer(CONTAINER_NAME);
    action = 'restarted';
  }
  // The host port is assigned at the first start: read it back.
  const refreshed = action === 'unchanged' ? container : await findContainer(gladys);
  return { action, hostPort: editorHostPort(refreshed) };
}

export async function restartNodeRed(gladys) {
  logger.info('Restarting the Node-RED container...');
  await gladys.restartContainer(CONTAINER_NAME);
}

export async function stopNodeRed(gladys) {
  const container = await findContainer(gladys);
  if (container?.status === 'running') {
    logger.info('Stopping the Node-RED container...');
    await gladys.stopContainer(CONTAINER_NAME);
  }
}
