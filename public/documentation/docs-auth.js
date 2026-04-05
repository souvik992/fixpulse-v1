(function () {
  var LOGIN_KEY = 'fixpulse_docs_session';
  var CONTENT_KEY = 'fixpulse_docs_content';
  var USERNAME = 'docsadmin';
  var PASSWORD = 'fixpulse-docs';

  var schema = [
    { key: 'hero_title', label: 'Hero Title', type: 'textarea' },
    { key: 'hero_intro', label: 'Hero Intro', type: 'textarea' },
    { key: 'admins_callout', label: 'Admins Callout', type: 'textarea' },
    { key: 'contributors_callout', label: 'Contributors Callout', type: 'textarea' },
    { key: 'managers_callout', label: 'Managers Callout', type: 'textarea' },
    { key: 'overview_intro', label: 'Overview Intro', type: 'textarea' },
    { key: 'quickstart_1', label: 'Quick Start 1', type: 'text' },
    { key: 'quickstart_2', label: 'Quick Start 2', type: 'text' },
    { key: 'quickstart_3', label: 'Quick Start 3', type: 'text' },
    { key: 'quickstart_4', label: 'Quick Start 4', type: 'text' },
    { key: 'quickstart_5', label: 'Quick Start 5', type: 'text' },
    { key: 'quickstart_6', label: 'Quick Start 6', type: 'text' },
    { key: 'settings_intro', label: 'Company Settings Intro', type: 'textarea' }
  ];

  function getContent() {
    try {
      return JSON.parse(localStorage.getItem(CONTENT_KEY) || '{}');
    } catch (_error) {
      return {};
    }
  }

  function saveContent(payload) {
    localStorage.setItem(CONTENT_KEY, JSON.stringify(payload));
  }

  function resetContent() {
    localStorage.removeItem(CONTENT_KEY);
  }

  function login(username, password) {
    if (username === USERNAME && password === PASSWORD) {
      sessionStorage.setItem(LOGIN_KEY, '1');
      return true;
    }
    return false;
  }

  function isLoggedIn() {
    return sessionStorage.getItem(LOGIN_KEY) === '1';
  }

  function logout() {
    sessionStorage.removeItem(LOGIN_KEY);
  }

  function applyContentOverrides() {
    var content = getContent();
    Object.keys(content).forEach(function (key) {
      var value = content[key];
      if (!value) return;
      var node = document.querySelector('[data-doc-key="' + key + '"]');
      if (node) node.textContent = value;
    });
  }

  window.DocsAuth = {
    applyContentOverrides: applyContentOverrides,
    getContent: getContent,
    getSchema: function () { return schema.slice(); },
    isLoggedIn: isLoggedIn,
    login: login,
    logout: logout,
    resetContent: resetContent,
    saveContent: saveContent
  };
})();
