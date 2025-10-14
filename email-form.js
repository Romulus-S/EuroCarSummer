function slugifyPath(pathname) {
  if (!pathname) return 'home';
  const parts = pathname.split('/');
  const leaf = parts.pop() || parts.pop() || 'index.html';
  const base = leaf.replace(/\.html?$/i, '') || 'index';
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'home';
}

function ensureEmailBanner() {
  if (document.querySelector('.email-banner')) {
    return;
  }

  const template = document.createElement('template');
  template.innerHTML = `
    <div class="email-banner">
      <div class="email-banner-inner">
        <p>Vuoi vendere la tua auto d'amatori? Scrivi qui la tua email e ti contatteremo!</p>
        <form class="email-form" data-endpoint="https://formsubmit.co/ajax/romulus@eurocarsummer.com" action="https://formsubmit.co/romulus@eurocarsummer.com" method="POST">
          <label>
            Indirizzo email
            <input name="email" type="email" placeholder="tuoindirizzo@email.com" required>
          </label>
          <input type="hidden" name="_subject" value="Nuova richiesta Euro Car Summer">
          <input type="hidden" name="_captcha" value="false">
          <button type="submit">Invia</button>
          <span class="form-helper">Le richieste vengono recapitate a romulus@eurocarsummer.com.</span>
        </form>
      </div>
    </div>
  `.trim();

  const banner = template.content.firstElementChild;
  const form = banner.querySelector('form');
  const label = form.querySelector('label');
  const input = form.querySelector('input[type="email"]');
  const slug = slugifyPath(window.location.pathname);
  const fieldId = `email-${slug || 'home'}`;

  label.setAttribute('for', fieldId);
  input.id = fieldId;

  const header = document.querySelector('.site-header');
  const parent = document.body;
  if (!parent) return;

  if (header) {
    parent.insertBefore(banner, header);
  } else {
    parent.insertBefore(banner, parent.firstChild);
  }
}

function ensureSiteHeader() {
  if (document.querySelector('.site-header')) {
    return;
  }

  const template = document.createElement('template');
  template.innerHTML = `
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="index.html">
          <img src="images/textlogo.png" alt="Euro Car Summer logo">
        </a>
        <nav>
          <a href="index.html">Home</a>
          <a href="macchina-del-giorno.html">Macchina Del Giorno</a>
          <a href="annunci-esclusivi.html">Annunci Esclusivi</a>
          <a href="aste.html">Aste</a>
        </nav>
        <div class="header-actions">
          <button type="button" class="auth-trigger">Accedi / Registrati</button>
          <div class="user-info" hidden>
            <span class="user-name" aria-live="polite"></span>
            <button type="button" class="logout-button">Esci</button>
          </div>
        </div>
      </div>
    </header>
  `.trim();

  const header = template.content.firstElementChild;
  const parent = document.body;
  if (!parent) return;
  parent.insertBefore(header, parent.firstChild);

  highlightActiveNav(header.querySelectorAll('nav a'));
}

function highlightActiveNav(links) {
  if (!links || !links.length) return;
  const pathname = window.location.pathname;
  const file = pathname.split('/').pop() || '';
  const patterns = [
    { href: 'index.html', match: (value) => value === '' || value === 'index.html' },
    { href: 'macchina-del-giorno.html', match: (value) => value === 'macchina-del-giorno.html' || /^\d{1,2}-\d{1,2}-\d{2}\.html$/i.test(value) },
    { href: 'annunci-esclusivi.html', match: (value) => value === 'annunci-esclusivi.html' },
    { href: 'aste.html', match: (value) => value === 'aste.html' },
  ];

  patterns.forEach(({ href, match }) => {
    if (match(file)) {
      const link = Array.from(links).find((anchor) => anchor.getAttribute('href') === href);
      if (link) {
        link.setAttribute('aria-current', 'page');
      }
    }
  });
}

const AUTH_STORAGE_KEYS = {
  users: 'ecsUsers',
  session: 'ecsSession',
};

const MIN_PASSWORD_LENGTH = 6;

