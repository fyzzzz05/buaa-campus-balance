'use strict';
const fs = require('node:fs');
const path = require('node:path');

// All Electron state lives below app.getPath() directories; nothing here may
// assume macOS paths.
function files({userData, logs}) {
  return {
    userData,
    logs,
    logDir: logs,
    settingsDir: path.join(userData, 'users'),
    accounts: path.join(userData, 'auto-login.json'),
    credentialsDir: path.join(userData, 'credentials'),
    snapshot: path.join(userData, 'widget-snapshot.json'),
    widgetWindow: path.join(userData, 'widget-window.json'),
    widgetAccount: path.join(userData, 'widget-account.json'),
    refreshState: path.join(userData, 'refresh-state.json'),
  };
}

function readJson(file, fallback = null) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : fallback;
  } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file, JSON.stringify(value), {mode: 0o600});
}

function removeFile(file) {
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

// Clamps a saved widget position into the nearest visible work area. Work areas
// come from screen.getAllDisplays() and are already in DIP coordinates.
function clampWindowPosition(position, size, workAreas) {
  const areas = Array.isArray(workAreas) ? workAreas.filter(area => area && Number.isFinite(area.x) && Number.isFinite(area.y) && area.width > 0 && area.height > 0) : [];
  const width = Math.max(1, Number(size?.width) || 0);
  const height = Math.max(1, Number(size?.height) || 0);
  const saved = position && Number.isFinite(position.x) && Number.isFinite(position.y) ? {x: position.x, y: position.y} : null;
  if (areas.length === 0) return saved ? {x: Math.round(saved.x), y: Math.round(saved.y)} : {x: 0, y: 0};
  let area = areas[0];
  if (saved) {
    let best = Infinity;
    for (const candidate of areas) {
      const distance = Math.hypot(saved.x + width / 2 - (candidate.x + candidate.width / 2), saved.y + height / 2 - (candidate.y + candidate.height / 2));
      if (distance < best) { best = distance; area = candidate; }
    }
  }
  const maxX = area.x + area.width - width, maxY = area.y + area.height - height;
  const x = saved ? Math.min(Math.max(saved.x, area.x), Math.max(area.x, maxX)) : area.x + Math.max(0, (area.width - width) / 2);
  const y = saved ? Math.min(Math.max(saved.y, area.y), Math.max(area.y, maxY)) : area.y + Math.max(0, (area.height - height) / 2);
  return {x: Math.round(x), y: Math.round(y)};
}

module.exports = {files, readJson, writeJson, removeFile, clampWindowPosition};
