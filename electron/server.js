'use strict';
const crypto = require('node:crypto');
const credentials = require('../lib/credentials');
const widgetAgent = require('../lib/widget-agent');
const runtime = require('../lib/runtime');
const {startServer} = require('../lib/server');

// Wires the shared local server to Electron-owned paths and adapters. The
// session secret and native token are generated per launch and stay in memory.
async function startAppServer({publicDir, files, credentialStore, widgetStore, widgetAgentImpl}) {
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const nativeToken = crypto.randomBytes(32).toString('hex');
  runtime.configure({
    mode: 'app',
    sessionSecret,
    nativeToken,
    dataDir: files.userData,
    logDir: files.logDir,
    trace: true,
    widget: widgetStore,
    widgetAgent: widgetAgentImpl,
  });
  credentials.configure(credentialStore);
  widgetAgent.configure(widgetAgentImpl);
  const server = await startServer({publicDir});
  return {server, sessionSecret, nativeToken};
}

module.exports = {startAppServer};
