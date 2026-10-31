'use strict';
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

// File-backed snapshot store used by lib/widget-snapshot (merge + 4096 limit are
// applied before write) and by the widget window through IPC.
function createWidgetStore({snapshotFile, onChange}) {
  function read() { return paths.readJson(snapshotFile, null); }
  function write(snapshot) {
    fs.mkdirSync(path.dirname(snapshotFile), {recursive: true, mode: 0o700});
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot), {mode: 0o600});
    if (typeof onChange === 'function') { try { onChange(snapshot); } catch { /* detached window */ } }
  }
  function clear() {
    paths.removeFile(snapshotFile);
    if (typeof onChange === 'function') { try { onChange(null); } catch { /* detached window */ } }
  }
  return {read, write, clear};
}

// Replaces the macOS LaunchAgent: persists the opted-in account and lets the
// main process drive its in-process scheduler.
function createWidgetAgent({stateFile, onEnable, onDisable}) {
  return {
    available: () => true,
    async enable(user, networkSamePassword) {
      paths.writeJson(stateFile, {user, networkSamePassword: networkSamePassword === true});
      if (typeof onEnable === 'function') onEnable();
    },
    async disable() {
      paths.removeFile(stateFile);
      if (typeof onDisable === 'function') onDisable();
    },
    read() { return paths.readJson(stateFile, null); },
  };
}

module.exports = {createWidgetStore, createWidgetAgent};
