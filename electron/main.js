'use strict';
const {app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, session, safeStorage, shell} = require('electron');
const path = require('node:path');
const campus = require('../lib/campus');
const diagnostics = require('../lib/diagnostics');
const settings = require('../lib/settings');
const widgetSnapshot = require('../lib/widget-snapshot');
const {createCredentials} = require('./credentials');
const {createWidgetStore, createWidgetAgent} = require('./widget-store');
const {createScheduler} = require('./scheduler');
const {isAllowedSchoolUrl, isLoginPageUrl, isLocalUrl, isSafeExternal, isSchoolCookieDomain} = require('./navigation');
const paths = require('./paths');
const {startAppServer} = require('./server');

const APP_ID = 'edu.buaa.campusbalance';
const SSO_LOGIN_URL = 'https://www.cc-pay.cn/login?channel=BUAASSO';
const WIDGET_SIZE = {width: 170, height: 170};
const METRICS = new Set(['card', 'network', 'lighting', 'air']);

let mainWindow = null;
let ssoWindow = null;
let widgetWindow = null;
let tray = null;
let appServer = null;
let appFiles = null;
let credentialStore = null;
let widgetStore = null;
let widgetAgentImpl = null;
let scheduler = null;
let quitting = false;
let importingSchoolSession = false;
let widgetVisible = false;
let widgetUserToggled = false;
let saveWidgetTimer = null;

app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { void showMain(); });
  app.on('activate', () => { void showMain(); });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('before-quit', () => {
    quitting = true;
    if (scheduler) scheduler.stop();
    if (appServer) { try { appServer.server.server.close(); } catch { /* already closed */ } }
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', webEvent => webEvent.preventDefault());
  });
  app.whenReady().then(bootstrap).catch(error => {
    dialog.showErrorBox('校园余额', '无法启动校园余额服务，请重新打开应用。');
    console.error(error);
    app.quit();
  });
}

function systemBackground() { return nativeTheme.shouldUseDarkColors ? '#0F141C' : '#ECEFF4'; }

async function bootstrap() {
  const userData = app.getPath('userData');
  const logs = app.getPath('logs');
  appFiles = paths.files({userData, logs});
  credentialStore = createCredentials({safeStorage, directory: appFiles.credentialsDir, accountsFile: appFiles.accounts});
  widgetStore = createWidgetStore({snapshotFile: appFiles.snapshot, onChange: snapshot => onSnapshotChanged(snapshot)});
  widgetAgentImpl = createWidgetAgent({
    stateFile: appFiles.widgetAccount,
    onEnable: () => { if (scheduler) scheduler.start(); },
    onDisable: () => { if (scheduler) scheduler.stop(); },
  });

  appServer = await startAppServer({
    publicDir: path.join(app.getAppPath(), 'public'),
    files: appFiles,
    credentialStore,
    widgetStore,
    widgetAgentImpl,
  });

  setupMenu();
  createMainWindow();
  createWidgetWindow();
  createTray();
  setupScheduler();
  powerMonitor.on('resume', () => { if (scheduler) scheduler.resume(); });
  screen.on('display-metrics-changed', () => reflowWidget());
  screen.on('display-removed', () => reflowWidget());
  screen.on('display-added', () => reflowWidget());

  await maybeAutoLogin();
  if (!process.argv.includes('--hidden')) await showMain();
}

// ===================== 主窗口 =====================

function createMainWindow() {
  const campusSession = session.fromPartition('campus');
  campusSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  campusSession.setPermissionCheckHandler(() => false);

  mainWindow = new BrowserWindow({
    width: 1050,
    height: 720,
    minWidth: 340,
    minHeight: 560,
    show: false,
    title: '校园余额',
    backgroundColor: systemBackground(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      session: campusSession,
    },
  });
  mainWindow.loadURL(appServer.server.url).catch(() => {});
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWindow.show();
  });
  mainWindow.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.webContents.setWindowOpenHandler(({url}) => { openExternal(url); return {action: 'deny'}; });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalUrl(url, appServer.server.origin)) return;
    event.preventDefault();
    openExternal(url);
  });
}

