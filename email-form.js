function slugifyPath(pathname) {
  if (!pathname) return 'home';
  const parts = pathname.split('/');
  const leaf = parts.pop() || parts.pop() || 'index.html';
  const base = leaf.replace(/\.html?$/i, '') || 'index';
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'home';
}

const ADMIN_EMAIL = 'romulus@eurocarsummer.com';
const DATE_FILENAME_PATTERN = /^(\d{1,2})[-_](\d{1,2})[-_](\d{2})\.html$/i;
const DATE_PAGE_PATTERN = DATE_FILENAME_PATTERN;

const commentState = {
  initialised: false,
  postId: null,
  section: null,
  list: null,
  count: null,
  empty: null,
  helper: null,
  helperDefault: '',
  form: null,
  textarea: null,
  nameInput: null,
  emailInput: null,
  formGrid: null,
  status: null,
  callout: null,
  loading: null,
  services: null,
  unsubscribe: null,
  currentUser: null,
  useLocal: false,
  localComments: [],
};

const LOCAL_COMMENT_KEY_PREFIX = 'ecsComments:';

let chromeBootstrapped = false;
let chromeBootstrapScheduled = false;

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

const SITE_CONFIG_PATH = 'site-config.json';
const POST_CACHE_STORAGE_KEY = 'ecsPostManifest';
const POST_CACHE_VERSION = 'v1';
const POST_FILENAME_PATTERN = DATE_FILENAME_PATTERN;
const SITEMAP_PATH = 'sitemap.xml';

let siteConfigPromise = null;

function getLocalCommentKey(postId) {
  if (!postId) return `${LOCAL_COMMENT_KEY_PREFIX}unknown`;
  return `${LOCAL_COMMENT_KEY_PREFIX}${postId}`;
}

function loadLocalComments(postId) {
  if (!authStorage) return [];
  try {
    const raw = authStorage.getItem(getLocalCommentKey(postId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .sort((a, b) => {
        const timeA = new Date((a && a.createdAt) || 0).getTime();
        const timeB = new Date((b && b.createdAt) || 0).getTime();
        return timeB - timeA;
      });
  } catch (error) {
    return [];
  }
}

function saveLocalComments(postId, comments) {
  if (!authStorage) return;
  try {
    authStorage.setItem(getLocalCommentKey(postId), JSON.stringify(Array.isArray(comments) ? comments : []));
  } catch (error) {
    // ignore storage errors
  }
}

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

function cleanFirebaseConfigValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/INSERISCI|il-tuo-progetto/i.test(trimmed)) return '';
    return trimmed;
  }
  if (typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

function hasFirebaseConfig(config) {
  if (!config || typeof config !== 'object') return false;
  const apiKey = cleanFirebaseConfigValue(config.apiKey);
  const projectId = cleanFirebaseConfigValue(config.projectId);
  return Boolean(apiKey && projectId);
}

function hasSiteConfig(config) {
  if (!config || typeof config !== 'object') return false;
  if (!config.githubOwner || !config.githubRepo) return false;
  if (typeof config.githubOwner !== 'string' || typeof config.githubRepo !== 'string') return false;
  return true;
}

function normaliseFirebaseConfig(rawConfig) {
  if (!hasFirebaseConfig(rawConfig)) {
    return null;
  }

  const config = { ...rawConfig };
  config.apiKey = cleanFirebaseConfigValue(rawConfig.apiKey);
  config.projectId = cleanFirebaseConfigValue(rawConfig.projectId);

  const derivedAuthDomain = `${config.projectId}.firebaseapp.com`;
  const authDomain = cleanFirebaseConfigValue(rawConfig.authDomain);
  config.authDomain = authDomain || derivedAuthDomain;

  const derivedBucket = `${config.projectId}.appspot.com`;
  const storageBucket = cleanFirebaseConfigValue(rawConfig.storageBucket);
  if (storageBucket) {
    config.storageBucket = storageBucket;
  } else {
    config.storageBucket = derivedBucket;
  }

  const senderId = cleanFirebaseConfigValue(rawConfig.messagingSenderId)
    || cleanFirebaseConfigValue(rawConfig.projectNumber);
  if (senderId) {
    config.messagingSenderId = senderId;
  } else {
    delete config.messagingSenderId;
  }

  const appId = cleanFirebaseConfigValue(rawConfig.appId);
  if (appId) {
    config.appId = appId;
  } else {
    delete config.appId;
  }

  const measurementId = cleanFirebaseConfigValue(rawConfig.measurementId);
  if (measurementId) {
    config.measurementId = measurementId;
  } else {
    delete config.measurementId;
  }

  return config;
}

async function loadFirebaseConfig() {
  if (firebaseConfigPromise) {
    return firebaseConfigPromise;
  }

  if (window && window.ECS_FIREBASE_CONFIG) {
    const inlineConfig = normaliseFirebaseConfig(window.ECS_FIREBASE_CONFIG);
    if (inlineConfig) {
      firebaseConfigPromise = Promise.resolve(inlineConfig);
      return firebaseConfigPromise;
    }
  }

  firebaseConfigPromise = fetch('firebase-config.json', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) return null;
      return response.json().catch(() => null);
    })
    .then((config) => {
      const normalised = normaliseFirebaseConfig(config);
      if (normalised) {
        return normalised;
      }
      return null;
    })
    .catch(() => null);

  return firebaseConfigPromise;
}

async function loadSiteConfig() {
  if (siteConfigPromise) {
    return siteConfigPromise;
  }

  if (window && window.ECS_SITE_CONFIG && hasSiteConfig(window.ECS_SITE_CONFIG)) {
    siteConfigPromise = Promise.resolve(window.ECS_SITE_CONFIG);
    return siteConfigPromise;
  }

  siteConfigPromise = fetch(SITE_CONFIG_PATH, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) return null;
      return response.json().catch(() => null);
    })
    .then((config) => {
      if (hasSiteConfig(config)) {
        return config;
      }
      return null;
    })
    .catch(() => null);

  return siteConfigPromise;
}

