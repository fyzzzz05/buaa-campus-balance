'use strict';
// Minimal, sandboxed bridge for the page and the widget window.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('campusBridge', {
  openSchoolLogin: () => ipcRenderer.invoke('campus:open-school-login'),
});

contextBridge.exposeInMainWorld('campusWidget', {
  getSnapshot: () => ipcRenderer.invoke('widget:get-snapshot'),
  onSnapshot: callback => {
    const handler = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('widget:snapshot', handler);
    return () => ipcRenderer.removeListener('widget:snapshot', handler);
  },
  openMain: metric => ipcRenderer.send('widget:open', metric),
});
