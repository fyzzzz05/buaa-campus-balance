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
    widgetAccount: path.join(userData, 'widget-account.json'),
    refreshState: path.join(userData, 'refresh-state.json'),
  };
}

// Anchors the tray popup beside the tray icon. Taskbars can sit on any edge, so
// detect the edge from where the icon sits relative to the work area.
function anchorPopup({tray, workArea, size}) {
  const gap = 8;
  const width = Math.max(1, Number(size?.width) || 0);
  const height = Math.max(1, Number(size?.height) || 0);
  const area = workArea && Number.isFinite(workArea.x) && Number.isFinite(workArea.y) && workArea.width > 0 && workArea.height > 0
    ? workArea : {x: 0, y: 0, width: 1920, height: 1080};
  const icon = tray && Number.isFinite(tray.x) && Number.isFinite(tray.y) && tray.width > 0 && tray.height > 0 ? tray : null;
  let x, y;
  if (icon) {
    const topEdge = icon.y + icon.height <= area.y + 2;
    const bottomEdge = icon.y >= area.y + area.height - 2;
    const leftEdge = icon.x + icon.width <= area.x + 2;
    const rightEdge = icon.x >= area.x + area.width - 2;
    if (bottomEdge) { x = icon.x + icon.width - width; y = icon.y - height - gap; }
    else if (topEdge) { x = icon.x + icon.width - width; y = icon.y + icon.height + gap; }
    else if (rightEdge) { x = icon.x - width - gap; y = icon.y + icon.height / 2 - height / 2; }
    else if (leftEdge) { x = icon.x + icon.width + gap; y = icon.y + icon.height / 2 - height / 2; }
  }
  if (!Number.isFinite(x)) { x = area.x + area.width - width - gap; y = area.y + area.height - height - gap; }
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  return {
    x: Math.round(clamp(x, area.x + gap, area.x + area.width - width - gap)),
    y: Math.round(clamp(y, area.y + gap, area.y + area.height - height - gap)),
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

module.exports = {files, readJson, writeJson, removeFile, clampWindowPosition, anchorPopup};
