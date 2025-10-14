const AUCTION_STORAGE_KEY = 'auctionx-state-v1';

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const timestampFormatter = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const closingFormatter = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const BASE_AUCTIONS = [
  {
    id: 'delta-integrale',
    title: 'Lancia Delta HF Integrale Evoluzione',
    location: 'Torino, Piemonte',
    image: 'images/9:15 1.jpeg',
    imageAlt: 'Lancia Delta HF Integrale Evoluzione gialla',
    description:
      'Edizione Giallo Ginestra con assetto originale, 78.000 km certificati e storico manutentivo completo in officina Lancia.',
    startingBid: 32000,
    minIncrement: 500,
    buyNow: 46000,
    endsInHours: 72,
    bids: [
      { name: 'Marta R.', amount: 32750, timestamp: '2025-09-21T10:10:00.000Z' },
      { name: 'Luca T.', amount: 33500, timestamp: '2025-09-21T17:45:00.000Z' },
    ],
  },
  {
    id: 'spider-veloce',
    title: 'Alfa Romeo Spider 2000 Veloce',
    location: 'Bari, Puglia',
    image: 'images/9:19 1.jpeg',
    imageAlt: 'Alfa Romeo Spider 2000 Veloce rossa su strada costiera',
    description:
      'Import USA reimmatricolata, tetto nuovo in tela Stayfast e kit iniezione Bosch revisionato. Perfetta per il prossimo tour in Puglia.',
    startingBid: 18500,
    minIncrement: 250,
    buyNow: 24900,
    endsInHours: 54,
    bids: [
      { name: 'Giulia P.', amount: 18800, timestamp: '2025-09-22T09:00:00.000Z' },
    ],
  },
  {
    id: 'porsche-928gts',
    title: 'Porsche 928 GTS Manuale',
    location: 'Como, Lombardia',
    image: 'images/9:10 1.jpeg',
    imageAlt: 'Porsche 928 GTS blu notte parcheggiata sul lago',
    description:
      'Ultimo anno di produzione, cambio manuale a cinque rapporti e pacchetto Sport Chrono. Libretto service timbrato Porsche Classic.',
    startingBid: 54000,
    minIncrement: 1000,
    buyNow: 72000,
    endsInHours: 96,
    bids: [
      { name: 'Alessandro V.', amount: 55500, timestamp: '2025-09-21T08:35:00.000Z' },
      { name: 'Serena L.', amount: 56500, timestamp: '2025-09-22T14:20:00.000Z' },
    ],
  },
];

