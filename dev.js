'use strict';
// Browser dev server. Node only; the Electron app configures lib/server.js
// directly with its own paths and adapters.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('./lib/runtime');
const {startServer} = require('./lib/server');

async function main() {
  const app = process.env.CAMPUS_APP === '1', web = process.env.CAMPUS_WEB === '1';
  let secret = process.env.SESSION_SECRET || '';
  if (app || web) {
    secret = fs.readFileSync(0, 'utf8').trim();
    if (!secret) throw new Error('Missing local session secret');
  } else if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
  }
  runtime.configure({mode: app ? 'app' : web ? 'web' : null, sessionSecret: secret, nativeToken: secret});
  const server = await startServer({publicDir: path.join(__dirname, 'public'), port: Number(process.env.PORT || 4173)});
  console.log(`READY ${server.port}`);
  if (app) {
    const parent = Number(process.env.CAMPUS_PARENT_PID);
    setInterval(() => { if (parent && process.ppid !== parent) process.exit(0); }, 15000).unref();
  }
}

main().catch(error => { console.error(error && error.message ? error.message : error); process.exit(1); });