function getPostCacheKey() {
  return `${POST_CACHE_STORAGE_KEY}:${POST_CACHE_VERSION}`;
}

function readPostCache() {
  if (!authStorage) return null;
  try {
    const raw = authStorage.getItem(getPostCacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      authStorage.removeItem(getPostCacheKey());
      return null;
    }
    if (!Array.isArray(parsed.posts)) return null;
    return parsed.posts;
  } catch (error) {
    return null;
  }
}

function writePostCache(posts, ttlMinutes) {
  if (!authStorage) return;
  try {
    const payload = {
      posts: Array.isArray(posts) ? posts : [],
    };
    if (ttlMinutes && Number.isFinite(ttlMinutes)) {
      payload.expiresAt = Date.now() + ttlMinutes * 60 * 1000;
    }
    authStorage.setItem(getPostCacheKey(), JSON.stringify(payload));
  } catch (error) {
    // ignore storage failures
  }
}

function normaliseAssetPath(src) {
  if (!src || typeof src !== 'string') return '';
  const trimmed = src.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('./')) return trimmed.slice(2);
  if (trimmed.startsWith('/')) return trimmed.replace(/^\/+/, '');
  return trimmed;
}

function stripDomainFromUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return url.pathname.replace(/^\/+/, '');
  } catch (error) {
    return String(value).replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
  }
}

function getFilenameFromPath(path) {
  if (!path) return '';
  const clean = stripDomainFromUrl(path).split('?')[0].split('#')[0];
  const parts = clean.split('/');
  return parts.pop() || clean;
}

function extractPostMetadataFromDocument(doc, path, fallbackTitle) {
  if (!doc) return null;
  const main = doc.querySelector('.post-detail') || doc.body || doc;
  const titleEl = main.querySelector('h1') || doc.querySelector('title');
  const timeEl = main.querySelector('time');
  const emphasisEl = !timeEl ? main.querySelector('em') : null;
  const imageEl = main.querySelector('img');

  const filename = getFilenameFromPath(path);
  const title = titleEl ? titleEl.textContent.trim() : (fallbackTitle || filename.replace(/\.html?$/i, ''));
  const rawDate = timeEl ? timeEl.textContent.trim() : emphasisEl ? emphasisEl.textContent.trim() : '';
  const fallbackDate = formatDateFromFilename(filename);
  const displayDate = rawDate || fallbackDate;

  const parsedDate = parseDateFromFilename(filename);
  const isoDate = parsedDate ? parsedDate.toISOString() : null;

  let imageSrc = imageEl ? imageEl.getAttribute('src') : '';
  if (!imageSrc && imageEl && imageEl.src) {
    imageSrc = imageEl.src;
  }
  imageSrc = normaliseAssetPath(imageSrc);
  const imageAlt = imageEl ? (imageEl.getAttribute('alt') || title) : title;

  const href = stripDomainFromUrl(path);

  return {
    slug: filename.replace(/\.html?$/i, ''),
    href,
    title,
    dateText: displayDate,
    imageSrc,
    imageAlt,
    isoDate,
  };
}

