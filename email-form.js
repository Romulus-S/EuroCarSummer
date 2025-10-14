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

document.addEventListener('DOMContentLoaded', () => {
  const forms = document.querySelectorAll('.email-form');
  forms.forEach((form) => {
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
});
