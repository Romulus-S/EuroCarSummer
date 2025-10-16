function slugifyPath(pathname) {
  if (!pathname) return 'home';
  const parts = pathname.split('/');
  const leaf = parts.pop() || parts.pop() || 'index.html';
  const base = leaf.replace(/\.html?$/i, '') || 'index';
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'home';
}

const ADMIN_EMAIL = 'romulus@eurocarsummer.com';

const FIREBASE_SCRIPT_SOURCES = [
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js',
];

const loadedScriptPromises = new Map();
let firebaseConfigPromise = null;
let firebaseInitPromise = null;
let firebaseServices = null;
let firebaseActiveUser = null;
let firebaseObserverAttached = false;
const authSubscribers = [];

function loadExternalScript(src) {
  if (!src) return Promise.reject(new Error('Missing script source'));
  if (loadedScriptPromises.has(src)) {
    return loadedScriptPromises.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    const existing = Array.from(document.getElementsByTagName('script')).find(
      (script) => script.src === src,
    );
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (event) => reject(event));
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', (event) => {
      reject(event);
    });
    document.head.appendChild(script);
  });

  loadedScriptPromises.set(src, promise);
  return promise;
}

function hasFirebaseConfig(config) {
  if (!config || typeof config !== 'object') return false;
  const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
  return requiredKeys.every((key) => typeof config[key] === 'string' && config[key].trim());
}

async function loadFirebaseConfig() {
  if (firebaseConfigPromise) {
    return firebaseConfigPromise;
  }

  if (window && window.ECS_FIREBASE_CONFIG && hasFirebaseConfig(window.ECS_FIREBASE_CONFIG)) {
    firebaseConfigPromise = Promise.resolve(window.ECS_FIREBASE_CONFIG);
    return firebaseConfigPromise;
  }

  firebaseConfigPromise = fetch('firebase-config.json', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) return null;
      return response.json().catch(() => null);
    })
    .then((config) => {
      if (hasFirebaseConfig(config)) {
        return config;
      }
      return null;
    })
    .catch(() => null);

  return firebaseConfigPromise;
}

async function prepareFirebase() {
  if (firebaseInitPromise) {
    return firebaseInitPromise;
  }

  firebaseInitPromise = (async () => {
    const config = await loadFirebaseConfig();
    if (!config) {
      return null;
    }

    for (const src of FIREBASE_SCRIPT_SOURCES) {
      // eslint-disable-next-line no-await-in-loop
      await loadExternalScript(src);
    }

    if (!window.firebase || !window.firebase.apps) {
      return null;
    }

    const app = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(config);
    const auth = window.firebase.auth();
    const db = window.firebase.firestore();

    firebaseServices = { config, app, auth, db };
    return firebaseServices;
  })().catch((error) => {
    console.error('Failed to initialise Firebase', error);
    return null;
  });

  return firebaseInitPromise;
}

function notifyAuthSubscribers(user) {
  authSubscribers.forEach((listener) => {
    try {
      listener(user || null);
    } catch (error) {
      console.error('Auth subscriber failed', error);
    }
  });
}

function subscribeToAuthChanges(listener) {
  if (typeof listener !== 'function') return;
  authSubscribers.push(listener);
  listener(firebaseActiveUser || null);
}

