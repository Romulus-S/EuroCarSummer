
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

  const lightbox = createLightbox();

  function normalisePath(href) {
    if (!href) return '';
    const hasOrigin = window.location.origin && window.location.origin !== 'null';
    const base = hasOrigin
      ? window.location.origin
      : window.location.href.replace(/[^/]*$/, '');
    try {
      const url = new URL(href, base);
      let pathname = url.pathname || '';
      if (pathname === '/' || pathname === '') {
        return 'index.html';
      }
      pathname = pathname.replace(/^\//, '');
      if (!hasOrigin) {
        const parts = pathname.split('/').filter(Boolean);
        pathname = parts.length ? parts[parts.length - 1] : pathname;
      }
      return pathname;
    } catch (error) {
      if (href === '/' || href === '') {
        return 'index.html';
      }
      return href.replace(/^[./]+/, '');
    }
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

 function initialiseSite() {
    ensureHeader();
    ensureFooter();

   initGalleries();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseSite);
  } else {
    initialiseSite();
  }

  function initGalleries() {
    const galleries = document.querySelectorAll('[data-gallery]');
    galleries.forEach((gallery) => {
      if (gallery.__galleryInitialised) return;
      gallery.__galleryInitialised = true;
      setupGallery(gallery);
    });
  }

  function setupGallery(gallery) {
    const images = Array.from(gallery.querySelectorAll('img'));
    const counter = gallery.querySelector('[data-counter]');
    const nextButton = gallery.querySelector('[data-next]');
    const prevButton = gallery.querySelector('[data-prev]');
    const fullscreenButton = gallery.querySelector('[data-fullscreen]');

    if (!images.length) return;

    const state = {
      images,
      index: 0,
      goTo(nextIndex) {
        const total = images.length;
        state.index = (nextIndex + total) % total;
        images.forEach((img, idx) => {
          const isActive = idx === state.index;
          img.classList.toggle('is-active', isActive);
          if (isActive) {
            img.removeAttribute('hidden');
            img.setAttribute('aria-hidden', 'false');
          } else {
            img.setAttribute('hidden', 'hidden');
            img.setAttribute('aria-hidden', 'true');
          }
        });
        if (counter) {
          counter.textContent = `${state.index + 1} / ${total}`;
        }
        if (lightbox.isOpen(state)) {
          lightbox.update(state);
        }
      },
      next() {
        state.goTo(state.index + 1);
      },
      prev() {
        state.goTo(state.index - 1);
      }
    };

    if (nextButton) {
      nextButton.addEventListener('click', () => state.next());
    }
    if (prevButton) {
      prevButton.addEventListener('click', () => state.prev());
    }
    images.forEach((img) => {
      img.addEventListener('click', () => lightbox.open(state));
    });
    if (fullscreenButton) {
      fullscreenButton.addEventListener('click', () => lightbox.open(state));
    }

    state.goTo(0);
  }

  function createLightbox() {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="lightbox__backdrop" data-close></div>
      <div class="lightbox__content" role="dialog" aria-modal="true" aria-label="Full screen image viewer">
        <button class="lightbox__close" type="button" data-close aria-label="Close full screen">×</button>
        <button class="lightbox__nav lightbox__nav--prev" type="button" data-prev aria-label="Previous image">‹</button>
        <figure class="lightbox__figure">
          <img class="lightbox__image" src="" alt="" />
          <figcaption class="lightbox__caption"></figcaption>
          <span class="lightbox__counter" data-counter>0 / 0</span>
        </figure>
        <button class="lightbox__nav lightbox__nav--next" type="button" data-next aria-label="Next image">›</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const closeButton = overlay.querySelector('.lightbox__close');
    const nextButton = overlay.querySelector('[data-next]');
    const prevButton = overlay.querySelector('[data-prev]');
    const imageEl = overlay.querySelector('.lightbox__image');
    const captionEl = overlay.querySelector('.lightbox__caption');
    const counterEl = overlay.querySelector('.lightbox__counter');

    let activeState = null;

    function open(state) {
      if (!state || !state.images.length) return;
      activeState = state;
      overlay.classList.add('is-active');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('lightbox-open');
      update(state);
    }

    function close() {
      overlay.classList.remove('is-active');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lightbox-open');
      activeState = null;
    }

    function update(state = activeState) {
      if (!state) return;
      const currentImage = state.images[state.index];
      if (!currentImage) return;
      imageEl.src = currentImage.src;
      imageEl.alt = currentImage.alt || '';
      captionEl.textContent = currentImage.dataset.caption || currentImage.alt || '';
      counterEl.textContent = `${state.index + 1} / ${state.images.length}`;
    }

    function handleKeydown(event) {
      if (!activeState) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        activeState.prev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        activeState.next();
      }
    }

    overlay.addEventListener('click', (event) => {
      if (event.target && 'close' in event.target.dataset) {
        close();
      }
    });

    nextButton.addEventListener('click', () => {
      if (activeState) {
        activeState.next();
      }
    });
    prevButton.addEventListener('click', () => {
      if (activeState) {
        activeState.prev();
      }
    });
    closeButton.addEventListener('click', () => close());
    document.addEventListener('keydown', handleKeydown);

    return {
      open,
      close,
      update,
      isOpen(state) {
        return activeState === state;
      }
    };
  }
})();