async function showMain(item) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (item && METRICS.has(item)) {
    try { await mainWindow.loadURL(appServer.server.url + 'dashboard?' + new URLSearchParams({item}).toString()); }
    catch { /* page reload failed; still show the window */ }
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ===================== 学校统一认证 =====================

async function openSchoolLogin() {
  if (!mainWindow) return;
  if (ssoWindow && !ssoWindow.isDestroyed()) { ssoWindow.focus(); return; }
  const campusSession = session.fromPartition('campus');
  ssoWindow = new BrowserWindow({
    parent: mainWindow,
    width: 960,
    height: 760,
    title: '学校统一认证',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      session: campusSession,
    },
  });
  ssoWindow.once('ready-to-show', () => { if (ssoWindow) ssoWindow.show(); });
  ssoWindow.on('closed', () => { ssoWindow = null; });
  ssoWindow.webContents.setWindowOpenHandler(({url}) => { openExternal(url); return {action: 'deny'}; });
  const guard = (event, url) => {
    if (isAllowedSchoolUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  };
  ssoWindow.webContents.on('will-navigate', guard);
  ssoWindow.webContents.on('will-redirect', guard);
  ssoWindow.webContents.on('did-navigate', (_event, url) => { void importSchoolSession(url); });
  ssoWindow.webContents.on('did-frame-navigate', (_event, url) => { void importSchoolSession(url); });
  try { await ssoWindow.loadURL(SSO_LOGIN_URL); }
  catch { /* navigation errors are reported by the school page itself */ }
}

async function importSchoolSession(url) {
  if (importingSchoolSession || !ssoWindow || ssoWindow.isDestroyed() || !isLoginPageUrl(url)) return;
  importingSchoolSession = true;
  try {
    const campusSession = session.fromPartition('campus');
    const cookies = await campusSession.cookies.get({});
    const values = cookies
      .filter(cookie => isSchoolCookieDomain(cookie.domain))
      .map(cookie => ({name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path || '/'}));
    if (values.length === 0) return;
    const response = await fetch(new URL('/api/auth', appServer.server.url).href, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Campus-Native-Token': appServer.nativeToken},
      body: JSON.stringify({action: 'school-session', cookies: values}),
    });
    if (!response.ok) return;
    await applySessionCookies(response.headers.getSetCookie(), campusSession);
    if (ssoWindow && !ssoWindow.isDestroyed()) ssoWindow.close();
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(appServer.server.url + 'dashboard');
  } catch (error) {
    diagnostics.report(error, 'schoolLogin');
  } finally {
    importingSchoolSession = false;
  }
}

async function applySessionCookies(setCookieHeaders, targetSession) {
  for (const header of setCookieHeaders || []) {
    const pair = String(header).split(';')[0];
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    const name = pair.slice(0, at), value = pair.slice(at + 1);
    try {
      await targetSession.cookies.set({url: appServer.server.origin, name, value, httpOnly: true, sameSite: 'lax'});
    } catch { /* a cookie the store rejects is not fatal */ }
  }
}

// ===================== 自动登录 =====================

async function maybeAutoLogin() {
  if (!credentialStore.available()) return;
  const user = credentialStore.autoLoginUser();
  if (!user) return;
  let password;
  try { password = credentialStore.read(user); } catch { return; }
  try {
    const response = await fetch(new URL('/api/auth', appServer.server.url).href, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Origin: appServer.server.origin},
      body: JSON.stringify({username: user, password, networkSamePassword: credentialStore.networkSamePassword(), autoLogin: true}),
    });
    if (!response.ok) return;
    await applySessionCookies(response.headers.getSetCookie(), session.fromPartition('campus'));
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(appServer.server.url + 'dashboard');
  } catch (error) {
    diagnostics.report(error, 'autoLogin');
  }
}

// ===================== 每日后台刷新 =====================

function setupScheduler() {
  scheduler = createScheduler({
    stateFile: appFiles.refreshState,
    refresh: backgroundRefresh,
    onError: error => diagnostics.report(error, 'autoLogin'),
  });
  if (widgetAgentImpl.read()) scheduler.start();
}

async function backgroundRefresh() {
  const account = widgetAgentImpl.read();
  if (!account || typeof account.user !== 'string') throw new Error('未启用自动重新登录');
  if (!credentialStore.available()) throw new Error('系统凭据存储不可用');
  const password = credentialStore.read(account.user);
  const current = await campus.login(account.user, password, account.networkSamePassword === true);
  const data = {};
  try { data.card = await campus.card(current, {balanceOnly: true}); }
  catch (error) { data.card = diagnostics.failure(error, 'cardBalance'); }
  try { data.net = await campus.network(current, {balanceOnly: true}); }
  catch (error) { data.net = diagnostics.failure(error, 'networkBalance'); }
  try { Object.assign(data, await campus.electricity(settings.read(account.user))); }
  catch (error) { data.lighting = data.air = diagnostics.failure(error, 'electricityMeter'); }
  await widgetSnapshot.publish(data);
  return data;
}

