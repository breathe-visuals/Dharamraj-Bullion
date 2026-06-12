/* ================================================================
   Dharamraj Silver Arts — app.js
   Socket.IO client. All live logic preserved.
   ================================================================ */

const socket = io({ transports: ['websocket', 'polling'] });

/* DOM refs */
const dom = {
  status:           document.getElementById('status'),
  lastUpdated:      document.getElementById('lastUpdated'),
  futureBox:        document.getElementById('futureBox'),
  spotBox:          document.getElementById('spotBox'),
  goldProductsBox:  document.getElementById('goldProductsBox'),
  silverProductsBox:document.getElementById('silverProductsBox'),
  slider:           document.getElementById('rateSlider'),
  dots:             Array.from(document.querySelectorAll('.dot')),
};

/* Previous state for change detection */
const prev = {
  future:         {},
  spot:           {},
  goldProducts:   {},
  silverProducts: {},
};

/* Highlight duration store: key → { dir, expiresAt } */
const highlights = {};

/* ── Utilities ─────────────────────────────────────── */
function toNum(val) {
  if (val == null) return null;
  const n = Number(String(val).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function fmt(val) {
  const n = toNum(val);
  return n === null ? '—' : String(n);
}

function escape(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function itemKey(row) {
  return String(row?.symbol || row?.name || '').toLowerCase();
}

function rowToPlain(row) {
  return {
    symbol: String(row?.symbol || '').toLowerCase(),
    name:   row?.name || '',
    bid:    toNum(row?.bid),
    ask:    toNum(row?.ask),
    high:   toNum(row?.high),
    low:    toNum(row?.low),
  };
}

function symbolLabel(sym, fallback) {
  const s = String(sym || '').toLowerCase();
  const map = {
    gold: 'Gold', silver: 'Silver',
    goldnext: 'Gold Next', silvernext: 'Silver Next',
    xauusd: 'XAU/USD', xagusd: 'XAG/USD', inrspot: 'INR Spot',
  };
  return map[s] || fallback || s.toUpperCase();
}

/* ── Change-class with 3-second linger ─────────────── */
function dirClass(cur, prv, key) {
  const c = toNum(cur), p = toNum(prv);
  const now = Date.now();

  if (c !== null && p !== null) {
    if (c > p) highlights[key] = { dir: 'up',   expiresAt: now + 3000 };
    else if (c < p) highlights[key] = { dir: 'down', expiresAt: now + 3000 };
  }

  const h = highlights[key];
  return (h && now < h.expiresAt) ? h.dir : 'same';
}

/* ── Table builders ────────────────────────────────── */
function buildRows(rows, prevMap, type) {
  if (!rows || !rows.length) return '<p class="empty-msg">No data yet.</p>';

  const colLabel = type === 'mini' ? 'Product' : 'Symbol';

  const trs = rows.map(row => {
    const cur = rowToPlain(row);
    const prv = prevMap[itemKey(cur)] || {};
    const k   = itemKey(cur);

    const bidCls  = dirClass(cur.bid,  prv.bid,  k + '-bid');
    const askCls  = dirClass(cur.ask,  prv.ask,  k + '-ask');

    return `
      <tr>
        <td class="rowhead">${escape(symbolLabel(cur.symbol, cur.name))}</td>
        <td><span class="chip-val ${bidCls}">${fmt(cur.bid)}</span></td>
        <td><span class="chip-val ${askCls}">${fmt(cur.ask)}</span></td>
        <td><span class="chip-val always-green">${fmt(cur.high)}</span></td>
        <td><span class="chip-val always-red">${fmt(cur.low)}</span></td>
      </tr>`;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>${escape(colLabel)}</th>
          <th>Buy</th><th>Sell</th>
          <th>High</th><th>Low</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>`;
}

function updatePrevMap(rows) {
  const map = {};
  (rows || []).forEach(r => { const k = itemKey(r); if (k) map[k] = rowToPlain(r); });
  return map;
}

/* ── Render all sections ───────────────────────────── */
function renderAll(data) {
  /* Gold / silver product tables */
  dom.goldProductsBox.innerHTML  = buildRows(data?.goldProducts   || [], prev.goldProducts,   'mini');
  dom.silverProductsBox.innerHTML= buildRows(data?.silverProducts || [], prev.silverProducts,  'mini');

  /* Future & spot rate tables */
  dom.futureBox.innerHTML = buildRows(data?.futureRows || [], prev.future, 'rate');
  dom.spotBox.innerHTML   = buildRows(data?.spotRows   || [], prev.spot,   'rate');

  /* Advance previous-state */
  prev.goldProducts   = updatePrevMap(data?.goldProducts);
  prev.silverProducts = updatePrevMap(data?.silverProducts);
  prev.future         = updatePrevMap(data?.futureRows);
  prev.spot           = updatePrevMap(data?.spotRows);

  /* Timestamp */
  const ts = data?.updatedAt ? new Date(data.updatedAt) : null;
  dom.lastUpdated.textContent = ts
    ? ts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  /* Connection status */
  const live = data?.connected?.gopnath || data?.connected?.swayam;
  setStatus(live ? 'live' : 'connecting');
}

/* ── Status indicator ──────────────────────────────── */
function setStatus(state) {
  dom.status.className = 'status-dot ' + state;
  dom.status.title     = state === 'live' ? 'Connected – live' : 'Connecting…';
}

/* ── Socket events ─────────────────────────────────── */
socket.on('connect',       () => setStatus('live'));
socket.on('disconnect',    () => setStatus('disconnected'));
socket.on('connect_error', () => setStatus('disconnected'));
socket.on('rates:update',  renderAll);

/* ── Slider swipe / dot sync ───────────────────────── */
(function initSlider() {
  const track = dom.slider;
  if (!track) return;

  function updateDots(index) {
    dom.dots.forEach((d, i) => d.classList.toggle('active', i === index));
  }

  /* Dot click → scroll to card */
  dom.dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      const cards = track.querySelectorAll('.slider-card');
      if (cards[i]) cards[i].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    });
  });

  /* Scroll → update dots */
  let scrollTimer;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const cards = Array.from(track.querySelectorAll('.slider-card'));
      const scrollLeft = track.scrollLeft;
      let closest = 0;
      let minDist = Infinity;
      cards.forEach((card, i) => {
        const dist = Math.abs(card.offsetLeft - scrollLeft);
        if (dist < minDist) { minDist = dist; closest = i; }
      });
      updateDots(closest);
    }, 50);
  }, { passive: true });
})();
