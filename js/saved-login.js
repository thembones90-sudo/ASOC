// ASOC saved logins ("Remember me on this device").
//
// Desktop app: username + password are kept by the app itself, encrypted
// with Windows' per-user protection (window.asocDesktop.credentials, see
// desktop/main.js). Electron has no password manager, so without this the
// app could never remember a login.
//
// Browsers: the password NEVER touches site storage. The browser's own
// password manager is asked to save it (Credential Management API where
// supported, plus correct autocomplete attributes everywhere), and only the
// username is remembered here so the field is pre-filled.
//
// Saved logins only FILL the form; nothing auto-submits. A wrong saved GM
// password must never burn GM lockout attempts on its own.
(function () {
  const USERNAME_KEY = kind => `asoc_saved_login_${kind}`;
  const REMEMBER_KEY = kind => `asoc_remember_login_${kind}`;

  function desktopStore() {
    const store = window.asocDesktop?.credentials;
    return store && typeof store.get === 'function' ? store : null;
  }

  function readLocal(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function writeLocal(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {}
  }

  const api = {
    mode: desktopStore() ? 'desktop' : 'browser',

    // Checkbox default: on, unless this device was told to forget.
    rememberPreference(kind) {
      return readLocal(REMEMBER_KEY(kind)) !== '0';
    },

    // -> { username, password } | { username } | null
    async load(kind) {
      const store = desktopStore();
      if (store) {
        try {
          const saved = await store.get(kind);
          if (saved && (saved.username || saved.password)) return saved;
        } catch {}
        return null;
      }
      const username = readLocal(USERNAME_KEY(kind));
      return username ? { username } : null;
    },

    async save(kind, { username, password, name }) {
      writeLocal(REMEMBER_KEY(kind), '1');
      const store = desktopStore();
      if (store) {
        try { await store.save(kind, { username: String(username || ''), password: String(password || '') }); } catch {}
        return;
      }
      if (username) writeLocal(USERNAME_KEY(kind), String(username));
      // Chrome/Edge/Android: hand the credential to the browser's password
      // manager explicitly. Needed because these logins never navigate away
      // from the page, which is how browsers normally detect a login.
      try {
        if (window.PasswordCredential && navigator.credentials?.store && username && password) {
          await navigator.credentials.store(new window.PasswordCredential({ id: String(username), password: String(password), name: String(name || username) }));
        }
      } catch {}
    },

    // Drops the saved login but keeps the "remember" preference -- used when a
    // saved password was rejected (changed elsewhere), so it can't keep
    // failing (and burning GM lockout attempts) on every later click.
    async clear(kind) {
      writeLocal(USERNAME_KEY(kind), null);
      const store = desktopStore();
      if (store) {
        try { await store.forget(kind); } catch {}
      }
    },

    // The user said "forget": drop it and stop remembering on this device.
    async forget(kind) {
      writeLocal(REMEMBER_KEY(kind), '0');
      await this.clear(kind);
    }
  };

  window.AsocSavedLogin = api;
})();