async function refreshNow() {
  if (widgetAgentImpl.read()) {
    try { await scheduler.refreshNow(); }
    catch (error) { diagnostics.report(error, 'refresh'); }
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.webContents.reload();
}

// ===================== 小组件小窗 =====================

function createWidgetWindow() {
  const saved = paths.readJson(appFiles.widgetWindow, {}) || {};
  widgetVisible = saved.visible === true;
  const bounds = paths.clampWindowPosition(saved, WIDGET_SIZE, workAreas());
  widgetWindow = new BrowserWindow({
    ...WIDGET_SIZE,
    x: bounds.x,
    y: bounds.y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    title: '校园余额小组件',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      session: session.fromPartition('widget'),
    },
  });
  widgetWindow.setAlwaysOnTop(true, 'floating');
  widgetWindow.loadFile(path.join(__dirname, 'widget.html')).catch(() => {});
  widgetWindow.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  widgetWindow.webContents.on('will-navigate', event => event.preventDefault());
  widgetWindow.webContents.once('did-finish-load', () => {
    sendWidgetSnapshot(widgetStore.read());
    if (widgetVisible) widgetWindow.showInactive();
  });
  widgetWindow.on('move', scheduleWidgetSave);
  widgetWindow.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    setWidgetVisible(false);
  });
  widgetWindow.on('closed', () => { widgetWindow = null; });
}

function workAreas() {
  try { return screen.getAllDisplays().map(display => display.workArea); }
  catch { return []; }
}

function reflowWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const bounds = widgetWindow.getBounds();
  const target = paths.clampWindowPosition({x: bounds.x, y: bounds.y}, WIDGET_SIZE, workAreas());
  if (target.x !== bounds.x || target.y !== bounds.y) widgetWindow.setPosition(target.x, target.y);
}

function scheduleWidgetSave() {
  if (saveWidgetTimer) clearTimeout(saveWidgetTimer);
  saveWidgetTimer = setTimeout(() => {
    saveWidgetTimer = null;
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const bounds = widgetWindow.getBounds();
    paths.writeJson(appFiles.widgetWindow, {x: bounds.x, y: bounds.y, visible: widgetVisible});
  }, 500);
}

function setWidgetVisible(visible) {
  widgetVisible = visible === true;
  widgetUserToggled = true;
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  if (widgetVisible) widgetWindow.showInactive(); else widgetWindow.hide();
  if (appFiles) {
    const bounds = widgetWindow.getBounds();
    paths.writeJson(appFiles.widgetWindow, {x: bounds.x, y: bounds.y, visible: widgetVisible});
  }
  refreshTrayMenu();
}

function onSnapshotChanged(snapshot) {
  sendWidgetSnapshot(snapshot);
  if (snapshot && !widgetVisible && !widgetUserToggled && widgetWindow && !widgetWindow.isDestroyed()) {
    widgetVisible = true;
    widgetWindow.showInactive();
    refreshTrayMenu();
  }
}

function sendWidgetSnapshot(snapshot) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  try { widgetWindow.webContents.send('widget:snapshot', snapshot); } catch { /* not loaded yet */ }
}

// ===================== 托盘 / 菜单 / 快捷键 =====================

function trayImage() {
  for (const name of ['tray-32.png', 'tray-16.png']) {
    try {
      const image = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', name));
      if (!image.isEmpty()) return image;
    } catch { /* fall through */ }
  }
  return nativeImage.createEmpty();
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('校园余额');
  refreshTrayMenu();
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) mainWindow.hide();
    else void showMain();
  });
  tray.on('double-click', () => { void showMain(); });
}

function refreshTrayMenu() {
  if (!tray) return;
  const template = [
    {label: '打开主窗口', click: () => { void showMain(); }},
    {label: '立即刷新', click: () => { void refreshNow(); }},
    {label: '显示小组件', type: 'checkbox', checked: widgetVisible, click: item => setWidgetVisible(item.checked)},
  ];
  if (process.platform === 'win32') {
    template.push({label: '开机自启', type: 'checkbox', checked: app.getLoginItemSettings({args: ['--hidden']}).openAtLogin, click: item => {
      app.setLoginItemSettings({openAtLogin: item.checked, args: ['--hidden']});
      refreshTrayMenu();
    }});
  }
  template.push({type: 'separator'}, {label: '退出', click: () => { quitting = true; app.quit(); }});
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function setupMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label: '校园余额', submenu: [{role: 'about'}, {type: 'separator'}, {role: 'hide'}, {role: 'quit'}]},
      {role: 'editMenu'},
      {role: 'windowMenu'},
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

function openExternal(url) {
  if (isSafeExternal(url)) { void shell.openExternal(url); }
}

// ===================== IPC =====================

ipcMain.handle('campus:open-school-login', async () => { await openSchoolLogin(); return true; });
ipcMain.handle('widget:get-snapshot', () => (widgetStore ? widgetStore.read() : null));
ipcMain.on('widget:open', (_event, metric) => { void showMain(typeof metric === 'string' && METRICS.has(metric) ? metric : null); });
