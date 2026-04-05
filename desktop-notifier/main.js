const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const POLL_INTERVAL_MS = 15000;
const WIDGET_WIDTH = 380;
const WIDGET_HEIGHT = 640;

let loginWindow = null;
let widgetWindow = null;
let tray = null;
let pollTimer = null;
let cachedState = { user: null, org: null, notifications: [], unreadCount: 0, loading: false, mute: false };
let hasBootstrapped = false;
let knownNotificationIds = new Set();

function getStateFile() {
  return path.join(app.getPath('userData'), 'desktop-state.json');
}

function readPersistedState() {
  try {
    return JSON.parse(fs.readFileSync(getStateFile(), 'utf8'));
  } catch {
    return { baseUrl: 'http://localhost:3000', token: '', mute: false };
  }
}

function writePersistedState(next) {
  fs.mkdirSync(path.dirname(getStateFile()), { recursive: true });
  fs.writeFileSync(getStateFile(), JSON.stringify(next, null, 2));
}

function getPersistedState() {
  return { ...readPersistedState(), mute: Boolean(readPersistedState().mute) };
}

function setPersistedState(patch) {
  const current = getPersistedState();
  const next = { ...current, ...patch };
  writePersistedState(next);
  cachedState.mute = Boolean(next.mute);
  return next;
}

function buildHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const error = new Error(data?.error || `Request failed: ${res.status}`);
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function loginWithPassword({ baseUrl, email, password }) {
  return apiFetch(`${baseUrl.replace(/\/$/, '')}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function fetchMe(baseUrl, token) {
  return apiFetch(`${baseUrl.replace(/\/$/, '')}/api/auth/me`, {
    headers: buildHeaders(token),
  });
}

async function fetchNotifications(baseUrl, token) {
  return apiFetch(`${baseUrl.replace(/\/$/, '')}/api/notifications?limit=50`, {
    headers: buildHeaders(token),
  });
}

async function markNotificationRead(baseUrl, token, id) {
  return apiFetch(`${baseUrl.replace(/\/$/, '')}/api/notifications/${id}/read`, {
    method: 'POST',
    headers: buildHeaders(token),
  });
}

async function markAllNotificationsRead(baseUrl, token) {
  return apiFetch(`${baseUrl.replace(/\/$/, '')}/api/notifications/read-all`, {
    method: 'POST',
    headers: buildHeaders(token),
  });
}

function createTray() {
  if (tray) return;
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'public', 'fixpulse-logo-small.png'));
  tray = new Tray(trayIcon);
  tray.setToolTip('FixPulse Notifier');
  tray.on('click', () => {
    if (widgetWindow) {
      widgetWindow.isVisible() ? widgetWindow.hide() : widgetWindow.show();
    } else if (loginWindow) {
      loginWindow.show();
    }
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open', click: () => widgetWindow?.show() || loginWindow?.show() },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function updateTray() {
  if (!tray) return;
  const unread = cachedState.unreadCount || 0;
  tray.setToolTip(unread > 0 ? `FixPulse Notifier (${unread} unread)` : 'FixPulse Notifier');
}

function sendStateToWindows() {
  updateTray();
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('state:update', cachedState);
  }
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.webContents.send('state:update', cachedState);
  }
}

function createLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show();
    return loginWindow;
  }
  loginWindow = new BrowserWindow({
    width: 460,
    height: 720,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loginWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
  loginWindow.on('closed', () => { loginWindow = null; });
  return loginWindow;
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    return widgetWindow;
  }
  widgetWindow = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    title: 'FixPulse Notifier',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  widgetWindow.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  widgetWindow.once('ready-to-show', () => {
    const display = require('electron').screen.getPrimaryDisplay().workArea;
    widgetWindow.setPosition(display.x + display.width - WIDGET_WIDTH - 20, display.y + 20);
    widgetWindow.show();
  });
  widgetWindow.on('closed', () => { widgetWindow = null; });
  return widgetWindow;
}

function showNotificationToast(item) {
  if (!item) return;
  if (Notification.isSupported()) {
    const toast = new Notification({
      title: item.title || 'FixPulse',
      body: item.message || item.bugTitle || 'New assignment',
      silent: true,
    });
    toast.on('click', () => {
      if (widgetWindow) widgetWindow.show();
    });
    toast.show();
  }
  if (!cachedState.mute && widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('notifications:play-sound');
  }
}

async function bootstrapSession() {
  const persisted = getPersistedState();
  cachedState.mute = Boolean(persisted.mute);
  if (!persisted.token) {
    createTray();
    createLoginWindow();
    sendStateToWindows();
    return;
  }
  try {
    const me = await fetchMe(persisted.baseUrl, persisted.token);
    cachedState.user = me.user;
    cachedState.org = me.org;
    createTray();
    createWidgetWindow();
    if (loginWindow) loginWindow.close();
    await refreshNotifications(true);
    startPolling();
  } catch {
    setPersistedState({ token: '' });
    cachedState.user = null;
    cachedState.org = null;
    cachedState.notifications = [];
    cachedState.unreadCount = 0;
    createTray();
    createLoginWindow();
    sendStateToWindows();
  }
}

async function refreshNotifications(isInitial = false) {
  const persisted = getPersistedState();
  if (!persisted.token) return;
  cachedState.loading = true;
  sendStateToWindows();
  try {
    const payload = await fetchNotifications(persisted.baseUrl, persisted.token);
    const items = payload.items || [];
    cachedState.notifications = items;
    cachedState.unreadCount = payload.unreadCount || 0;
    cachedState.loading = false;
    sendStateToWindows();

    if (!hasBootstrapped || isInitial) {
      knownNotificationIds = new Set(items.map((item) => item.id));
      hasBootstrapped = true;
      return;
    }

    for (const item of items) {
      if (!knownNotificationIds.has(item.id)) {
        knownNotificationIds.add(item.id);
        if (!item.isRead) showNotificationToast(item);
      }
    }
  } catch (error) {
    cachedState.loading = false;
    sendStateToWindows();
    if (error.status === 401 || error.status === 403) {
      setPersistedState({ token: '' });
      stopPolling();
      cachedState.user = null;
      cachedState.org = null;
      cachedState.notifications = [];
      cachedState.unreadCount = 0;
      createLoginWindow();
      if (widgetWindow) widgetWindow.close();
      sendStateToWindows();
    }
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    refreshNotifications(false);
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

ipcMain.handle('auth:login', async (_event, payload) => {
  const baseUrl = String(payload.baseUrl || 'http://localhost:3000').trim().replace(/\/$/, '');
  const result = await loginWithPassword({ baseUrl, email: payload.email, password: payload.password });
  setPersistedState({ baseUrl, token: result.token });
  cachedState.user = result.user;
  cachedState.org = result.org;
  cachedState.notifications = [];
  cachedState.unreadCount = 0;
  hasBootstrapped = false;
  knownNotificationIds = new Set();
  createWidgetWindow();
  if (loginWindow) loginWindow.close();
  await refreshNotifications(true);
  startPolling();
  sendStateToWindows();
  return { ok: true };
});

ipcMain.handle('auth:logout', async () => {
  setPersistedState({ token: '' });
  stopPolling();
  cachedState.user = null;
  cachedState.org = null;
  cachedState.notifications = [];
  cachedState.unreadCount = 0;
  knownNotificationIds = new Set();
  hasBootstrapped = false;
  if (widgetWindow) widgetWindow.close();
  createLoginWindow();
  sendStateToWindows();
  return { ok: true };
});

ipcMain.handle('notifications:get-state', async () => cachedState);
ipcMain.handle('notifications:refresh', async () => {
  await refreshNotifications(false);
  return cachedState;
});
ipcMain.handle('notifications:mark-read', async (_event, id) => {
  const persisted = getPersistedState();
  const result = await markNotificationRead(persisted.baseUrl, persisted.token, id);
  cachedState.unreadCount = result.unreadCount || 0;
  cachedState.notifications = cachedState.notifications.map((item) => item.id === id ? { ...item, isRead: true, readAt: new Date().toISOString() } : item);
  sendStateToWindows();
  return result;
});
ipcMain.handle('notifications:mark-all-read', async () => {
  const persisted = getPersistedState();
  const result = await markAllNotificationsRead(persisted.baseUrl, persisted.token);
  cachedState.unreadCount = 0;
  cachedState.notifications = cachedState.notifications.map((item) => ({ ...item, isRead: true }));
  sendStateToWindows();
  return result;
});
ipcMain.handle('settings:set-mute', async (_event, mute) => {
  setPersistedState({ mute: Boolean(mute) });
  sendStateToWindows();
  return { ok: true, mute: Boolean(mute) };
});
ipcMain.handle('app:open-url', async (_event, url) => {
  await shell.openExternal(url);
  return { ok: true };
});
ipcMain.handle('window:minimize-to-tray', async () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.hide();
  }
  return { ok: true };
});
ipcMain.handle('window:confirm-quit', async () => {
  const result = await dialog.showMessageBox(widgetWindow || loginWindow || null, {
    type: 'question',
    buttons: ['Cancel', 'Quit'],
    defaultId: 0,
    cancelId: 0,
    title: 'Quit FixPulse Notifier',
    message: 'Do you want to quit FixPulse Notifier?',
    detail: 'Choose Cancel to keep it running in the tray.',
  });
  if (result.response === 1) {
    app.exit(0);
    return { ok: true, quit: true };
  }
  return { ok: true, quit: false };
});

app.whenReady().then(() => {
  createTray();
  bootstrapSession();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
