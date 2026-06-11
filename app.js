const SOURCES = {
  gopnath: {
    url: 'https://starlinesupport.in:10001',
    room: 'gopnathrefinery',
    label: 'Gopnath',
  },
  swayam: {
    url: 'https://starlinesolutions.in:10001',
    room: 'swayamtrading',
    label: 'Swayam',
  },
};

const state = {
  gopnath: {
    connected: false,
    lastSeen: null,
    live: [],
    map: {},
    products: [],
  },
  swayam: {
    connected: false,
    lastSeen: null,
    live: [],
    map: {},
  },
};

const dom = {
  status: document.getElementById('status'),
  lastUpdated: document.getElementById('lastUpdated'),
  futureBox: document.getElementById('futureBox'),
  spotBox: document.getElementById('spotBox'),
  productBox: document.getElementById('productBox'),
  summaryScroller: document.getElementById('summaryScroller'),
  summaryTabs: Array.from(document.querySelectorAll('.summary-tab')),
  gold: {
    value: document.getElementById('goldValue'),
    sub: document.getElementById('goldSub'),
    buy: document.getElementById('goldBuy'),
    sell: document.getElementById('goldSell'),
    high: document.getElementById('goldHigh'),
    low: document.getElementById('goldLow'),
    source: document.getElementById('goldSource'),
  },
  silver: {
    value: document.getElementById('silverValue'),
    sub: document.getElementById('silverSub'),
    buy: document.getElementById('silverBuy'),
    sell: document.getElementById('silverSell'),
    high: document.getElementById('silverHigh'),
    low: document.getElementById('silverLow'),
    source: document.getElementById('silverSource'),
  },
};

function toNum(val) {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '--') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatInr(n) {
  return n !== null && n !== undefined ? `₹${n.toLocaleString('en-IN')}` : '—';
}

function normalizeFeed(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.Rate)) return data.Rate;
  return [];
}

function symbolOf(item) {
  return String(item?.symbol ?? item?.Symbol ?? item?.Source ?? '').trim().toLowerCase();
}

function titleOf(symbol, item) {
  const sym = String(symbol || '').toLowerCase();
  if (sym === 'gold') return 'Gold';
  if (sym === 'silver') return 'Silver';
  if (sym === 'goldnext') return 'Gold Next';
  if (sym === 'silvernext') return 'Silver Next';
  if (sym === 'xauusd') return 'XAU/USD';
  if (sym === 'xagusd') return 'XAG/USD';
  if (sym === 'inrspot') return 'INR Spot';
  if (item?.Name) return String(item.Name).toUpperCase();
  return String(symbol || '').toUpperCase();
}

function sourceFor(symbol) {
  const sym = String(symbol || '').toLowerCase();
  if (sym === 'silver' || sym === 'silvernext') return 'swayam';
  return 'gopnath';
}

function bestItemFor(symbol) {
  const sym = String(symbol || '').toLowerCase();

  if (sym === 'silver' || sym === 'silvernext') {
    return state.swayam.map[sym] || state.gopnath.map[sym] || null;
  }

  return state.gopnath.map[sym] || state.swayam.map[sym] || null;
}

function indexBySymbol(items) {
  const map = {};
  for (const item of items) {
    const sym = symbolOf(item);
    if (!sym) continue;
    if (!map[sym]) map[sym] = item;
  }
  return map;
}

function uniqueSymbolsFromFeeds() {
  const ordered = [];
  const seen = new Set();

  for (const item of state.gopnath.live) {
    const sym = symbolOf(item);
    if (sym && !seen.has(sym)) {
      seen.add(sym);
      ordered.push(sym);
    }
  }

  for (const item of state.swayam.live) {
    const sym = symbolOf(item);
    if (sym && !seen.has(sym)) {
      seen.add(sym);
      ordered.push(sym);
    }
  }

  return ordered;
}

function productVisibleRows(rows) {
  return rows.filter(row => String(row?.IsDisplay).toLowerCase() === 'true');
}

function setStatus() {
  const g = state.gopnath.connected ? 'Gopnath: live' : 'Gopnath: connecting';
  const s = state.swayam.connected ? 'Swayam: live' : 'Swayam: connecting';
  dom.status.textContent = `${g} · ${s}`;
}

function setUpdatedTime() {
  const stamp = state.gopnath.lastSeen || state.swayam.lastSeen;
  dom.lastUpdated.textContent = `Last updated: ${stamp ? new Date(stamp).toLocaleString() : '—'}`;
}

function renderSummaryCard(target, symbol, fallbackLabel) {
  const item = bestItemFor(symbol);
  const source = sourceFor(symbol);
  const label = fallbackLabel;
  const buy = item ? toNum(item.Bid) ?? toNum(item.Buy) : null;
  const sell = item ? toNum(item.Ask) ?? toNum(item.Sell) : null;
  const high = item ? toNum(item.High) : null;
  const low = item ? toNum(item.Low) : null;
  const displayRate = sell ?? buy;

  target.source.textContent = `Source: ${SOURCES[source].label}`;
  target.value.textContent = displayRate !== null ? formatInr(displayRate) : '—';
  target.sub.textContent = item
    ? `${label} live from ${SOURCES[source].label}. ${item.Name ? `Feed: ${item.Name}.` : ''}`
    : `Waiting for live ${label.toLowerCase()} data…`;
  target.buy.textContent = formatInr(buy);
  target.sell.textContent = formatInr(sell);
  target.high.textContent = formatInr(high);
  target.low.textContent = formatInr(low);
}

