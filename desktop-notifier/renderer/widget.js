const metaText = document.getElementById('metaText');
const countPill = document.getElementById('countPill');
const listEl = document.getElementById('list');
const refreshBtn = document.getElementById('refreshBtn');
const muteBtn = document.getElementById('muteBtn');
const readAllBtn = document.getElementById('readAllBtn');
const logoutBtn = document.getElementById('logoutBtn');
const minimizeBtn = document.getElementById('minimizeBtn');
const closeBtn = document.getElementById('closeBtn');
const soundPlayer = document.getElementById('soundPlayer');
soundPlayer.src = `file://${window.desktopNotifier.soundPath.replace(/\\/g, '/')}`;

function timeAgo(ts) {
  const diff = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function render(state) {
  metaText.textContent = state.user
    ? `${state.user.name} • ${state.org?.name || 'Organization'}`
    : 'Signed out';
  countPill.textContent = String(state.unreadCount || 0);
  muteBtn.textContent = state.mute ? 'Unmute' : 'Mute';

  if (state.loading && !(state.notifications || []).length) {
    listEl.innerHTML = `<div class="empty"><span class="spinner"></span><div style="margin-top:12px;">Loading notifications...</div></div>`;
    return;
  }

  if (!(state.notifications || []).length) {
    listEl.innerHTML = `<div class="empty">No assignment notifications yet.</div>`;
    return;
  }

  listEl.innerHTML = state.notifications.map((item) => `
    <div class="notification ${item.isRead ? '' : 'unread'}">
      <div class="notification-title">${item.title || 'Assignment update'}</div>
      <div class="notification-body">${item.message || ''}</div>
      <div class="notification-footer">
        <div class="notification-time">${timeAgo(item.createdAt)}</div>
        ${item.isRead ? '' : `<button class="small-link" data-read="${item.id}">Mark read</button>`}
      </div>
    </div>
  `).join('');

  Array.from(document.querySelectorAll('[data-read]')).forEach((button) => {
    button.addEventListener('click', async () => {
      await window.desktopNotifier.markRead(button.dataset.read);
      const nextState = await window.desktopNotifier.getState();
      render(nextState);
    });
  });
}

window.desktopNotifier.onStateUpdate(render);
window.desktopNotifier.onPlaySound(() => {
  soundPlayer.currentTime = 0;
  soundPlayer.play().catch(() => {});
});

refreshBtn.addEventListener('click', async () => render(await window.desktopNotifier.refresh()));
muteBtn.addEventListener('click', async () => {
  const state = await window.desktopNotifier.getState();
  await window.desktopNotifier.setMute(!state.mute);
  render(await window.desktopNotifier.getState());
});
readAllBtn.addEventListener('click', async () => {
  await window.desktopNotifier.markAllRead();
  render(await window.desktopNotifier.getState());
});
logoutBtn.addEventListener('click', async () => {
  await window.desktopNotifier.logout();
});
minimizeBtn.addEventListener('click', async () => {
  await window.desktopNotifier.minimizeToTray();
});
closeBtn.addEventListener('click', async () => {
  await window.desktopNotifier.confirmQuit();
});

window.desktopNotifier.getState().then(render);