const authStorage = (() => {
  try {
    const testKey = '__ecs_auth_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch (error) {
    return null;
  }
})();

let authKeyListenerAttached = false;

function normaliseEmail(email) {
  return (email || '').trim().toLowerCase();
}

function loadUsers() {
  if (!authStorage) return [];
  try {
    const raw = authStorage.getItem(AUTH_STORAGE_KEYS.users);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveUsers(users) {
  if (!authStorage) return;
  try {
    authStorage.setItem(AUTH_STORAGE_KEYS.users, JSON.stringify(users));
  } catch (error) {
    // ignore storage errors
  }
}

function getSession() {
  if (!authStorage) return null;
  try {
    const raw = authStorage.getItem(AUTH_STORAGE_KEYS.session);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function setSession(user) {
  if (!authStorage || !user) return;
  try {
    authStorage.setItem(
      AUTH_STORAGE_KEYS.session,
      JSON.stringify({ userId: user.id, email: user.email, timestamp: Date.now() }),
    );
  } catch (error) {
    // ignore storage errors
  }
}

function clearSession() {
  if (!authStorage) return;
  try {
    authStorage.removeItem(AUTH_STORAGE_KEYS.session);
  } catch (error) {
    // ignore storage errors
  }
}

function getCurrentUser() {
  const session = getSession();
  if (!session) return null;
  const users = loadUsers();
  const user = users.find((entry) => entry && entry.id === session.userId);
  if (!user) {
    clearSession();
    return null;
  }
  return user;
}

function fallbackHash(value) {
  return Array.from(value || '')
    .map((char, index) => (char.charCodeAt(0) + index).toString(16))
    .join('');
}

async function hashPassword(password) {
  const value = password || '';
  if (window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
    const encoder = new TextEncoder();
    const data = encoder.encode(value);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return fallbackHash(value);
}

function createUser({ email, passwordHash, displayName }) {
  const id =
    (window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `user-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  return {
    id,
    email: normaliseEmail(email),
    passwordHash,
    displayName: (displayName || '').trim(),
    createdAt: new Date().toISOString(),
  };
}

function deriveNameFromEmail(email) {
  const normalised = normaliseEmail(email);
  if (!normalised) return 'ospite';
  const [localPart] = normalised.split('@');
  if (!localPart) return normalised;
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

function ensureAuthModal() {
  let modal = document.querySelector('.auth-modal');
  if (modal) return modal;

  const template = document.createElement('template');
  template.innerHTML = `
    <div class="auth-modal" hidden>
      <div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-heading-login">
        <button type="button" class="auth-close" aria-label="Chiudi finestra di accesso">×</button>
        <form class="auth-form" data-mode="login" autocomplete="on">
          <h2 id="auth-heading-login">Accedi</h2>
          <p>Accedi con il tuo account Euro Car Summer per seguire le aste e salvare i tuoi annunci preferiti.</p>
          <label>
            Indirizzo email
            <input type="email" name="login-email" autocomplete="email" required>
          </label>
          <label>
            Password
            <input type="password" name="login-password" autocomplete="current-password" required minlength="6">
          </label>
          <p class="auth-feedback" role="status" aria-live="polite"></p>
          <button type="submit">Accedi</button>
          <p class="auth-switch">Non hai un account? <button type="button" data-switch-to="register">Registrati</button></p>
        </form>
        <form class="auth-form" data-mode="register" autocomplete="on" hidden>
          <h2 id="auth-heading-register">Registrati</h2>
          <p>Crea un account gratuito per ricevere aggiornamenti e partecipare alle aste esclusive.</p>
          <label>
            Nome (facoltativo)
            <input type="text" name="register-name" autocomplete="name" maxlength="60">
          </label>
          <label>
            Indirizzo email
            <input type="email" name="register-email" autocomplete="email" required>
          </label>
          <label>
            Password
            <input type="password" name="register-password" autocomplete="new-password" required minlength="6">
          </label>
          <label>
            Conferma password
            <input type="password" name="register-confirm" autocomplete="new-password" required minlength="6">
          </label>
          <p class="auth-feedback" role="status" aria-live="polite"></p>
          <button type="submit">Crea account</button>
          <p class="auth-switch">Hai già un account? <button type="button" data-switch-to="login">Accedi</button></p>
        </form>
      </div>
    </div>
  `.trim();

  modal = template.content.firstElementChild;
  if (!modal) return null;

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeAuthModal();
    }
  });

  const dialog = modal.querySelector('.auth-dialog');
  if (dialog) {
    dialog.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }

  document.body.appendChild(modal);
  return modal;
}

function resetAuthForms() {
  const modal = document.querySelector('.auth-modal');
  if (!modal) return;
  const forms = modal.querySelectorAll('.auth-form');
  forms.forEach((form) => {
    if (typeof form.reset === 'function') {
      form.reset();
    }
    showAuthMessage(form, '', null);
  });
}

function switchAuthMode(mode) {
  const modal = document.querySelector('.auth-modal');
  if (!modal) return;
  const desiredMode = mode === 'register' ? 'register' : 'login';
  modal.dataset.mode = desiredMode;
  const forms = modal.querySelectorAll('.auth-form');
  const dialog = modal.querySelector('.auth-dialog');

  forms.forEach((form) => {
    const isActive = form.dataset.mode === desiredMode;
    if (isActive) {
      form.removeAttribute('hidden');
      const heading = form.querySelector('h2[id]');
      if (dialog && heading) {
        dialog.setAttribute('aria-labelledby', heading.id);
      }
    } else {
      form.setAttribute('hidden', '');
    }
  });
}

function focusAuthField(mode) {
  const modal = document.querySelector('.auth-modal');
  if (!modal) return;
  const form = modal.querySelector(`.auth-form[data-mode="${mode}"]`);
  if (!form) return;
  const field = form.querySelector('input:not([type="hidden"]):not([disabled])');
  if (field) {
    field.focus();
  }
}

function openAuthModal(mode = 'login') {
  const modal = ensureAuthModal();
  if (!modal) return;
  resetAuthForms();
  switchAuthMode(mode);
  modal.hidden = false;
  requestAnimationFrame(() => {
    modal.classList.add('is-visible');
    focusAuthField(mode);
  });
  document.body.classList.add('auth-modal-open');
}

function closeAuthModal() {
  const modal = document.querySelector('.auth-modal');
  if (!modal || modal.hidden) return;
  modal.classList.remove('is-visible');
  document.body.classList.remove('auth-modal-open');
  window.setTimeout(() => {
    modal.hidden = true;
    resetAuthForms();
  }, 200);
}

function showAuthMessage(form, message, type) {
  if (!form) return;
  const feedback = form.querySelector('.auth-feedback');
  if (!feedback) return;
  feedback.textContent = message || '';
  feedback.classList.remove('is-error', 'is-success');
  if (type === 'error') {
    feedback.classList.add('is-error');
  } else if (type === 'success') {
    feedback.classList.add('is-success');
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const emailInput = form.querySelector('input[name="login-email"]');
  const passwordInput = form.querySelector('input[name="login-password"]');

  if (!authStorage) {
    showAuthMessage(form, 'Il salvataggio locale non è disponibile su questo dispositivo.', 'error');
    return;
  }

  const emailValue = normaliseEmail(emailInput ? emailInput.value : '');
  const passwordValue = passwordInput ? passwordInput.value : '';

  if (!emailValue) {
    showAuthMessage(form, 'Inserisci un indirizzo email valido.', 'error');
    if (emailInput) emailInput.focus();
    return;
  }

  if (!passwordValue) {
    showAuthMessage(form, 'Inserisci la tua password.', 'error');
    if (passwordInput) passwordInput.focus();
    return;
  }

  const users = loadUsers();
  const user = users.find((entry) => entry && entry.email === emailValue);
  if (!user) {
    showAuthMessage(form, 'Nessun account trovato per questa email.', 'error');
    if (emailInput) emailInput.focus();
    return;
  }

  try {
    const passwordHash = await hashPassword(passwordValue);
    if (user.passwordHash !== passwordHash) {
      showAuthMessage(form, 'Password non corretta. Riprova.', 'error');
      if (passwordInput) passwordInput.focus();
      return;
    }
  } catch (error) {
    showAuthMessage(form, 'Impossibile verificare le credenziali. Riprova.', 'error');
    return;
  }

  setSession(user);
  showAuthMessage(form, 'Accesso effettuato, bentornato!', 'success');
  form.reset();
  updateAuthUI();
  window.setTimeout(() => {
    closeAuthModal();
  }, 400);
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const nameInput = form.querySelector('input[name="register-name"]');
  const emailInput = form.querySelector('input[name="register-email"]');
  const passwordInput = form.querySelector('input[name="register-password"]');
  const confirmInput = form.querySelector('input[name="register-confirm"]');

  if (!authStorage) {
    showAuthMessage(form, 'La registrazione non è disponibile su questo dispositivo.', 'error');
    return;
  }

  const emailValue = normaliseEmail(emailInput ? emailInput.value : '');
  const passwordValue = passwordInput ? passwordInput.value : '';
  const confirmValue = confirmInput ? confirmInput.value : '';

  if (!emailValue) {
    showAuthMessage(form, 'Inserisci un indirizzo email valido.', 'error');
    if (emailInput) emailInput.focus();
    return;
  }

  if (passwordValue.length < MIN_PASSWORD_LENGTH) {
    showAuthMessage(
      form,
      `La password deve contenere almeno ${MIN_PASSWORD_LENGTH} caratteri.`,
      'error',
    );
    if (passwordInput) passwordInput.focus();
    return;
  }

  if (passwordValue !== confirmValue) {
    showAuthMessage(form, 'Le password non coincidono.', 'error');
    if (confirmInput) confirmInput.focus();
    return;
  }

  const users = loadUsers();
  const existingUser = users.find((entry) => entry && entry.email === emailValue);
  if (existingUser) {
    showAuthMessage(form, 'Esiste già un account con questa email.', 'error');
    if (emailInput) emailInput.focus();
    return;
  }

  try {
    const passwordHash = await hashPassword(passwordValue);
    const newUser = createUser({
      email: emailValue,
      passwordHash,
      displayName: nameInput ? nameInput.value : '',
    });
    users.push(newUser);
    saveUsers(users);
    setSession(newUser);
    showAuthMessage(form, 'Registrazione completata! Accesso effettuato.', 'success');
    form.reset();
    updateAuthUI();
    window.setTimeout(() => {
      closeAuthModal();
    }, 500);
  } catch (error) {
    showAuthMessage(form, 'Impossibile completare la registrazione. Riprova.', 'error');
  }
}

function handleLogout(event) {
  event.preventDefault();
  clearSession();
  updateAuthUI();
}

function updateAuthUI() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const actions = header.querySelector('.header-actions');
  if (!actions) return;

  const trigger = actions.querySelector('.auth-trigger');
  const userInfo = actions.querySelector('.user-info');
  const logoutButton = actions.querySelector('.logout-button');
  const nameTarget = actions.querySelector('.user-name');

  if (!authStorage) {
    if (trigger) {
      trigger.disabled = true;
      trigger.textContent = 'Accesso non disponibile';
    }
    if (userInfo) {
      userInfo.hidden = true;
    }
    if (logoutButton) {
      logoutButton.disabled = true;
    }
    return;
  }

  const user = getCurrentUser();
  if (user) {
    if (trigger) {
      trigger.hidden = true;
      trigger.disabled = false;
    }
    if (userInfo) {
      userInfo.hidden = false;
    }
    if (nameTarget) {
      const friendlyName = user.displayName || deriveNameFromEmail(user.email);
      nameTarget.textContent = `Ciao, ${friendlyName}`;
    }
    if (logoutButton) {
      logoutButton.disabled = false;
    }
  } else {
    if (trigger) {
      trigger.hidden = false;
      trigger.disabled = false;
      trigger.textContent = 'Accedi / Registrati';
    }
    if (userInfo) {
      userInfo.hidden = true;
    }
    if (nameTarget) {
      nameTarget.textContent = '';
    }
    if (logoutButton) {
      logoutButton.disabled = false;
    }
  }
}

function initialiseAuthSystem() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const modal = ensureAuthModal();
  if (!modal) return;

  const trigger = header.querySelector('.auth-trigger');
  const logoutButton = header.querySelector('.logout-button');

  if (trigger && trigger.dataset.initialised !== 'true') {
    trigger.addEventListener('click', () => openAuthModal('login'));
    trigger.dataset.initialised = 'true';
  }

  if (logoutButton && logoutButton.dataset.initialised !== 'true') {
    logoutButton.addEventListener('click', handleLogout);
    logoutButton.dataset.initialised = 'true';
  }

  if (modal.dataset.initialised !== 'true') {
    const closeButton = modal.querySelector('.auth-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => closeAuthModal());
    }

    const switchers = modal.querySelectorAll('[data-switch-to]');
    switchers.forEach((button) => {
      if (button.dataset.initialised === 'true') return;
      button.addEventListener('click', () => {
        const targetMode = button.dataset.switchTo === 'register' ? 'register' : 'login';
        switchAuthMode(targetMode);
        focusAuthField(targetMode);
      });
      button.dataset.initialised = 'true';
    });

    const loginForm = modal.querySelector('.auth-form[data-mode="login"]');
    const registerForm = modal.querySelector('.auth-form[data-mode="register"]');

    if (loginForm && loginForm.dataset.initialised !== 'true') {
      loginForm.addEventListener('submit', handleLoginSubmit);
      loginForm.dataset.initialised = 'true';
    }

    if (registerForm && registerForm.dataset.initialised !== 'true') {
      registerForm.addEventListener('submit', handleRegisterSubmit);
      registerForm.dataset.initialised = 'true';
    }

    modal.dataset.initialised = 'true';
  }

  if (!authKeyListenerAttached) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeAuthModal();
      }
    });
    authKeyListenerAttached = true;
  }

  switchAuthMode('login');
  updateAuthUI();
}

function updateStatus(helper, message, type) {
  if (!helper) return;
  helper.textContent = message;
  helper.classList.remove('is-success', 'is-error');
  if (type === 'success') {
    helper.classList.add('is-success');
  } else if (type === 'error') {
    helper.classList.add('is-error');
  }
}

function initialiseEmailForms() {
  const forms = document.querySelectorAll('.email-form');
  forms.forEach((form) => {
    if (form.dataset.initialised === 'true') return;
    form.dataset.initialised = 'true';

    const helper = form.querySelector('.form-helper');
    const emailInput = form.querySelector('input[type="email"]');
    const endpoint = form.dataset.endpoint || 'https://formsubmit.co/ajax/romulus@eurocarsummer.com';

    if (helper) {
      helper.setAttribute('role', 'status');
      helper.setAttribute('aria-live', 'polite');
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!emailInput || !emailInput.value) {
        updateStatus(helper, 'Inserisci un indirizzo email valido.', 'error');
        return;
      }

      const emailValue = emailInput.value.trim();
      if (!emailValue) {
        updateStatus(helper, 'Inserisci un indirizzo email valido.', 'error');
        return;
      }

      form.classList.add('is-submitting');
      updateStatus(helper, 'Invio in corso…', null);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            email: emailValue,
            _subject: 'Nuova richiesta Euro Car Summer',
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || 'Richiesta non riuscita.');
        }

        updateStatus(helper, 'Grazie! Ti contatteremo presto.', 'success');
        form.reset();
      } catch (error) {
        updateStatus(
          helper,
          'Si è verificato un problema con l\'invio. Riprova tra poco.',
          'error',
        );
      } finally {
        form.classList.remove('is-submitting');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  ensureSiteHeader();
  ensureEmailBanner();
  initialiseEmailForms();
  initialiseAuthSystem();
});
