const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('desktopNotifier', {
  login: (payload) => ipcRenderer.invoke('auth:login', payload),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getState: () => ipcRenderer.invoke('notifications:get-state'),
  refresh: () => ipcRenderer.invoke('notifications:refresh'),
  markRead: (id) => ipcRenderer.invoke('notifications:mark-read', id),
  markAllRead: () => ipcRenderer.invoke('notifications:mark-all-read'),
  setMute: (mute) => ipcRenderer.invoke('settings:set-mute', mute),
  openUrl: (url) => ipcRenderer.invoke('app:open-url', url),
  minimizeToTray: () => ipcRenderer.invoke('window:minimize-to-tray'),
  confirmQuit: () => ipcRenderer.invoke('window:confirm-quit'),
  soundPath: path.join(__dirname, 'assets', 'faang.wav'),
  onStateUpdate: (callback) => ipcRenderer.on('state:update', (_event, value) => callback(value)),
  onPlaySound: (callback) => ipcRenderer.on('notifications:play-sound', callback),
});
