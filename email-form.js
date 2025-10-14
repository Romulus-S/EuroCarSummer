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
});
