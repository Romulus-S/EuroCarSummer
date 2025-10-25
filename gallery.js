(function () {
  function initGallery(root, slides, options) {
    if (!root || !Array.isArray(slides) || slides.length === 0) {
      return null;
    }

    const config = Object.assign(
      {
        variant: '',
        showThumbnails: false,
        enableKeyboard: false,
        showCounter: false,
        loop: true,
        ariaLabel: 'Galleria immagini',
      },
      options || {},
    );

    root.classList.add('image-gallery');
    if (config.variant) {
      root.classList.add(config.variant);
    }
    root.setAttribute('data-gallery-initialised', 'true');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', config.ariaLabel);
    root.innerHTML = '';

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.className = 'gallery-control gallery-control--prev';
    prevButton.setAttribute('aria-label', 'Immagine precedente');
    prevButton.innerHTML = '<span aria-hidden="true">&#10094;</span>';

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'gallery-control gallery-control--next';
    nextButton.setAttribute('aria-label', 'Immagine successiva');
    nextButton.innerHTML = '<span aria-hidden="true">&#10095;</span>';

    const stage = document.createElement('div');
    stage.className = 'gallery-stage';

    slides.forEach((slide, index) => {
      slide.classList.add('gallery-slide');
      if (index === 0) {
        slide.classList.add('is-active');
      }
      stage.appendChild(slide);
    });

    root.appendChild(prevButton);
    root.appendChild(stage);
    root.appendChild(nextButton);

    let counter = null;
    if (config.showCounter) {
      counter = document.createElement('p');
      counter.className = 'gallery-counter';
      counter.textContent = `1 / ${slides.length}`;
      root.appendChild(counter);
    }

    let thumbnailBar = null;
    const thumbnailButtons = [];
    if (config.showThumbnails) {
      thumbnailBar = document.createElement('div');
      thumbnailBar.className = 'gallery-thumbnails';

      slides.forEach((slide, index) => {
        const thumbButton = document.createElement('button');
        thumbButton.type = 'button';
        thumbButton.className = 'gallery-thumb';
        thumbButton.setAttribute('aria-label', `Mostra immagine ${index + 1}`);

        const image = slide.querySelector('img');
        const thumbImage = image ? image.cloneNode(true) : null;
        if (thumbImage) {
          thumbImage.removeAttribute('width');
          thumbImage.removeAttribute('height');
          thumbImage.loading = 'lazy';
          thumbImage.decoding = 'async';
          thumbButton.appendChild(thumbImage);
        }

        if (index === 0) {
          thumbButton.classList.add('is-active');
        }

        thumbButton.addEventListener('click', () => showSlide(index));
        thumbnailButtons.push(thumbButton);
        thumbnailBar.appendChild(thumbButton);
      });

      root.appendChild(thumbnailBar);
    }

    const totalSlides = slides.length;
    let currentIndex = 0;

    function focusRoot() {
      if (config.enableKeyboard) {
        root.focus();
      }
    }

    function updateCounter(index) {
      if (counter) {
        counter.textContent = `${index + 1} / ${totalSlides}`;
      }
    }

    function updateThumbnails(index) {
      if (!thumbnailButtons.length) {
        return;
      }
      thumbnailButtons.forEach((button, buttonIndex) => {
        if (buttonIndex === index) {
          button.classList.add('is-active');
        } else {
          button.classList.remove('is-active');
        }
      });
    }

    function showSlide(targetIndex) {
      let index = targetIndex;

      if (index < 0) {
        index = config.loop ? (totalSlides + (index % totalSlides)) % totalSlides : 0;
      } else if (index >= totalSlides) {
        index = config.loop ? index % totalSlides : totalSlides - 1;
      }

      if (index === currentIndex) {
        return;
      }

      slides[currentIndex].classList.remove('is-active');
      slides[index].classList.add('is-active');
      currentIndex = index;
      updateCounter(index);
      updateThumbnails(index);
    }

    prevButton.addEventListener('click', () => {
      if (!config.loop && currentIndex === 0) {
        return;
      }
      showSlide(currentIndex - 1);
      focusRoot();
    });

    nextButton.addEventListener('click', () => {
      if (!config.loop && currentIndex === totalSlides - 1) {
        return;
      }
      showSlide(currentIndex + 1);
      focusRoot();
    });

    if (config.enableKeyboard) {
      root.setAttribute('tabindex', '0');
      root.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          prevButton.click();
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          nextButton.click();
        }
      });
    }

    return root;
  }

  function enhancePostGalleries() {
    document.querySelectorAll('.post-detail').forEach((section) => {
      const images = Array.from(section.querySelectorAll('img'));
      if (images.length <= 1) {
        return;
      }

      const placeholder = document.createElement('div');
      const firstImage = images[0];
      const parent = firstImage.parentNode;
      parent.insertBefore(placeholder, firstImage);

      const slides = images.map((image) => {
        const figure = document.createElement('figure');
        const clone = image.cloneNode(true);
        clone.removeAttribute('width');
        clone.removeAttribute('height');
        clone.loading = 'lazy';
        clone.decoding = 'async';
        figure.appendChild(clone);
        parent.removeChild(image);
        return figure;
      });

      const root = document.createElement('section');
      initGallery(root, slides, {
        variant: 'image-gallery--post',
        showThumbnails: true,
        enableKeyboard: true,
        showCounter: true,
        ariaLabel: 'Galleria immagini della Macchina del Giorno',
      });

      parent.replaceChild(root, placeholder);
    });
  }

  function enhanceCardGalleries() {
    document.querySelectorAll('.card-gallery').forEach((container) => {
      if (container.dataset.galleryInitialised === 'true') {
        return;
      }
      const images = Array.from(container.querySelectorAll('img'));
      if (images.length <= 1) {
        container.classList.add('card-gallery--single');
        return;
      }

      const slides = images.map((image) => {
        const figure = document.createElement('figure');
        const clone = image.cloneNode(true);
        clone.removeAttribute('width');
        clone.removeAttribute('height');
        clone.loading = 'lazy';
        clone.decoding = 'async';
        figure.appendChild(clone);
        return figure;
      });

      container.innerHTML = '';
      initGallery(container, slides, {
        variant: 'image-gallery--card',
        showThumbnails: false,
        enableKeyboard: false,
        showCounter: true,
        ariaLabel: 'Anteprima immagini Macchina del Giorno',
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    enhancePostGalleries();
    enhanceCardGalleries();
  });
}());