function renderFutureTable() {
  const symbols = uniqueSymbolsFromFeeds();
  const rows = symbols.map(sym => {
    const item = bestItemFor(sym);
    if (!item) return '';
    const buy = toNum(item.Bid) ?? toNum(item.Buy);
    const sell = toNum(item.Ask) ?? toNum(item.Sell);
    const high = toNum(item.High);
    const low = toNum(item.Low);
    const src = sourceFor(sym);
    return `
      <tr>
        <td class="rowhead">${escapeHtml(titleOf(sym, item))}</td>
        <td><span class="rate-chip ${src}">${SOURCES[src].label}</span></td>
        <td>${escapeHtml(formatPlain(buy))}</td>
        <td>${escapeHtml(formatPlain(sell))}</td>
        <td>${escapeHtml(formatPlain(high))}</td>
        <td>${escapeHtml(formatPlain(low))}</td>
      </tr>
    `;
  }).join('');

  dom.futureBox.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Source</th>
          <th>Buy</th>
          <th>Sell</th>
          <th>High</th>
          <th>Low</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6">No live future data yet.</td></tr>'}
      </tbody>
    </table>
  `;
}

function renderSpotTable() {
  const preferred = ['xauusd', 'xagusd', 'inrspot'];
  const rows = preferred.map(sym => {
    const item = bestItemFor(sym);
    if (!item) return '';
    const src = sourceFor(sym);
    return `
      <tr>
        <td class="rowhead">${escapeHtml(titleOf(sym, item))}</td>
        <td><span class="rate-chip ${src}">${SOURCES[src].label}</span></td>
        <td>${escapeHtml(formatPlain(toNum(item.Bid) ?? toNum(item.Buy)))}</td>
        <td>${escapeHtml(formatPlain(toNum(item.Ask) ?? toNum(item.Sell)))}</td>
        <td>${escapeHtml(formatPlain(toNum(item.High)))}</td>
        <td>${escapeHtml(formatPlain(toNum(item.Low)))}</td>
      </tr>
    `;
  }).join('');

  dom.spotBox.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Source</th>
          <th>Buy</th>
          <th>Sell</th>
          <th>High</th>
          <th>Low</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6">No live spot data yet.</td></tr>'}
      </tbody>
    </table>
  `;
}

function renderProductTable() {
  const rows = state.gopnath.products.map(item => {
    const sym = titleOf(symbolOf(item), item);
    return `
      <tr>
        <td class="rowhead">${escapeHtml(sym)}</td>
        <td>${escapeHtml(formatPlain(toNum(item.Bid) ?? toNum(item.Buy)))}</td>
        <td>${escapeHtml(formatPlain(toNum(item.Ask) ?? toNum(item.Sell)))}</td>
        <td>${escapeHtml(formatPlain(toNum(item.High)))}</td>
        <td>${escapeHtml(formatPlain(toNum(item.Low)))}</td>
      </tr>
    `;
  }).join('');

  dom.productBox.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th>Buy</th>
          <th>Sell</th>
          <th>High</th>
          <th>Low</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5">No visible product data yet.</td></tr>'}
      </tbody>
    </table>
  `;
}

function formatPlain(val) {
  return val === null || val === undefined ? '—' : String(val);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderAll() {
  renderSummaryCard(dom.gold, 'gold', 'Gold');
  renderSummaryCard(dom.silver, 'silver', 'Silver');
  renderFutureTable();
  renderSpotTable();
  renderProductTable();
  setStatus();
  setUpdatedTime();
}

function ingestFeed(sourceKey, data) {
  const items = normalizeFeed(data);
  if (!items.length) return;

  state[sourceKey].live = items;
  state[sourceKey].map = indexBySymbol(items);
  state[sourceKey].lastSeen = new Date().toISOString();

  if (sourceKey === 'gopnath' && data && Array.isArray(data.Rate)) {
    state.gopnath.products = productVisibleRows(data.Rate);
  }

  renderAll();
}

function attachFeed(sourceKey) {
  const feed = SOURCES[sourceKey];

  if (typeof window.io !== 'function') {
    dom.status.textContent = 'Socket.IO library not loaded. Make sure socket.io.min.js is present.';
    console.error('Socket.IO client library missing.');
    return null;
  }

  const socket = io(feed.url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    state[sourceKey].connected = true;
    setStatus();
    socket.emit('room', feed.room);
    if (sourceKey === 'gopnath') {
      socket.emit('Client', feed.room);
    }
    renderAll();
  });

  socket.on('disconnect', () => {
    state[sourceKey].connected = false;
    setStatus();
  });

  socket.on('connect_error', (err) => {
    console.log(`${feed.label} socket error:`, err?.message || err);
    state[sourceKey].connected = false;
    setStatus();
  });

  socket.on('ClientData', (data) => {
    try {
      window.clientData = typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.log('ClientData parse error', e);
    }
  });

  socket.on('message', (data) => ingestFeed(sourceKey, data));
  socket.on('Liverate', (data) => ingestFeed(sourceKey, data));

  return socket;
}

dom.summaryTabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const card = document.getElementById(targetId);
    if (!card) return;

    dom.summaryTabs.forEach((b) => b.classList.toggle('active', b === btn));
    card.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  });
});

attachFeed('gopnath');
attachFeed('swayam');
renderAll();
