// -----------------------------------------------------------------------------
// Entry point of the Gladys Node-RED integration.
//
// Wiring only: the behaviour lives in src/app.js. This file instantiates the
// SDK (it reads GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
// GLADYS_INTEGRATION_SELECTOR, injected by the Gladys supervisor), registers
// the handlers BEFORE connect(), starts the event endpoint and connects.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { NodeRedIntegration } from './src/app.js';

const gladys = new GladysIntegration();
const app = new NodeRedIntegration(gladys, { dataDir: process.env.DATA_DIR || '/data' });

app.register();

// The supervisor stops the container with SIGTERM: stop the monitor and the
// event endpoint. Node-RED itself keeps running — its sub-container is
// driven by the supervisor (stopped with the integration, removed at
// uninstall).
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await app.shutdown();
});

logger.info('Starting the Node-RED integration...');
try {
  await app.startEventServer();
  await gladys.connect();
} catch (err) {
  logger.error('Startup failed', err);
  process.exit(1);
}