function getServerTimestamp() {
  try {
    const firestore = window.firebase && window.firebase.firestore;
    if (firestore && firestore.FieldValue && typeof firestore.FieldValue.serverTimestamp === 'function') {
      return firestore.FieldValue.serverTimestamp();
    }
  } catch (error) {
    // ignore lookup failures
  }
  return new Date().toISOString();
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
@@ -46,79 +194,81 @@ function ensureEmailBanner() {

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
          <a href="admin.html" class="admin-link" hidden>Admin</a>
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
    { href: 'admin.html', match: (value) => value === 'admin.html' },
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
@@ -217,50 +367,104 @@ async function hashPassword(password) {
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

function mapFirebaseUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: normaliseEmail(user.email),
    displayName: user.displayName || '',
    emailVerified: !!user.emailVerified,
    isFirebase: true,
  };
}

async function ensureUserDocument(services, user, overrides = {}) {
  if (!services || !services.db || !user) return null;
  try {
    const docRef = services.db.collection('users').doc(user.uid);
    const snapshot = await docRef.get();
    const basePayload = {
      email: normaliseEmail(user.email),
      displayName: user.displayName || deriveNameFromEmail(user.email),
      emailVerified: !!user.emailVerified,
      role: normaliseEmail(user.email) === ADMIN_EMAIL ? 'admin' : 'member',
      updatedAt: getServerTimestamp(),
      ...overrides,
    };

    if (snapshot.exists) {
      await docRef.set(basePayload, { merge: true });
    } else {
      await docRef.set({
        createdAt: getServerTimestamp(),
        ...basePayload,
      });
    }
    return docRef;
  } catch (error) {
    console.error('Failed to persist user document', error);
    return null;
  }
}

async function sendVerificationEmail(user) {
  if (!user || typeof user.sendEmailVerification !== 'function') return;
  const currentOrigin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
  const continueUrl = `${currentOrigin.replace(/\/$/, '')}/verify.html`;
  try {
    await user.sendEmailVerification({ url: continueUrl });
  } catch (error) {
    console.warn('Verification email with custom URL failed, falling back to default link.', error);
    await user.sendEmailVerification().catch((innerError) => {
      console.error('Unable to send verification email', innerError);
    });
  }
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
@@ -376,230 +580,335 @@ function closeAuthModal() {
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

  try {
    const services = await prepareFirebase();
    if (!services || !services.auth) {
      showAuthMessage(
        form,
        'Il sistema di autenticazione non è disponibile. Riprovare tra qualche istante.',
        'error',
      );
      return;
    }

    showAuthMessage(form, 'Accesso in corso…', null);
    const credentials = await services.auth.signInWithEmailAndPassword(emailValue, passwordValue);
    const user = credentials.user;
    if (!user) {
      showAuthMessage(form, 'Impossibile completare l\'accesso. Riprova.', 'error');
      return;
    }

    await user.reload();
    if (!user.emailVerified) {
      await sendVerificationEmail(user);
      await services.auth.signOut();
      showAuthMessage(
        form,
        'Abbiamo inviato una nuova email di conferma. Verifica il tuo indirizzo prima di accedere.',
        'error',
      );
      return;
    }

    await ensureUserDocument(services, user, {
      emailVerified: true,
      lastLoginAt: getServerTimestamp(),
    });

    showAuthMessage(form, 'Accesso effettuato, bentornato!', 'success');
    form.reset();
    window.setTimeout(() => {
      closeAuthModal();
    }, 400);
  } catch (error) {
    const code = error && error.code ? String(error.code) : '';
    let message = 'Impossibile verificare le credenziali. Riprova.';
    if (code === 'auth/user-not-found') {
      message = 'Nessun account trovato per questa email.';
      if (emailInput) emailInput.focus();
    } else if (code === 'auth/wrong-password') {
      message = 'Password non corretta. Riprova.';
      if (passwordInput) passwordInput.focus();
    } else if (code === 'auth/too-many-requests') {
      message = 'Troppi tentativi di accesso. Attendi qualche minuto e riprova.';
    } else if (code === 'auth/network-request-failed') {
      message = 'Connessione assente o instabile. Controlla la rete e riprova.';
    }
    showAuthMessage(form, message, 'error');
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const nameInput = form.querySelector('input[name="register-name"]');
  const emailInput = form.querySelector('input[name="register-email"]');
  const passwordInput = form.querySelector('input[name="register-password"]');
  const confirmInput = form.querySelector('input[name="register-confirm"]');

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

  try {
    const services = await prepareFirebase();
    if (!services || !services.auth) {
      showAuthMessage(
        form,
        'Il sistema di registrazione non è disponibile al momento. Riprova più tardi.',
        'error',
      );
      return;
    }

    showAuthMessage(form, 'Creazione account in corso…', null);
    const credentials = await services.auth.createUserWithEmailAndPassword(emailValue, passwordValue);
    const user = credentials.user;
    if (!user) {
      showAuthMessage(form, 'Registrazione non riuscita. Riprova.', 'error');
      return;
    }

    const displayName = nameInput ? nameInput.value.trim() : '';
    if (displayName) {
      await user.updateProfile({ displayName });
    }

    await ensureUserDocument(services, user, {
      displayName: displayName || deriveNameFromEmail(user.email),
      emailVerified: false,
    });
    await sendVerificationEmail(user);

    showAuthMessage(
      form,
      'Registrazione completata! Controlla la posta e conferma il tuo indirizzo per accedere.',
      'success',
    );

    form.reset();

    window.setTimeout(() => {
      switchAuthMode('login');
      focusAuthField('login');
    }, 400);

    await services.auth.signOut();
  } catch (error) {
    const code = error && error.code ? String(error.code) : '';
    let message = 'Impossibile completare la registrazione. Riprova.';
    if (code === 'auth/email-already-in-use') {
      message = 'Esiste già un account con questa email.';
      if (emailInput) emailInput.focus();
    } else if (code === 'auth/weak-password') {
      message = 'La password scelta è troppo debole. Usa una combinazione più sicura.';
      if (passwordInput) passwordInput.focus();
    } else if (code === 'auth/invalid-email') {
      message = 'L\'indirizzo email non è valido.';
      if (emailInput) emailInput.focus();
    } else if (code === 'auth/network-request-failed') {
      message = 'Connessione assente o instabile. Controlla la rete e riprova.';
    }
    showAuthMessage(form, message, 'error');
  }
}

function handleLogout(event) {
  if (event) {
    event.preventDefault();
  }

  const completeSignOut = () => {
    clearSession();
    firebaseActiveUser = null;
    updateAuthUI();
    notifyAuthSubscribers(null);
  };

  const signOutFirebase = () => {
    if (firebaseServices && firebaseServices.auth) {
      firebaseServices.auth
        .signOut()
        .then(() => {
          completeSignOut();
        })
        .catch((error) => {
          console.error('Errore durante il logout', error);
          completeSignOut();
        });
      return true;
    }
    return false;
  };

  if (!signOutFirebase()) {
    prepareFirebase()
      .then(() => {
        if (!signOutFirebase()) {
          completeSignOut();
        }
      })
      .catch(() => {
        completeSignOut();
      });
  }
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
  const adminLink = header.querySelector('nav .admin-link');

  const hasFirebase = !!(firebaseServices && firebaseServices.auth);
  const canUseLocal = hasFirebase ? !!authStorage : false;
  const canAuthenticate = hasFirebase || canUseLocal;

  if (!canAuthenticate) {
    if (trigger) {
      trigger.disabled = true;
      trigger.textContent = 'Accesso non disponibile';
      trigger.hidden = false;
    }
    if (userInfo) {
      userInfo.hidden = true;
    }
    if (logoutButton) {
      logoutButton.disabled = true;
    }
    if (adminLink) {
      adminLink.hidden = true;
    }
    return;
  }

  const localUser = canUseLocal ? getCurrentUser() : null;
  const user = firebaseActiveUser || localUser;

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

  if (adminLink) {
    const isAdmin = !!(user && normaliseEmail(user.email) === ADMIN_EMAIL);
    adminLink.hidden = !isAdmin;
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
@@ -622,50 +931,79 @@ function initialiseAuthSystem() {

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

  prepareFirebase()
    .then((services) => {
      if (services && services.auth) {
        firebaseServices = services;
        if (!firebaseObserverAttached) {
          firebaseObserverAttached = true;
          services.auth.onAuthStateChanged(async (user) => {
            firebaseActiveUser = mapFirebaseUser(user);
            updateAuthUI();
            notifyAuthSubscribers(firebaseActiveUser);

            if (user) {
              await ensureUserDocument(services, user, {
                emailVerified: !!user.emailVerified,
                lastSeenAt: getServerTimestamp(),
              });
            }
          });
        } else {
          updateAuthUI();
        }
      } else {
        updateAuthUI();
      }
    })
    .catch(() => {
      updateAuthUI();
    });
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
@@ -700,31 +1038,150 @@ function initialiseEmailForms() {
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

function initialiseAdminDashboard() {
  const dashboard = document.querySelector('.admin-dashboard');
  if (!dashboard || dashboard.dataset.initialised === 'true') return;
  dashboard.dataset.initialised = 'true';

  const statusEl = dashboard.querySelector('.admin-status');
  const table = dashboard.querySelector('.admin-table');
  const tbody = table ? table.querySelector('tbody') : null;
  const refreshButton = dashboard.querySelector('.admin-refresh');

  const setStatus = (message, type) => {
    if (!statusEl) return;
    statusEl.textContent = message;
    if (type) {
      statusEl.dataset.state = type;
    } else if (statusEl.dataset) {
      delete statusEl.dataset.state;
    }
  };

  const toggleTable = (visible) => {
    if (table) {
      table.hidden = !visible;
    }
  };

  let currentAdminUser = null;

  const renderAccounts = async (showLoading = true) => {
    const services = await prepareFirebase();
    if (!services || !services.db) {
      setStatus('Configura Firebase per attivare la dashboard amministratore.', 'error');
      toggleTable(false);
      return;
    }

    if (!currentAdminUser || normaliseEmail(currentAdminUser.email) !== ADMIN_EMAIL) {
      toggleTable(false);
      return;
    }

    if (showLoading) {
      setStatus('Caricamento account…', 'loading');
    }

    try {
      const snapshot = await services.db.collection('users').orderBy('createdAt', 'desc').get();
      if (!tbody) return;

      tbody.innerHTML = '';

      if (snapshot.empty) {
        toggleTable(false);
        setStatus('Nessun account registrato finora.', 'info');
        return;
      }

      const formatDate = (value) => {
        if (!value) return '—';
        try {
          if (value.toDate) {
            return value.toDate().toLocaleString();
          }
          return new Date(value).toLocaleString();
        } catch (error) {
          return '—';
        }
      };

      snapshot.forEach((doc) => {
        const data = doc.data() || {};
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${data.displayName || '—'}</td>
          <td>${data.email || '—'}</td>
          <td>${data.role || 'member'}</td>
          <td>${data.emailVerified ? '✔️' : '—'}</td>
          <td>${formatDate(data.createdAt)}</td>
          <td>${formatDate(data.lastSeenAt || data.updatedAt)}</td>
        `;
        tbody.appendChild(row);
      });

      toggleTable(true);
      setStatus(`Account totali: ${snapshot.size}`, 'success');
    } catch (error) {
      console.error('Impossibile caricare gli account', error);
      toggleTable(false);
      setStatus('Impossibile caricare gli account. Riprova più tardi.', 'error');
    }
  };

  if (refreshButton && refreshButton.dataset.initialised !== 'true') {
    refreshButton.addEventListener('click', (event) => {
      event.preventDefault();
      renderAccounts();
    });
    refreshButton.dataset.initialised = 'true';
  }

  subscribeToAuthChanges((user) => {
    currentAdminUser = user;
    if (!user) {
      toggleTable(false);
      setStatus('Accedi con l\'account amministratore per consultare gli utenti.', 'info');
      return;
    }

    if (normaliseEmail(user.email) !== ADMIN_EMAIL) {
      toggleTable(false);
      setStatus('Questo pannello è riservato a Romulus (romulus@eurocarsummer.com).', 'error');
      return;
    }

    renderAccounts();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  ensureSiteHeader();
  ensureEmailBanner();
  initialiseEmailForms();
  initialiseAuthSystem();
  initialiseAdminDashboard();
});
