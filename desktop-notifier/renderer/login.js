const baseUrlInput = document.getElementById('baseUrl');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const errorEl = document.getElementById('error');

async function submitLogin() {
  errorEl.textContent = '';
  if (!window.desktopNotifier || typeof window.desktopNotifier.login !== 'function') {
    errorEl.textContent = 'Desktop bridge is not ready. Please restart the notifier.';
    return;
  }
  loginBtn.disabled = true;
  loginBtn.textContent = 'Connecting...';
  try {
    await window.desktopNotifier.login({
      baseUrl: baseUrlInput.value,
      email: emailInput.value,
      password: passwordInput.value,
    });
  } catch (error) {
    errorEl.textContent = error.message || 'Unable to sign in';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
}

loginBtn.addEventListener('click', submitLogin);
passwordInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitLogin();
});

window.addEventListener('DOMContentLoaded', () => {
  if (!window.desktopNotifier || typeof window.desktopNotifier.login !== 'function') {
    errorEl.textContent = 'Desktop bridge is not ready. Please restart the notifier.';
  }
});