function loadAuctionState() {
  try {
    const raw = window.localStorage.getItem(AUCTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch (error) {
    console.warn('Impossibile caricare lo stato delle aste.', error);
    return {};
  }
}

function saveAuctionState(state) {
  try {
    window.localStorage.setItem(AUCTION_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Impossibile salvare lo stato delle aste.', error);
  }
}

function formatCurrency(value) {
  return currencyFormatter.format(Math.round(value));
}

function computeFutureTimestamp(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

function computeHighestBid(auction) {
  return auction.bids.reduce((max, bid) => (bid.amount > max ? bid.amount : max), auction.startingBid);
}

function computeNextMinimum(auction) {
  return computeHighestBid(auction) + auction.minIncrement;
}

function renderBidHistory(listElement, auction) {
  listElement.innerHTML = '';
  if (!auction.bids.length) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'bid-empty';
    emptyItem.textContent = 'Ancora nessuna offerta — sii il primo!';
    listElement.append(emptyItem);
    return;
  }

  const orderedBids = [...auction.bids].sort((a, b) => {
    if (b.amount === a.amount) {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    }
    return b.amount - a.amount;
  });

  orderedBids.slice(0, 6).forEach((bid) => {
    const item = document.createElement('li');
    const formattedAmount = formatCurrency(bid.amount);
    const formattedTime = timestampFormatter.format(new Date(bid.timestamp));
    item.innerHTML = `<strong>${formattedAmount}</strong> da ${bid.name || 'Anonimo'} • <time datetime="${bid.timestamp}">${formattedTime}</time>`;
    listElement.append(item);
  });
}

function updateBidStatus(statusElement, message, variant) {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.classList.remove('is-error', 'is-success');
  if (variant === 'error') {
    statusElement.classList.add('is-error');
  } else if (variant === 'success') {
    statusElement.classList.add('is-success');
  }
}

function disableForm(form) {
  if (!form) return;
  form.classList.add('is-closed');
  const elements = Array.from(form.elements);
  elements.forEach((element) => {
    element.disabled = true;
  });
}

function updateAuctionStats(card, auction) {
  const currentBidElement = card.querySelector('[data-role="current-bid"]');
  const nextBidElement = card.querySelector('[data-role="next-bid"]');
  const highest = computeHighestBid(auction);
  if (currentBidElement) {
    currentBidElement.textContent = formatCurrency(highest);
  }
  if (nextBidElement) {
    nextBidElement.textContent = formatCurrency(highest + auction.minIncrement);
  }
  const amountInput = card.querySelector('input[name="amount"]');
  if (amountInput) {
    amountInput.min = String(highest + auction.minIncrement);
    amountInput.step = String(auction.minIncrement);
    amountInput.placeholder = formatCurrency(highest + auction.minIncrement);
  }
}

function persistAuction(auction, store) {
  const record = store[auction.id] || {};
  record.endsAt = auction.endsAt;
  record.closed = Boolean(auction.closed);
  record.bids = auction.bids.map((bid) => ({ ...bid }));
  store[auction.id] = record;
  saveAuctionState(store);
}

function startCountdown(auction, countdownElement, form, statusElement, store) {
  if (!countdownElement) return;
  const endDate = new Date(auction.endsAt).getTime();

  function renderCountdown() {
    const now = Date.now();
    const diff = endDate - now;
    if (diff <= 0) {
      countdownElement.textContent = 'Asta chiusa';
      if (!auction.closed) {
        auction.closed = true;
        persistAuction(auction, store);
      }
      if (form) {
        disableForm(form);
      }
      updateBidStatus(statusElement, 'L\'asta è terminata. Grazie per aver partecipato!', 'success');
      return true;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let value = '';
    if (days > 0) {
      value += `${days}g `;
    }
    value += `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    countdownElement.textContent = value;
    return false;
  }

  const finishedImmediately = renderCountdown();
  if (finishedImmediately) {
    return;
  }

  const interval = window.setInterval(() => {
    const ended = renderCountdown();
    if (ended) {
      window.clearInterval(interval);
    }
  }, 1000);
}

function renderAuctionCard(auction, gridElement, store) {
  const highest = computeHighestBid(auction);
  const nextMinimum = highest + auction.minIncrement;
  const formattedClosing = closingFormatter.format(new Date(auction.endsAt));

  const template = document.createElement('template');
  template.innerHTML = `
    <article class="auction-card">
      <figure class="auction-media">
        <img src="${auction.image}" alt="${auction.imageAlt}">
      </figure>
      <div class="auction-content">
        <h3>${auction.title}</h3>
        <div class="auction-meta">
          <span>${auction.location}</span>
          <span>Chiusura: <time datetime="${auction.endsAt}" data-role="closing-time">${formattedClosing}</time></span>
        </div>
        <p class="auction-description">${auction.description}</p>
        <dl class="auction-stats">
          <div>
            <dt>Offerta attuale</dt>
            <dd data-role="current-bid">${formatCurrency(highest)}</dd>
          </div>
          <div>
            <dt>Prossima offerta minima</dt>
            <dd data-role="next-bid">${formatCurrency(nextMinimum)}</dd>
          </div>
          <div>
            <dt>Tempo rimasto</dt>
            <dd data-role="countdown">--:--</dd>
          </div>
        </dl>
        ${auction.buyNow ? `<p class="auction-buy-now">Compra subito a ${formatCurrency(auction.buyNow)}</p>` : ''}
        <form class="bid-form${auction.closed ? ' is-closed' : ''}" data-auction-id="${auction.id}">
          <label>
            Il tuo nome
            <input name="bidder" type="text" placeholder="Nome" autocomplete="name" required ${auction.closed ? 'disabled' : ''}>
          </label>
          <label>
            Offerta (€)
            <input name="amount" type="number" inputmode="numeric" min="${nextMinimum}" step="${auction.minIncrement}" placeholder="${formatCurrency(nextMinimum)}" required ${auction.closed ? 'disabled' : ''}>
          </label>
          <button type="submit" ${auction.closed ? 'disabled' : ''}>Invia offerta</button>
          <p class="bid-status" aria-live="polite"></p>
        </form>
        <div class="bid-history">
          <h4>Ultime offerte</h4>
          <ol data-role="bid-history"></ol>
        </div>
      </div>
    </article>
  `.trim();

  const card = template.content.firstElementChild;
  const form = card.querySelector('form');
  const statusElement = card.querySelector('.bid-status');
  const historyElement = card.querySelector('[data-role="bid-history"]');
  const countdownElement = card.querySelector('[data-role="countdown"]');

  renderBidHistory(historyElement, auction);
  updateAuctionStats(card, auction);

  if (auction.closed) {
    disableForm(form);
    if (statusElement) {
      updateBidStatus(statusElement, 'Asta chiusa: stiamo contattando il miglior offerente.', 'success');
    }
  }

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (auction.closed) {
        updateBidStatus(statusElement, 'L\'asta è già terminata.', 'error');
        return;
      }

      const formData = new FormData(form);
      const bidder = (formData.get('bidder') || '').toString().trim();
      const amountValue = Number(formData.get('amount'));

      if (!bidder) {
        updateBidStatus(statusElement, 'Inserisci il tuo nome per registrare l\'offerta.', 'error');
        return;
      }

      if (!Number.isFinite(amountValue)) {
        updateBidStatus(statusElement, 'Inserisci un importo valido in euro.', 'error');
        return;
      }

      const minimumAllowed = computeNextMinimum(auction);
      if (amountValue < minimumAllowed) {
        updateBidStatus(
          statusElement,
          `L'offerta minima richiesta è ${formatCurrency(minimumAllowed)}.`,
          'error',
        );
        return;
      }

      const newBid = {
        name: bidder,
        amount: Math.round(amountValue),
        timestamp: new Date().toISOString(),
      };

      auction.bids.push(newBid);
      auction.bids.sort((a, b) => {
        if (b.amount === a.amount) {
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        }
        return b.amount - a.amount;
      });

      renderBidHistory(historyElement, auction);
      updateAuctionStats(card, auction);
      persistAuction(auction, store);

      form.reset();
      updateBidStatus(statusElement, 'Offerta registrata! In bocca al lupo.', 'success');
    });
  }

  startCountdown(auction, countdownElement, form, statusElement, store);
  gridElement.append(card);
}

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('[data-auction-grid]');
  if (!grid) return;

  const store = loadAuctionState();
  const stateToPersist = { ...store };

  const auctions = BASE_AUCTIONS.map((base) => {
    const record = stateToPersist[base.id] || {};
    let endsAt = record.endsAt;
    if (!endsAt) {
      endsAt = computeFutureTimestamp(base.endsInHours || 48);
      record.endsAt = endsAt;
    }

    let bids = Array.isArray(record.bids) && record.bids.length
      ? record.bids.map((bid) => ({ ...bid }))
      : (base.bids || []).map((bid) => ({ ...bid }));

    if (!Array.isArray(record.bids) || !record.bids.length) {
      record.bids = bids.map((bid) => ({ ...bid }));
    }

    record.closed = Boolean(record.closed);
    stateToPersist[base.id] = record;

    return {
      ...base,
      bids,
      endsAt,
      closed: record.closed,
    };
  });

  saveAuctionState(stateToPersist);

  auctions.forEach((auction) => {
    renderAuctionCard(auction, grid, stateToPersist);
  });
});
