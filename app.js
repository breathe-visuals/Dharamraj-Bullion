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
  },
  silver: {
    value: document.getElementById('silverValue'),
    sub: document.getElementById('silverSub'),
    buy: document.getElementById('silverBuy'),
    sell: document.getElementById('silverSell'),
    high: document.getElementById('silverHigh'),
    low: document.getElementById('silverLow'),
  },
};

const previousState = {
  summary: {
    gold: null,
    silver: null,
  },
  future: {},
  spot: {},
  products: {},
};

function toNum(val) {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '--') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatInr(val) {
  const n = toNum(val);
  if (n === null) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

function changeClass(current, previous) {
  const cur = toNum(current);
  const prev = toNum(previous);
  if (cur === null || prev === null) return 'same';
  if (cur > prev) return 'up';
  if (cur < prev) return 'down';
  return 'same';
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function symbolLabel(symbol, fallbackName) {
  const sym = String(symbol || '').toLowerCase();
  if (sym === 'gold') return 'Gold';
  if (sym === 'silver') return 'Silver';
  if (sym === 'goldnext') return 'Gold Next';
  if (sym === 'silvernext') return 'Silver Next';
  if (sym === 'xauusd') return 'XAU/USD';
  if (sym === 'xagusd') return 'XAG/USD';
  if (sym === 'inrspot') return 'INR Spot';
  return fallbackName || String(symbol || '').toUpperCase();
}

function itemKey(row) {
  return String(row?.symbol || row?.name || '').toLowerCase();
}

function rowToPlain(row) {
  return {
    symbol: String(row?.symbol || '').toLowerCase(),
    name: row?.name || '',
    bid: toNum(row?.bid),
    ask: toNum(row?.ask),
    high: toNum(row?.high),
    low: toNum(row?.low),
    open: toNum(row?.open),
    close: toNum(row?.close),
    diff: toNum(row?.diff),
    time: row?.time || '',
  };
}

function renderSummaryCard(card, current, previous, title) {
  const item = current ? rowToPlain(current) : null;
  const prev = previous ? rowToPlain(previous) : null;

  const mainValue = item ? (item.ask ?? item.bid ?? item.ltp ?? item.close) : null;
  const mainPrev = prev ? (prev.ask ?? prev.bid ?? prev.ltp ?? prev.close) : null;

  card.value.innerHTML = `<span class="price ${changeClass(mainValue, mainPrev)}">${formatInr(mainValue)}</span>`;
  card.sub.textContent = item
    ? `${title} live rate`
    : `Waiting for live ${title.toLowerCase()} data…`;

  card.buy.innerHTML = `<span class="mini-value ${changeClass(item?.bid, prev?.bid)}">${formatInr(item?.bid)}</span>`;
  card.sell.innerHTML = `<span class="mini-value ${changeClass(item?.ask, prev?.ask)}">${formatInr(item?.ask)}</span>`;
  card.high.innerHTML = `<span class="mini-value ${changeClass(item?.high, prev?.high)}">${formatInr(item?.high)}</span>`;
  card.low.innerHTML = `<span class="mini-value ${changeClass(item?.low, prev?.low)}">${formatInr(item?.low)}</span>`;
}

function buildTable(rows, previousMap, emptyMessage, showSymbol = true) {
  if (!rows || !rows.length) {
    return `<p class="empty">${emptyMessage}</p>`;
  }

  const htmlRows = rows.map((row) => {
    const current = rowToPlain(row);
    const prev = previousMap[itemKey(current)] || {};

    return `
      <tr>
        ${showSymbol ? `<td class="rowhead">${escapeHtml(symbolLabel(current.symbol, current.name))}</td>` : ''}
        <td><span class="rate-chip ${changeClass(current.bid, prev.bid)}">${formatInr(current.bid)}</span></td>
        <td><span class="rate-chip ${changeClass(current.ask, prev.ask)}">${formatInr(current.ask)}</span></td>
        <td><span class="rate-chip ${changeClass(current.high, prev.high)}">${formatInr(current.high)}</span></td>
        <td><span class="rate-chip ${changeClass(current.low, prev.low)}">${formatInr(current.low)}</span></td>
      </tr>
    `;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          ${showSymbol ? '<th>Symbol</th>' : ''}
          <th>Buy</th>
          <th>Sell</th>
          <th>High</th>
          <th>Low</th>
        </tr>
      </thead>
      <tbody>
        ${htmlRows}
      </tbody>
    </table>
  `;
}

function updateTime(updatedAt) {
  const stamp = updatedAt ? new Date(updatedAt) : null;
  dom.lastUpdated.textContent = `Last updated: ${stamp ? stamp.toLocaleString() : '—'}`;
}

function setStatus(text) {
  dom.status.textContent = text;
}

function renderAll(data) {
  const summaryGold = data?.summary?.gold || null;
  const summarySilver = data?.summary?.silver || null;

  renderSummaryCard(dom.gold, summaryGold, previousState.summary.gold, 'Gold');
  renderSummaryCard(dom.silver, summarySilver, previousState.summary.silver, 'Silver');

  dom.futureBox.innerHTML = buildTable(
    data?.futureRows || [],
    previousState.future,
    'No live future data yet.'
  );

  dom.spotBox.innerHTML = buildTable(
    data?.spotRows || [],
    previousState.spot,
    'No live spot data yet.'
  );

  dom.productBox.innerHTML = buildTable(
    data?.productRows || [],
    previousState.products,
    'No live product data yet.'
  );

  previousState.summary.gold = summaryGold ? { ...summaryGold } : null;
  previousState.summary.silver = summarySilver ? { ...summarySilver } : null;

  previousState.future = Object.fromEntries(
    (data?.futureRows || []).map(row => [itemKey(row), rowToPlain(row)])
  );

  previousState.spot = Object.fromEntries(
    (data?.spotRows || []).map(row => [itemKey(row), rowToPlain(row)])
  );

  previousState.products = Object.fromEntries(
    (data?.productRows || []).map(row => [itemKey(row), rowToPlain(row)])
  );

  updateTime(data?.updatedAt);
  setStatus(
    data?.connected?.gopnath || data?.connected?.swayam
      ? 'Live'
      : 'Connecting…'
  );
}

async function loadRates() {
  try {
    const res = await fetch('/api/rates', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    renderAll(data);
  } catch (err) {
    console.error(err);
    setStatus('Live data unavailable');
  }
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

loadRates();
setInterval(loadRates, 3000);
