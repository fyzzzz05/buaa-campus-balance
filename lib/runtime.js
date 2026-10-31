'use strict';
// Shared per-runtime configuration. Defaults preserve the existing web/native
// behaviour; the Electron entry point configures paths and adapters before any
// api handler is loaded. Nothing here reads a session secret from the
// environment unless the caller did not provide one.
const state = {
  mode: null,            // 'app' | 'web' | null
  sessionSecret: null,   // in-process only
  nativeToken: null,     // one-time token for the school-session import
  allowedUserId: null,
  dataDir: null,         // override for settings / card fallback / widget files
  logDir: null,
  trace: false,          // write diagnostics without dev environment variables
  widget: null,          // { read(), write(snapshot), clear() }
  widgetAgent: null,     // { enable(user, same), disable(), supported() }
  secureCookies: false,
};

function configure(patch = {}) {
  for (const key of Object.keys(patch)) if (patch[key] !== undefined) state[key] = patch[key];
  return state;
}
function reset() {
  for (const key of Object.keys(state)) state[key] = null;
  state.trace = false;
  state.secureCookies = false;
}
const isApp = () => state.mode === 'app' || process.env.CAMPUS_APP === '1';
const isWeb = () => state.mode === 'web' || process.env.CAMPUS_WEB === '1';
// Features that need a local machine: keychain/safeStorage, auto login, widget.
const localFeatures = () => isApp() || isWeb();
const sessionSecret = () => state.sessionSecret || process.env.SESSION_SECRET || '';
const nativeToken = () => state.nativeToken || sessionSecret();
const allowedUser = () => state.allowedUserId || process.env.ALLOWED_USER_ID || '';
const dataDir = () => state.dataDir || null;
const logDir = () => state.logDir || null;
const traceEnabled = () => state.trace === true || localFeatures();
const widget = () => state.widget || null;
const widgetAgent = () => state.widgetAgent || null;
const secureCookies = () => state.secureCookies === true || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

module.exports = {
  configure, reset,
  isApp, isWeb, localFeatures,
  sessionSecret, nativeToken, allowedUser,
  dataDir, logDir, traceEnabled, widget, widgetAgent, secureCookies,
};
