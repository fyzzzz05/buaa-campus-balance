'use strict';
// Minimal, sandboxed bridge for the page and the widget window.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('campusBridge', {
  openSchoolLogin: () => ipcRenderer.invoke('campus:open-school-login'),
  onOpenSettings: callback => {
    ipcRenderer.on('campus:open-settings', () => callback());
  },
});

contextBridge.exposeInMainWorld('campusPanel', {
  getSnapshot: () => ipcRenderer.invoke('panel:get-snapshot'),
  onSnapshot: callback => {
    const handler = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('panel:snapshot', handler);
    return () => ipcRenderer.removeListener('panel:snapshot', handler);
  },
  refresh: () => ipcRenderer.invoke('panel:refresh'),
  resize: height => ipcRenderer.send('panel:resize', height),
  openMain: metric => ipcRenderer.send('panel:open-main', metric),
  openSettings: () => ipcRenderer.send('panel:open-settings'),
  hide: () => ipcRenderer.send('panel:hide'),
});
