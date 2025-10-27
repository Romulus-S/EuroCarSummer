
(function () {
  const headerMarkup = `
    <div class="header-inner">
      <a class="site-title" href="index.html">Euro Car Summer</a>
      <nav class="site-nav" aria-label="Navigazione principale">
        <a href="index.html">Home</a>
        <a href="annunci-esclusivi.html">Exclusives</a>
        <a href="for-americans.html">For Americans</a>
        <a href="sold.html">Sold</a>
      </nav>
    </div>
  `;

  const footerMarkup = `
    <div class="footer-inner">
      <p>© Euro Car Summer — Passione italiana per le auto d'epoca.</p>
    </div>
  `;

  function normalisePath(href) {
    if (!href) return '';
    const url = new URL(href, window.location.origin);
    let pathname = url.pathname || '';
    if (pathname === '/' || pathname === '') {
      return 'index.html';
    }
    if (pathname.startsWith('/')) {
      pathname = pathname.slice(1);
    }
    return pathname;
  }

  function setActiveLink(nav) {
    if (!nav) return;
    const current = normalisePath(window.location.pathname);
    Array.from(nav.querySelectorAll('a')).forEach((link) => {
      const target = normalisePath(link.getAttribute('href'));
      if (target === current) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function ensureHeader() {
    let header = document.querySelector('.site-header');
    if (!header) {
      header = document.createElement('header');
      header.className = 'site-header';
      if (document.body.firstChild) {
        document.body.insertBefore(header, document.body.firstChild);
      } else {
        document.body.appendChild(header);
      }
    }
    header.innerHTML = headerMarkup;
    const nav = header.querySelector('.site-nav');
    setActiveLink(nav);
  }

  function ensureFooter() {
    let footer = document.querySelector('.site-footer');
    if (!footer) {
      footer = document.createElement('footer');
      footer.className = 'site-footer';
      document.body.appendChild(footer);
    }
    footer.innerHTML = footerMarkup;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureHeader();
      ensureFooter();
    });
  } else {
    ensureHeader();
    ensureFooter();
  }
})();