function escapeHtml(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseDateFromFilename(filename) {
  const match = DATE_FILENAME_PATTERN.exec(filename || '');
  if (!match) return null;
  const [, monthRaw, dayRaw, yearRaw] = match;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  if (Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(year)) {
    return null;
  }
  const fullYear = year + 2000;
  const date = new Date(Date.UTC(fullYear, month - 1, day, 12, 0, 0));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatDateFromFilename(filename) {
  const date = parseDateFromFilename(filename);
  if (!date) return '';
  return date.toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

async function fetchPostsFromSitemap() {
  const response = await fetch(SITEMAP_PATH, { cache: 'no-store' });
  if (!response || !response.ok) {
    throw new Error(`Sitemap non disponibile (${response ? response.status : 'nessuna risposta'})`);
  }

  const xml = await response.text();
  if (!xml) {
    throw new Error('Sitemap vuota.');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (!doc || doc.getElementsByTagName('parsererror').length) {
    throw new Error('Formato sitemap non valido.');
  }

  const locNodes = Array.from(doc.getElementsByTagName('loc'));
  const paths = Array.from(new Set(locNodes.map((node) => stripDomainFromUrl(node.textContent || ''))))
    .filter((path) => POST_FILENAME_PATTERN.test(getFilenameFromPath(path)));

  if (!paths.length) {
    return [];
  }

  paths.sort((a, b) => {
    const fileA = getFilenameFromPath(a);
    const fileB = getFilenameFromPath(b);
    const dateA = parseDateFromFilename(fileA);
    const dateB = parseDateFromFilename(fileB);
    const timeA = dateA ? dateA.getTime() : 0;
    const timeB = dateB ? dateB.getTime() : 0;
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    return fileB.localeCompare(fileA);
  });

  const htmlParser = new DOMParser();
  const posts = [];

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    const requestPath = `/${stripDomainFromUrl(path)}`;
    try {
      const pageResponse = await fetch(requestPath, { cache: 'no-store' });
      if (!pageResponse || !pageResponse.ok) {
        throw new Error(`Pagina ${requestPath} non raggiungibile (${pageResponse ? pageResponse.status : 'nessuna risposta'})`);
      }
      const html = await pageResponse.text();
      const docHtml = htmlParser.parseFromString(html, 'text/html');
      const metadata = extractPostMetadataFromDocument(docHtml, path);
      if (metadata) {
        posts.push({ ...metadata, order: index });
      }
    } catch (error) {
      console.error('Impossibile estrarre i dati dalla sitemap per', path, error);
    }
  }

  posts.sort((a, b) => {
    const timeA = a.isoDate ? new Date(a.isoDate).getTime() : 0;
    const timeB = b.isoDate ? new Date(b.isoDate).getTime() : 0;
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order;
    }
    return (b.title || '').localeCompare(a.title || '');
  });

  posts.forEach((post) => {
    if (Object.prototype.hasOwnProperty.call(post, 'order')) {
      delete post.order;
    }
  });

  return posts;
}

async function fetchPostsFromGitHub(config) {
  if (!config) {
    throw new Error('Configurazione GitHub non disponibile.');
  }

  const owner = config.githubOwner.trim();
  const repo = config.githubRepo.trim();
  const branch = (config.githubBranch && config.githubBranch.trim()) || 'main';

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(branch)}`;

  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ha risposto con lo stato ${response.status}`);
  }

  const entries = await response.json();
  if (!Array.isArray(entries)) {
    throw new Error('Formato risposta inatteso per i contenuti del repository');
  }

  const postFilenames = entries
    .filter((entry) => entry && entry.type === 'file' && POST_FILENAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const dateA = parseDateFromFilename(a);
      const dateB = parseDateFromFilename(b);
      const timeA = dateA ? dateA.getTime() : 0;
      const timeB = dateB ? dateB.getTime() : 0;
      return timeB - timeA;
    });

  const parser = new DOMParser();

  const posts = (await Promise.all(postFilenames.map(async (filename, index) => {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${filename}`;
      const pageResponse = await fetch(rawUrl, {
        headers: {
          Accept: 'text/html',
        },
      });
      if (!pageResponse.ok) {
        throw new Error(`Pagina ${filename} non raggiungibile (${pageResponse.status})`);
      }

      const html = await pageResponse.text();
      const doc = parser.parseFromString(html, 'text/html');
      const metadata = extractPostMetadataFromDocument(doc, filename);
      if (!metadata) {
        return null;
      }
      return {
        ...metadata,
        order: index,
      };
    } catch (error) {
      console.error('Impossibile estrarre i dati da', filename, error);
      return null;
    }
  }))).filter(Boolean);

  posts.sort((a, b) => {
    const timeA = a.isoDate ? new Date(a.isoDate).getTime() : 0;
    const timeB = b.isoDate ? new Date(b.isoDate).getTime() : 0;
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order;
    }
    return (b.title || '').localeCompare(a.title || '');
  });

  posts.forEach((post) => {
    if (Object.prototype.hasOwnProperty.call(post, 'order')) {
      delete post.order;
    }
  });

  return posts;
}

async function fetchPostManifest() {
  const cached = readPostCache();
  if (cached && cached.length) {
    return cached;
  }

  const config = await loadSiteConfig();
  const ttlValue = config ? Number(config.postsCacheTtlMinutes) : NaN;
  const ttl = Number.isFinite(ttlValue) ? ttlValue : 30;

  try {
    const sitemapPosts = await fetchPostsFromSitemap();
    if (sitemapPosts && sitemapPosts.length) {
      writePostCache(sitemapPosts, ttl);
      return sitemapPosts;
    }
  } catch (error) {
    console.error('Impossibile utilizzare la sitemap per il manifesto', error);
  }

  if (config) {
    try {
      const githubPosts = await fetchPostsFromGitHub(config);
      if (githubPosts && githubPosts.length) {
        writePostCache(githubPosts, ttl);
        return githubPosts;
      }
    } catch (error) {
      console.error('Errore durante il caricamento del manifesto dei post', error);
    }
  }

  if (cached && cached.length) {
    return cached;
  }

  throw new Error('Impossibile recuperare le Macchine del Giorno automaticamente.');
}

function clearPostPlaceholders(container) {
  if (!container) return;
  container.querySelectorAll('[data-placeholder]').forEach((node) => {
    node.remove();
  });
}

function createPostCard(post, headingLevel) {
  const li = document.createElement('li');
  li.className = 'post-card';

  const link = document.createElement('a');
  link.href = post.href || '#';

  const titleTag = headingLevel || 'h3';
  const title = document.createElement(titleTag);
  title.className = 'post-title';
  title.textContent = post.title || 'Titolo non disponibile';

  const thumb = document.createElement('div');
  thumb.className = 'post-thumbnail';

  if (post.imageSrc) {
    const img = document.createElement('img');
    img.src = post.imageSrc;
    img.alt = post.imageAlt || post.title || '';
    img.loading = 'lazy';
    thumb.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.textContent = 'Immagine non disponibile';
    placeholder.style.padding = '2rem 1rem';
    placeholder.style.textAlign = 'center';
    placeholder.style.color = 'rgba(27, 79, 163, 0.6)';
    thumb.appendChild(placeholder);
  }

  const date = document.createElement('p');
  date.className = 'post-date';
  date.textContent = post.dateText || '';

  link.appendChild(title);
  link.appendChild(thumb);
  link.appendChild(date);
  li.appendChild(link);

  return li;
}

function renderArchiveGallery(posts, options = {}) {
  const container = document.querySelector('[data-archive-gallery]');
  if (!container) return;

  clearPostPlaceholders(container);
  container.innerHTML = '';

  if (!posts || !posts.length) {
    const { state, message } = options;
    const empty = document.createElement('li');
    empty.className = 'post-card is-status';
    if (state === 'error') {
      empty.classList.add('is-error');
    }
    const text = state === 'error'
      ? (message || 'Impossibile caricare le Macchine del Giorno. Riprova più tardi.')
      : 'Nessuna Macchina del Giorno disponibile al momento.';
    empty.innerHTML = `<p class="post-date">${escapeHtml(text)}</p>`;
    container.appendChild(empty);
    return;
  }

  posts.forEach((post) => {
    container.appendChild(createPostCard(post, 'h2'));
  });
}

function renderHomeSampler(posts, options = {}) {
  const container = document.querySelector('[data-home-macchina]');
  if (!container) return;

  clearPostPlaceholders(container);
  container.innerHTML = '';

  if (!posts || !posts.length) {
    const { state, message } = options;
    const empty = document.createElement('li');
    empty.className = 'post-card is-status';
    if (state === 'error') {
      empty.classList.add('is-error');
    }
    const text = state === 'error'
      ? (message || 'Non è stato possibile recuperare le ultime auto in evidenza.')
      : 'Aggiungi una nuova pagina per vedere qui le ultime tre auto.';
    empty.innerHTML = `<p class="post-date">${escapeHtml(text)}</p>`;
    container.appendChild(empty);
    return;
  }

  posts.slice(0, 3).forEach((post) => {
    container.appendChild(createPostCard(post, 'h3'));
  });
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
  ensureSiteHeader();

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
      trigger.disabled = false;
      trigger.hidden = false;
      trigger.textContent = 'Accedi / Registrati';
      trigger.setAttribute(
        'title',
        'Configura Firebase per abilitare la registrazione e il login.',
      );
    }
    if (userInfo) {
      userInfo.hidden = true;
    }
    if (nameTarget) {
      nameTarget.textContent = '';
    }
    if (logoutButton) {
      logoutButton.disabled = true;
      logoutButton.hidden = true;
    }
    if (adminLink) {
      adminLink.hidden = true;
    }
    return;
  }

  if (trigger) {
    trigger.removeAttribute('title');
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
      logoutButton.hidden = false;
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
      logoutButton.hidden = true;
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

function initialiseAdminDashboard() {
  const dashboard = document.querySelector('.admin-dashboard');
  if (!dashboard || dashboard.dataset.initialised === 'true') return;
  dashboard.dataset.initialised = 'true';

  const statusEl = dashboard.querySelector('.admin-status');
  const table = dashboard.querySelector('.admin-table');
  const tbody = table ? table.querySelector('tbody') : null;
  const refreshButton = dashboard.querySelector('.admin-refresh');
  const helpPanel = dashboard.querySelector('.admin-help');

  const setStatus = (message, type) => {
    if (!statusEl) return;
    statusEl.textContent = message;
    if (type) {
      statusEl.dataset.state = type;
    } else if (statusEl.dataset) {
      delete statusEl.dataset.state;
    }
  };

  const showHelp = (visible) => {
    if (!helpPanel) return;
    helpPanel.hidden = !visible;
    if (!visible) {
      helpPanel.open = false;
      return;
    }
    helpPanel.open = true;
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
      showHelp(false);
      return;
    }

    if (!currentAdminUser || normaliseEmail(currentAdminUser.email) !== ADMIN_EMAIL) {
      toggleTable(false);
      showHelp(false);
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
      showHelp(false);
    } catch (error) {
      console.error('Impossibile caricare gli account', error);
      toggleTable(false);
      const code = error && error.code ? String(error.code).toLowerCase() : '';
      const message = error && error.message ? String(error.message) : '';

      if (code === 'permission-denied' || /missing or insufficient permissions/i.test(message)) {
        setStatus('Accesso negato. Aggiorna le regole di Firestore e riprova.', 'error');
        showHelp(true);
      } else if (code === 'failed-precondition' || /index/i.test(message)) {
        setStatus('Aggiungi un indice Firestore per ordinare gli utenti per data di creazione.', 'error');
        showHelp(false);
      } else if (code === 'unavailable') {
        setStatus('Firestore non è raggiungibile. Controlla la connessione e riprova.', 'error');
        showHelp(false);
      } else {
        const friendly = message || 'Impossibile caricare gli account. Riprova più tardi.';
        setStatus(friendly, 'error');
        showHelp(false);
      }
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
      showHelp(false);
      return;
    }

    if (normaliseEmail(user.email) !== ADMIN_EMAIL) {
      toggleTable(false);
      setStatus('Questo pannello è riservato a Romulus (romulus@eurocarsummer.com).', 'error');
      showHelp(false);
      return;
    }

    renderAccounts();
  });
}

function enforceLayoutFallbacks() {
  const galleries = document.querySelectorAll('.post-gallery');
  galleries.forEach((gallery) => {
    if (!gallery) return;
    const computed = window.getComputedStyle(gallery);
    const display = computed ? computed.display : '';
    if (display && (display.includes('grid') || display.includes('flex'))) {
      return;
    }

    gallery.style.display = 'grid';
    gallery.style.gridTemplateColumns = 'repeat(auto-fit, minmax(240px, 1fr))';
    gallery.style.gap = '1.75rem';
    gallery.style.listStyle = 'none';
    gallery.style.padding = '0';
    gallery.style.margin = '0';

    gallery.querySelectorAll('.post-card').forEach((card) => {
      card.style.margin = '0';
      const link = card.querySelector('a');
      if (!link) return;
      const linkStyle = window.getComputedStyle(link);
      const linkDisplay = linkStyle ? linkStyle.display : '';
      if (linkDisplay && linkDisplay.includes('flex')) {
        return;
      }
      link.style.display = 'flex';
      link.style.flexDirection = 'column';
      link.style.height = '100%';
    });
  });

  const auctionGrids = document.querySelectorAll('.auction-grid');
  auctionGrids.forEach((grid) => {
    if (!grid) return;
    const computed = window.getComputedStyle(grid);
    const display = computed ? computed.display : '';
    if (display && (display.includes('grid') || display.includes('flex'))) {
      return;
    }

    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(290px, 1fr))';
    grid.style.gap = '2rem';

    grid.querySelectorAll('.auction-card').forEach((card) => {
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
    });
  });
}

function initialisePostListings() {
  const archiveTarget = document.querySelector('[data-archive-gallery]');
  const homeTarget = document.querySelector('[data-home-macchina]');
  if (!archiveTarget && !homeTarget) {
    return;
  }

  fetchPostManifest()
    .then((posts) => {
      const list = Array.isArray(posts) ? posts : [];
      const state = list.length ? 'ready' : 'empty';
      if (archiveTarget) {
        renderArchiveGallery(list, { state });
      }
      if (homeTarget) {
        renderHomeSampler(list, { state });
      }
    })
    .catch((error) => {
      console.error('Impossibile inizializzare le liste delle macchine', error);
      const message = (error && error.message) ? error.message : 'Servizio temporaneamente non disponibile.';
      if (archiveTarget) {
        renderArchiveGallery([], { state: 'error', message });
      }
      if (homeTarget) {
        renderHomeSampler([], { state: 'error', message });
      }
    });
}

function initialiseDetailGallery() {
  const detail = document.querySelector('.post-detail');
  if (!detail || detail.dataset.galleryInitialised === 'true') {
    return;
  }

  const images = Array.from(detail.querySelectorAll('img')).filter((img) => {
    if (!img || !img.src) return false;
    if (img.closest('.post-gallery-viewer')) return false;
    if (img.closest('.comments-section')) return false;
    if (!detail.contains(img)) return false;
    return true;
  });

  if (images.length <= 1) {
    return;
  }

  const items = images
    .map((img) => ({
      src: img.getAttribute('src'),
      alt: img.getAttribute('alt') || detail.querySelector('h1')?.textContent || 'Foto della galleria',
    }))
    .filter((item) => !!item.src);

  if (items.length <= 1) {
    return;
  }

  const viewer = document.createElement('section');
  viewer.className = 'post-gallery-viewer';
  viewer.setAttribute('role', 'group');
  viewer.setAttribute('aria-label', 'Galleria immagini del post');
  viewer.tabIndex = 0;

  const main = document.createElement('div');
  main.className = 'gallery-main';

  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'gallery-nav gallery-nav-prev';
  prevButton.setAttribute('aria-label', 'Immagine precedente');
  prevButton.innerHTML = '&#10094;';

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'gallery-nav gallery-nav-next';
  nextButton.setAttribute('aria-label', 'Immagine successiva');
  nextButton.innerHTML = '&#10095;';

  const stage = document.createElement('div');
  stage.className = 'gallery-stage';

  const displayImg = document.createElement('img');
  displayImg.className = 'gallery-current';
  displayImg.decoding = 'async';
  displayImg.loading = 'lazy';

  stage.appendChild(displayImg);
  main.appendChild(prevButton);
  main.appendChild(stage);
  main.appendChild(nextButton);

  const counter = document.createElement('div');
  counter.className = 'gallery-counter';

  const fullscreenButton = document.createElement('button');
  fullscreenButton.type = 'button';
  fullscreenButton.className = 'gallery-fullscreen';
  fullscreenButton.setAttribute('aria-pressed', 'false');
  fullscreenButton.textContent = 'Schermo intero';

  const meta = document.createElement('div');
  meta.className = 'gallery-meta';
  meta.appendChild(counter);
  meta.appendChild(fullscreenButton);

  const thumbs = document.createElement('div');
  thumbs.className = 'gallery-thumbs';

  viewer.appendChild(main);
  viewer.appendChild(meta);
  viewer.appendChild(thumbs);

  const updateNavState = (index) => {
    prevButton.disabled = items.length <= 1;
    nextButton.disabled = items.length <= 1;
    if (items.length > 1) {
      prevButton.disabled = false;
      nextButton.disabled = false;
    }

    if (items.length <= 1) {
      return;
    }

    if (index <= 0) {
      prevButton.disabled = true;
    } else if (index >= items.length - 1) {
      nextButton.disabled = true;
    }
  };

  const thumbButtons = items.map((item, idx) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gallery-thumb';
    button.setAttribute('aria-label', `Mostra immagine ${idx + 1}`);

    const thumbImg = document.createElement('img');
    thumbImg.src = item.src;
    thumbImg.alt = item.alt;
    thumbImg.loading = 'lazy';
    thumbImg.decoding = 'async';

    button.appendChild(thumbImg);
    thumbs.appendChild(button);
    return button;
  });

  let currentIndex = 0;

  const render = (index) => {
    const safeIndex = Math.min(Math.max(index, 0), items.length - 1);
    const current = items[safeIndex];
    displayImg.src = current.src;
    displayImg.alt = current.alt;
    counter.textContent = `${safeIndex + 1} di ${items.length}`;
    currentIndex = safeIndex;

    thumbButtons.forEach((button, idx) => {
      if (idx === safeIndex) {
        button.classList.add('is-active');
        button.setAttribute('aria-current', 'true');
      } else {
        button.classList.remove('is-active');
        button.removeAttribute('aria-current');
      }
    });

    updateNavState(safeIndex);
  };

  prevButton.addEventListener('click', () => {
    render(currentIndex - 1);
  });

  nextButton.addEventListener('click', () => {
    render(currentIndex + 1);
  });

  const getFullscreenElement = () => document.fullscreenElement
    || document.webkitFullscreenElement
    || document.mozFullScreenElement
    || document.msFullscreenElement
    || null;

  const supportsNativeFullscreen = Boolean(
    viewer.requestFullscreen
      || viewer.webkitRequestFullscreen
      || viewer.mozRequestFullScreen
      || viewer.msRequestFullscreen,
  );

  const updateFullscreenButton = (isActive) => {
    fullscreenButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    fullscreenButton.textContent = isActive ? 'Chiudi schermo intero' : 'Schermo intero';
  };

  const enterNativeFullscreen = () => {
    if (viewer.requestFullscreen) return viewer.requestFullscreen();
    if (viewer.webkitRequestFullscreen) return viewer.webkitRequestFullscreen();
    if (viewer.mozRequestFullScreen) return viewer.mozRequestFullScreen();
    if (viewer.msRequestFullscreen) return viewer.msRequestFullscreen();
    return Promise.reject(new Error('Fullscreen API non supportata'));
  };

  const exitNativeFullscreen = () => {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    if (document.mozCancelFullScreen) return document.mozCancelFullScreen();
    if (document.msExitFullscreen) return document.msExitFullscreen();
    return Promise.reject(new Error('Fullscreen API non supportata'));
  };

  const toggleFullscreenClass = (active) => {
    viewer.classList.toggle('is-fullscreen', active);
    updateFullscreenButton(active);
    if (document.body) {
      if (active) {
        document.body.classList.add('gallery-scroll-lock');
      } else {
        document.body.classList.remove('gallery-scroll-lock');
      }
    }
  };

  const handleFullscreenChange = () => {
    const isActive = getFullscreenElement() === viewer;
    toggleFullscreenClass(isActive);
  };

  if (supportsNativeFullscreen) {
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
  }

  fullscreenButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (supportsNativeFullscreen) {
      if (getFullscreenElement() === viewer) {
        exitNativeFullscreen().catch(() => {
          toggleFullscreenClass(false);
        });
      } else {
        enterNativeFullscreen().catch(() => {
          toggleFullscreenClass(!viewer.classList.contains('is-fullscreen'));
        });
      }
    } else {
      const nextState = !viewer.classList.contains('is-fullscreen');
      toggleFullscreenClass(nextState);
    }
  });

  viewer.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      render(currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      render(currentIndex + 1);
    } else if (event.key === 'Escape' && viewer.classList.contains('is-fullscreen') && !supportsNativeFullscreen) {
      event.preventDefault();
      toggleFullscreenClass(false);
    }
  });

  thumbButtons.forEach((button, idx) => {
    button.addEventListener('click', () => {
      render(idx);
    });
  });

  const firstImage = images[0];
  if (firstImage && firstImage.parentNode) {
    firstImage.parentNode.insertBefore(viewer, firstImage);
  } else {
    detail.appendChild(viewer);
  }

  images.forEach((img) => {
    img.classList.add('gallery-source');
  });

  detail.classList.add('gallery-initialised');
  detail.dataset.galleryInitialised = 'true';

  render(0);
  toggleFullscreenClass(false);
}

function isDateDetailPage() {
  const pathname = window.location.pathname || '';
  const file = pathname.split('/').pop() || '';
  return DATE_PAGE_PATTERN.test(file);
}

function createCommentSection() {
  const template = document.createElement('template');
  template.innerHTML = `
    <section class="comments-section" aria-labelledby="comments-heading">
      <div class="comments-header">
        <h2 id="comments-heading">Commenti</h2>
        <span class="comment-count" aria-live="polite">0 commenti</span>
      </div>
      <p class="comments-helper">Condividi le tue impressioni su questa Macchina del Giorno.</p>
      <p class="comments-loading" role="status" aria-live="polite">Caricamento commenti…</p>
      <ul class="comment-list" hidden></ul>
      <p class="comments-empty" hidden>Sii il primo a commentare questa auto!</p>
      <div class="comment-auth-callout" hidden>
        <p><strong>Accedi</strong> o <strong>registrati</strong> per partecipare alla conversazione.</p>
        <div class="comment-auth-actions">
          <button type="button" class="comment-login">Accedi</button>
          <button type="button" class="comment-register">Registrati</button>
        </div>
      </div>
      <form class="comment-form" hidden>
        <div class="comment-form-grid">
          <label class="comment-field">
            Nome
            <input name="comment-name" type="text" placeholder="Il tuo nome (opzionale)">
          </label>
          <label class="comment-field">
            Email
            <input name="comment-email" type="email" placeholder="Email (non verrà pubblicata)">
          </label>
        </div>
        <label class="comment-field">
          Il tuo commento
          <textarea name="comment-body" rows="4" maxlength="1000" required placeholder="Che ne pensi di questa auto?"></textarea>
        </label>
        <p class="comment-status" role="status" aria-live="polite"></p>
        <button type="submit">Pubblica commento</button>
      </form>
    </section>
  `.trim();
  return template.content.firstElementChild;
}

function updateCommentBanner(message, state) {
  const target = commentState.loading;
  if (!target) return;
  if (!message) {
    target.textContent = '';
    target.hidden = true;
    if (target.dataset) {
      delete target.dataset.state;
    }
    return;
  }
  target.hidden = false;
  target.textContent = message;
  if (target.dataset) {
    if (state) {
      target.dataset.state = state;
    } else {
      delete target.dataset.state;
    }
  }
}

function setCommentCount(count) {
  if (!commentState.count) return;
  const safeCount = Number.isFinite(count) ? count : 0;
  const label = safeCount === 1 ? '1 commento' : `${safeCount} commenti`;
  commentState.count.textContent = label;
  commentState.count.setAttribute('data-count', String(safeCount));
}

function normaliseCommentDate(value) {
  if (!value) return null;
  try {
    if (typeof value.toDate === 'function') {
      const converted = value.toDate();
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return converted;
      }
    }
    if (typeof value === 'object' && typeof value.seconds === 'number') {
      const millis = value.seconds * 1000 + (value.nanoseconds ? value.nanoseconds / 1e6 : 0);
      const fromSeconds = new Date(millis);
      if (!Number.isNaN(fromSeconds.getTime())) {
        return fromSeconds;
      }
    }
    const fallback = new Date(value);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
  } catch (error) {
    // ignore parsing errors
  }
  return null;
}

function formatCommentDate(value) {
  const date = normaliseCommentDate(value);
  if (!date) {
    const now = new Date();
    return { text: 'Appena adesso', iso: now.toISOString() };
  }
  return {
    text: date.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }),
    iso: date.toISOString(),
  };
}

function renderCommentList(items) {
  if (!commentState.list || !commentState.empty) return;
  const comments = Array.isArray(items) ? items : [];
  commentState.list.innerHTML = '';
  const count = comments.length;
  setCommentCount(count);

  if (count === 0) {
    commentState.list.hidden = true;
    commentState.empty.hidden = false;
    return;
  }

  commentState.list.hidden = false;
  commentState.empty.hidden = true;

  comments.forEach((entry) => {
    const data = entry || {};
    const item = document.createElement('li');
    item.className = 'comment-item';

    const meta = document.createElement('div');
    meta.className = 'comment-meta';

    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = data.authorName || deriveNameFromEmail(data.authorEmail) || 'Appassionato';
    meta.appendChild(author);

    const time = document.createElement('time');
    time.className = 'comment-time';
    const formatted = formatCommentDate(data.createdAt);
    time.dateTime = formatted.iso;
    time.textContent = formatted.text;
    meta.appendChild(time);

    item.appendChild(meta);

    const body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = (data.body || '').trim();
    item.appendChild(body);

    commentState.list.appendChild(item);
  });
}

function setCommentFormStatus(message, type) {
  if (!commentState.status) return;
  commentState.status.textContent = message || '';
  commentState.status.classList.remove('is-success', 'is-error');
  if (type === 'success') {
    commentState.status.classList.add('is-success');
  } else if (type === 'error') {
    commentState.status.classList.add('is-error');
  }
}

function updateCommentAvailability() {
  if (!commentState.form || !commentState.callout) return;
  const servicesReady = !!(commentState.services && commentState.services.db);
  const user = commentState.currentUser;

  if (!servicesReady && !commentState.useLocal) {
    commentState.form.hidden = true;
    commentState.callout.hidden = true;
    if (commentState.helper && commentState.helperDefault) {
      commentState.helper.textContent = commentState.helperDefault;
    }
    return;
  }

  if (commentState.useLocal) {
    commentState.form.hidden = false;
    commentState.callout.hidden = true;
    if (commentState.helper) {
      commentState.helper.textContent = 'Scrivi un commento: sarà salvato solo su questo dispositivo.';
    }
    if (commentState.formGrid) {
      commentState.formGrid.hidden = false;
    }
    if (commentState.nameInput) {
      commentState.nameInput.disabled = false;
    }
    if (commentState.emailInput) {
      commentState.emailInput.disabled = false;
    }
    return;
  }

  if (user) {
    commentState.form.hidden = false;
    commentState.callout.hidden = true;
    if (commentState.helper) {
      const friendly = user.displayName || deriveNameFromEmail(user.email);
      commentState.helper.textContent = `Stai commentando come ${friendly}.`;
    }
    if (commentState.formGrid) {
      commentState.formGrid.hidden = true;
    }
    if (commentState.nameInput) {
      commentState.nameInput.disabled = true;
      commentState.nameInput.value = '';
    }
    if (commentState.emailInput) {
      commentState.emailInput.disabled = true;
      commentState.emailInput.value = '';
    }
  } else {
    if (commentState.form && typeof commentState.form.reset === 'function') {
      commentState.form.reset();
    }
    commentState.form.hidden = true;
    commentState.callout.hidden = false;
    setCommentFormStatus('', null);
    if (commentState.helper && commentState.helperDefault) {
      commentState.helper.textContent = commentState.helperDefault;
    }
    if (commentState.formGrid) {
      commentState.formGrid.hidden = true;
    }
  }
}

async function handleCommentSubmit(event) {
  event.preventDefault();
  if (!commentState.form || commentState.form.classList.contains('is-submitting')) return;

  const textarea = commentState.textarea;
  const value = textarea ? textarea.value.trim() : '';
  if (!value) {
    setCommentFormStatus('Scrivi qualcosa prima di pubblicare.', 'error');
    if (textarea) {
      textarea.focus();
    }
    return;
  }

  const useLocal = commentState.useLocal && !!authStorage;

  if (useLocal) {
    const nameInput = commentState.nameInput;
    const emailInput = commentState.emailInput;
    const nameValue = nameInput ? nameInput.value.trim() : '';
    const emailValue = normaliseEmail(emailInput ? emailInput.value : '');

    if (!nameValue && !emailValue) {
      setCommentFormStatus('Inserisci il tuo nome o indirizzo email.', 'error');
      if (nameInput) {
        nameInput.focus();
      }
      return;
    }

    const entry = {
      id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      body: value,
      authorName: nameValue || null,
      authorEmail: emailValue || null,
      createdAt: new Date().toISOString(),
    };

    const existing = loadLocalComments(commentState.postId);
    existing.unshift(entry);
    saveLocalComments(commentState.postId, existing);
    commentState.localComments = existing;
    renderCommentList(existing);
    const preservedName = nameValue;
    const preservedEmail = emailValue;
    commentState.form.reset();
    if (nameInput) {
      nameInput.value = preservedName;
    }
    if (emailInput) {
      emailInput.value = preservedEmail;
    }
    setCommentFormStatus('Commento pubblicato!', 'success');
    updateCommentBanner('I commenti sono salvati localmente su questo dispositivo.', 'info');
    if (textarea) {
      textarea.focus();
    }
    return;
  }

  if (!commentState.services || !commentState.services.db || !commentState.services.auth) {
    setCommentFormStatus('Commenti non disponibili al momento. Riprova più tardi.', 'error');
    return;
  }

  const user = commentState.currentUser;
  if (!user || !user.uid) {
    updateCommentAvailability();
    setCommentFormStatus('Accedi per lasciare un commento.', 'error');
    return;
  }

  commentState.form.classList.add('is-submitting');
  setCommentFormStatus('Pubblicazione in corso…', null);

  try {
    const authorName = user.displayName || deriveNameFromEmail(user.email);
    await commentState.services.db
      .collection('posts')
      .doc(commentState.postId)
      .collection('comments')
      .add({
        body: value,
        authorUid: user.uid,
        authorEmail: normaliseEmail(user.email),
        authorName,
        createdAt: getServerTimestamp(),
      });

    if (textarea) {
      textarea.value = '';
      textarea.focus();
    }
    setCommentFormStatus('Commento pubblicato!', 'success');
    window.setTimeout(() => {
      setCommentFormStatus('', null);
    }, 2500);
  } catch (error) {
    console.error('Impossibile pubblicare il commento', error);
    setCommentFormStatus('Impossibile pubblicare il commento. Riprova tra poco.', 'error');
  } finally {
    commentState.form.classList.remove('is-submitting');
  }
}

function attachCommentListener(services) {
  if (!services || !services.db || !commentState.postId) return;
  if (typeof commentState.unsubscribe === 'function') {
    commentState.unsubscribe();
    commentState.unsubscribe = null;
  }

  try {
    const query = services.db
      .collection('posts')
      .doc(commentState.postId)
      .collection('comments')
      .orderBy('createdAt', 'desc');

    commentState.unsubscribe = query.onSnapshot(
      (snapshot) => {
        const entries = [];
        snapshot.forEach((doc) => {
          entries.push({ id: doc.id, ...(doc.data() || {}) });
        });
        renderCommentList(entries);
        updateCommentBanner(null);
      },
      (error) => {
        console.error('Impossibile caricare i commenti', error);
        updateCommentBanner('Impossibile caricare i commenti. Riprova più tardi.', 'error');
      },
    );
  } catch (error) {
    console.error('Errore durante la sottoscrizione ai commenti', error);
    updateCommentBanner('Commenti temporaneamente non disponibili.', 'error');
  }
}

function initialiseCommentSystem() {
  if (commentState.initialised) return;
  if (!isDateDetailPage()) return;

  const host = document.querySelector('.post-detail');
  if (!host) return;

  const section = createCommentSection();
  if (!section) return;

  host.appendChild(section);

  commentState.initialised = true;
  commentState.postId = slugifyPath(window.location.pathname);
  commentState.section = section;
  commentState.list = section.querySelector('.comment-list');
  commentState.count = section.querySelector('.comment-count');
  commentState.empty = section.querySelector('.comments-empty');
  commentState.helper = section.querySelector('.comments-helper');
  commentState.helperDefault = commentState.helper ? commentState.helper.textContent : '';
  commentState.form = section.querySelector('.comment-form');
  commentState.textarea = section.querySelector('textarea[name="comment-body"]');
  commentState.nameInput = section.querySelector('input[name="comment-name"]');
  commentState.emailInput = section.querySelector('input[name="comment-email"]');
  commentState.formGrid = section.querySelector('.comment-form-grid');
  commentState.status = section.querySelector('.comment-status');
  commentState.callout = section.querySelector('.comment-auth-callout');
  commentState.loading = section.querySelector('.comments-loading');
  commentState.useLocal = false;
  commentState.localComments = [];

  const loginButton = section.querySelector('.comment-login');
  if (loginButton) {
    loginButton.addEventListener('click', () => openAuthModal('login'));
  }
  const registerButton = section.querySelector('.comment-register');
  if (registerButton) {
    registerButton.addEventListener('click', () => openAuthModal('register'));
  }

  if (commentState.form) {
    commentState.form.addEventListener('submit', handleCommentSubmit);
  }

  setCommentCount(0);
  updateCommentBanner('Caricamento commenti…', 'loading');

  subscribeToAuthChanges((user) => {
    commentState.currentUser = user || null;
    updateCommentAvailability();
  });

  prepareFirebase()
    .then((services) => {
      if (!services || !services.db) {
        const localFallback = loadLocalComments(commentState.postId);
        if (localFallback.length) {
          commentState.localComments = localFallback;
          commentState.useLocal = true;
          renderCommentList(localFallback);
          updateCommentBanner('I commenti sono salvati localmente su questo dispositivo.', 'info');
        } else {
          commentState.useLocal = !!authStorage;
          if (commentState.useLocal) {
            renderCommentList([]);
            updateCommentBanner('I commenti saranno salvati sul tuo dispositivo.', 'info');
          } else {
            updateCommentBanner('Commenti non disponibili su questo dispositivo.', 'error');
          }
        }
        updateCommentAvailability();
        return;
      }
      commentState.services = services;
      updateCommentAvailability();
      attachCommentListener(services);
    })
    .catch((error) => {
      console.error('Impossibile inizializzare i commenti', error);
      updateCommentBanner('Commenti temporaneamente non disponibili.', 'error');
    });
}

window.addEventListener('beforeunload', () => {
  if (typeof commentState.unsubscribe === 'function') {
    commentState.unsubscribe();
  }
});

function bootstrapSiteChrome() {
  if (chromeBootstrapped) {
    return;
  }

  if (!document.body) {
    if (!chromeBootstrapScheduled) {
      chromeBootstrapScheduled = true;
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          chromeBootstrapScheduled = false;
          bootstrapSiteChrome();
        },
        { once: true },
      );
    }
    return;
  }

  chromeBootstrapped = true;

  ensureSiteHeader();
  ensureEmailBanner();
  initialiseEmailForms();
  initialiseAuthSystem();
  initialiseDetailGallery();
  initialiseCommentSystem();
  initialiseAdminDashboard();
  initialisePostListings();
  enforceLayoutFallbacks();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapSiteChrome);
} else {
  bootstrapSiteChrome();
}
