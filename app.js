const socket = io({
  transports: ['websocket', 'polling'],
});

const dom = {
  status: document.getElementById('status'),
  lastUpdated: document.getElementById('lastUpdated'),
  futureBox: document.getElementById('futureBox'),
  spotBox: document.getElementById('spotBox'),
  goldProductsBox: document.getElementById('goldProductsBox'),
  silverProductsBox: document.getElementById('silverProductsBox'),
  summaryTabs: Array.from(document.querySelectorAll('.summary-tab')),
};

const previousState = {
  summary: { gold: null, silver: null },
  future: {},
  spot: {},
  goldProducts: {},
  silverProducts: {},
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
    time: row?.time || '',
  };
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

function setStatus(text) {
  dom.status.textContent = text;
}

function updateTime(updatedAt) {
  const stamp = updatedAt ? new Date(updatedAt) : null;
  dom.lastUpdated.textContent = `Last updated: ${stamp ? stamp.toLocaleString() : '—'}`;
}

function renderSummaryCard(current, previous, title) {
  const item = current ? rowToPlain(current) : null;
  const prev = previous ? rowToPlain(previous) : null;
  const value = item ? (item.ask ?? item.bid) : null;

  return {
    value: value,
    buy: item?.bid ?? null,
    sell: item?.ask ?? null,
    high: item?.high ?? null,
    low: item?.low ?? null,
    title,
    diffClass: changeClass(value, prev ? (prev.ask ?? prev.bid) : null),
    buyClass: changeClass(item?.bid, prev?.bid),
    sellClass: changeClass(item?.ask, prev?.ask),
    highClass: changeClass(item?.high, prev?.high),
    lowClass: changeClass(item?.low, prev?.low),
  };
}

function renderMiniTable(rows, previousMap, emptyMessage) {
  if (!rows || !rows.length) {
    return `<p class="empty">${emptyMessage}</p>`;
  }

  const body = rows.map((row) => {
    const current = rowToPlain(row);
    const prev = previousMap[itemKey(current)] || {};

    return `
      <tr>
        <td class="rowhead">${escapeHtml(symbolLabel(current.symbol, current.name))}</td>
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
          <th>Product</th>
          <th>Buy</th>
          <th>Sell</th>
          <th>High</th>
          <th>Low</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderRateTable(rows, previousMap, emptyMessage) {
  if (!rows || !rows.length) {
    return `<p class="empty">${emptyMessage}</p>`;
  }

  const body = rows.map((row) => {
    const current = rowToPlain(row);
    const prev = previousMap[itemKey(current)] || {};

    return `
      <tr>
        <td class="rowhead">${escapeHtml(symbolLabel(current.symbol, current.name))}</td>
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
          <th>Symbol</th>
          <th>Buy</th>
          <th>Sell</th>
          <th>High</th>
          <th>Low</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderAll(data) {
  const gold = data?.summary?.gold || null;
  const silver = data?.summary?.silver || null;

  const goldView = renderSummaryCard(gold, previousState.summary.gold, 'Gold');
  const silverView = renderSummaryCard(silver, previousState.summary.silver, 'Silver');

  document.getElementById('goldCard').querySelector('.summary-value').innerHTML =
    `<span class="price ${goldView.diffClass}">${formatInr(goldView.value)}</span>`;
  document.getElementById('goldCard').querySelector('.summary-sub').textContent =
    gold ? 'Gold product table' : 'Waiting for gold data…';

  document.getElementById('goldCard').querySelector('.mini-table-wrap').innerHTML =
    renderMiniTable(data?.goldProducts || [], previousState.goldProducts, 'No gold products yet.');

  document.getElementById('silverCard').querySelector('.summary-value').innerHTML =
    `<span class="price ${silverView.diffClass}">${formatInr(silverView.value)}</span>`;
  document.getElementById('silverCard').querySelector('.summary-sub').textContent =
    silver ? 'Silver product table' : 'Waiting for silver data…';

  document.getElementById('silverCard').querySelector('.mini-table-wrap').innerHTML =
    renderMiniTable(data?.silverProducts || [], previousState.silverProducts, 'No silver products yet.');

  dom.futureBox.innerHTML = renderRateTable(
    data?.futureRows || [],
    previousState.future,
    'No future data yet.'
  );

  dom.spotBox.innerHTML = renderRateTable(
    data?.spotRows || [],
    previousState.spot,
    'No spot data yet.'
  );

  previousState.summary.gold = gold ? { ...gold } : null;
  previousState.summary.silver = silver ? { ...silver } : null;
  previousState.future = Object.fromEntries((data?.futureRows || []).map((row) => [itemKey(row), rowToPlain(row)]));
  previousState.spot = Object.fromEntries((data?.spotRows || []).map((row) => [itemKey(row), rowToPlain(row)]));
  previousState.goldProducts = Object.fromEntries((data?.goldProducts || []).map((row) => [itemKey(row), rowToPlain(row)]));
  previousState.silverProducts = Object.fromEntries((data?.silverProducts || []).map((row) => [itemKey(row), rowToPlain(row)]));

  updateTime(data?.updatedAt);
  setStatus(
    data?.connected?.gopnath || data?.connected?.swayam
      ? 'Live'
      : 'Connecting…'
  );
}

socket.on('connect', () => {
  setStatus('Connected');
});

socket.on('rates:update', (data) => {
  renderAll(data);
});

socket.on('disconnect', () => {
  setStatus('Disconnected');
});

dom.summaryTabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const card = document.getElementById(targetId);
    if (!card) return;

    dom.summaryTabs.forEach((b) => b.classList.toggle('active', b === btn));
    card.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  });
});
