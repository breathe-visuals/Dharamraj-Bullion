/* ================================================================
   Dharamraj Silver Arts — app.js  v8
   Config-driven. Coin rates. PNG share. Call modal.
   ─ Boot:    fetch /api/config → store CFG → connect socket
   ─ Render:  socket rates:update → incremental DOM updates
   ================================================================ */

'use strict';

/* ── Global config & socket ─────────────────────────────────── */
let CFG = null;   /* { site:{}, admin:{} } */
let socket = null;

/* ── Previous-state maps ────────────────────────────────────── */
const prev = {
  future: {},
  spot: {},
  goldProducts: {},
  silverProducts: {},
  goldCoinBase: null,
  silverCoinBase: null,
};

/* ── Highlight linger store (3-second green/red) ─────────────── */
const highlights = {};

/* ── Latest rates snapshot — used by PNG generator ───────────── */
let lastRatesData = null;

/* ── DOM refs ────────────────────────────────────────────────── */
const dom = {
  status: document.getElementById('status'),
  lastUpdated: document.getElementById('lastUpdated'),
  futureBox: document.getElementById('futureBox'),
  futureBoxMobile: document.getElementById('futureBoxMobile'),
  spotBox: document.getElementById('spotBox'),
  spotBoxMobile: document.getElementById('spotBoxMobile'),
  goldProductsBox: document.getElementById('goldProductsBox'),
  silverProductsBox: document.getElementById('silverProductsBox'),
  goldCoinBox: document.getElementById('goldCoinBox'),
  silverCoinBox: document.getElementById('silverCoinBox'),
  slider: document.getElementById('rateSlider'),
  dots: Array.from(document.querySelectorAll('.dot')),
  goldDots: Array.from(document.querySelectorAll('.gold-dot')),
};

/* ================================================================
   KARAT LAYOUT MANAGER (Desktop vs Mobile)
   ================================================================ */
function manageKaratLayout() {
  const karatBlock = document.getElementById('karat-content-block');
  const desktopContainer = document.getElementById('desktop-karat-container');
  const mobileContainer = document.getElementById('mobile-karat-container');

  if (!karatBlock || !desktopContainer || !mobileContainer) return;

  if (window.innerWidth >= 992) {
    if (karatBlock.parentNode !== desktopContainer) {
      desktopContainer.appendChild(karatBlock);
      desktopContainer.classList.remove('hidden');
    }
  } else {
    if (karatBlock.parentNode !== mobileContainer) {
      mobileContainer.appendChild(karatBlock);
      desktopContainer.classList.add('hidden');
    }
  }
}
window.addEventListener('resize', manageKaratLayout);

/* ================================================================
   BOOT SEQUENCE
   ================================================================ */
(async function boot() {
  try {
    const res = await fetch('/api/config');
    CFG = await res.json();
  } catch (e) {
    console.error('[boot] Config fetch failed:', e);
    CFG = { site: {}, admin: {} };
  }

  manageKaratLayout();
  connectSocket();
  initSlider();
  initGoldSlider();
})();

/* ================================================================
   UTILITIES
   ================================================================ */
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
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

/* ================================================================
   CHANGE DETECTION — 3-second linger
   ================================================================ */
function dirClass(cur, prv, key) {
  const c = toNum(cur), p = toNum(prv);
  const now = Date.now();
  if (c !== null && p !== null) {
    if (c > p) highlights[key] = { dir: 'up', expiresAt: now + 3000 };
    else if (c < p) highlights[key] = { dir: 'down', expiresAt: now + 3000 };
  }
  const h = highlights[key];
  return (h && now < h.expiresAt) ? h.dir : 'same';
}

/* ================================================================
   TABLE BUILDERS
   ================================================================ */
function updateCell(el, current, previous, key, defaultClass = '') {
  if (!el) return;
  const chip = el.querySelector('.chip-val');
  if (!chip) return;
  const cf = fmt(current);
  if (chip.textContent !== cf) chip.textContent = cf;
  const nc = defaultClass ? `chip-val ${defaultClass}` : `chip-val ${dirClass(current, previous, key)}`;
  if (chip.className !== nc) chip.className = nc;
}

function buildTableHTML(rows, prevMap, colLabel) {
  const trs = rows.map(row => {
    const cur = rowToPlain(row);
    const prv = prevMap[itemKey(cur)] || {};
    const k = itemKey(cur);
    return `<tr data-key="${k}">
      <td class="rowhead">${escape(symbolLabel(cur.symbol, cur.name))}</td>
      <td class="cell-bid"><span class="chip-val ${dirClass(cur.bid, prv.bid, k + '-bid')}">${fmt(cur.bid)}</span></td>
      <td class="cell-ask"><span class="chip-val ${dirClass(cur.ask, prv.ask, k + '-ask')}">${fmt(cur.ask)}</span></td>
      <td class="cell-high"><span class="chip-val always-green">${fmt(cur.high)}</span></td>
      <td class="cell-low"><span class="chip-val always-red">${fmt(cur.low)}</span></td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr>
      <th>${escape(colLabel)}</th>
      <th>Buy</th><th>Sell</th><th>High</th><th>Low</th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
}

function renderTable(container, rows, prevMap, type) {
  if (!container) return;
  if (!rows?.length) {
    container.innerHTML = '<p class="empty-msg">No data yet.</p>';
    return;
  }
  const colLabel = type === 'mini' ? 'Product' : 'Symbol';
  const table = container.querySelector('table');
  const tbody = table?.querySelector('tbody');
  const trs = tbody ? Array.from(tbody.querySelectorAll('tr:not(.apx-tr)')) : [];
  let rebuild = !table || trs.length !== rows.length;

  if (!rebuild) {
    const existingKeys = new Set(trs.map(t => t.getAttribute('data-key')));
    for (const r of rows) {
      if (!existingKeys.has(itemKey(rowToPlain(r)))) { rebuild = true; break; }
    }
  }

  if (rebuild) {
    container.innerHTML = buildTableHTML(rows, prevMap, colLabel);
  } else {
    rows.forEach((row) => {
      const cur = rowToPlain(row);
      const k = itemKey(cur);
      const tr = tbody.querySelector(`tr[data-key="${k}"]`);
      if (tr) {
        const prv = prevMap[k] || {};
        updateCell(tr.querySelector('.cell-bid'), cur.bid, prv.bid, k + '-bid');
        updateCell(tr.querySelector('.cell-ask'), cur.ask, prv.ask, k + '-ask');
        updateCell(tr.querySelector('.cell-high'), cur.high, null, null, 'always-green');
        updateCell(tr.querySelector('.cell-low'), cur.low, null, null, 'always-red');
      }
    });
  }
}

function updatePrevMap(rows) {
  const map = {};
  (rows || []).forEach(r => { const k = itemKey(r); if (k) map[k] = rowToPlain(r); });
  return map;
}

/* ================================================================
   APX ROW INJECTOR — appends BEFORE GST row to product tables
   ================================================================ */
function renderApxTableRow(containerId, label, apxData) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const table = container.querySelector('table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  const sell = apxData?.sell ?? null;
  const high = apxData?.high ?? null;
  const low = apxData?.low ?? null;
  const sellTxt = sell !== null ? String(sell) : '—';
  const highTxt = high !== null ? String(high) : '—';
  const lowTxt = low !== null ? String(low) : '—';
  const rowId = containerId + '-apx';

  let tr = document.getElementById(rowId);
  if (!tr) {
    tr = document.createElement('tr');
    tr.className = 'apx-tr';
    tr.id = rowId;
    tr.innerHTML = `
      <td class="rowhead apx-tr-name">${escape(label)}</td>
      <td class="cell-bid"><span class="chip-val">—</span></td>
      <td class="cell-ask"><span class="chip-val apx-chip" id="${rowId}-sell">${sellTxt}</span></td>
      <td class="cell-high"><span class="chip-val always-green" id="${rowId}-high">${highTxt}</span></td>
      <td class="cell-low"><span class="chip-val always-red" id="${rowId}-low">${lowTxt}</span></td>
    `;
    tbody.appendChild(tr);
  } else {
    const elSell = document.getElementById(rowId + '-sell');
    const elHigh = document.getElementById(rowId + '-high');
    const elLow = document.getElementById(rowId + '-low');
    if (elSell && elSell.textContent !== sellTxt) elSell.textContent = sellTxt;
    if (elHigh && elHigh.textContent !== highTxt) elHigh.textContent = highTxt;
    if (elLow && elLow.textContent !== lowTxt) elLow.textContent = lowTxt;
  }
}

/* ================================================================
   COIN TABLE RENDERER
   Formula: price = round((baseVal/divisor * grams + premiumPerGram * grams) * (1 + premiumPercent/100))
   ================================================================ */
function renderCoinTable(containerId, configRows, baseVal, divisor, premiumPerGram, premiumPercent, prevKey) {
  const container = document.getElementById(containerId);
  if (!container || !configRows?.length) return;

  const baseRaw = toNum(baseVal);
  const base1u = baseRaw !== null ? baseRaw / divisor : null;
  const pctFactor = 1 + (premiumPercent || 0) / 100;

  const table = container.querySelector('.coin-table');
  const tbody = table?.querySelector('tbody');

  if (!table || !tbody) {
    /* First render — build full table */
    const rows = configRows.map((c, i) => {
      const price = base1u !== null
        ? Math.round((base1u * c.grams + premiumPerGram * c.grams) * pctFactor)
        : null;
      return `<tr data-coin="${escape(c.name)}">
        <td class="rowhead">${escape(c.name)}</td>
        <td><span class="coin-price" id="${containerId}-r${i}">${price !== null ? price.toLocaleString('en-IN') : '—'}</span></td>
      </tr>`;
    }).join('');

    container.innerHTML = `<table class="coin-table">
      <thead><tr><th>Product</th><th>Price (₹)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  } else {
    /* Incremental update */
    configRows.forEach((c, i) => {
      const el = document.getElementById(`${containerId}-r${i}`);
      if (!el) return;

      const price = base1u !== null
        ? Math.round((base1u * c.grams + premiumPerGram * c.grams) * pctFactor)
        : null;
      const prevBase = prev[prevKey];
      const prevU = prevBase !== null ? prevBase / divisor : null;
      const prevP = prevU !== null
        ? Math.round((prevU * c.grams + premiumPerGram * c.grams) * pctFactor)
        : null;

      const text = price !== null ? price.toLocaleString('en-IN') : '—';
      if (el.textContent !== text) el.textContent = text;

      if (price !== null && prevP !== null) {
        el.className = price > prevP ? 'coin-price up' : price < prevP ? 'coin-price down' : 'coin-price';
      }
    });
  }

  prev[prevKey] = baseRaw;
}

/* ================================================================
   KARAT GRID RENDERER
   Updates the Mahakali-style karat card grid in the gold swipe slide.
   Cards are static in HTML; this function just updates their prices.
   Karats: 24, 22, 21, 20, 18, 14, 9
   ================================================================ */
const prevKaratPrices = {};

function renderKaratGrid(karatRates) {
  if (!karatRates || !karatRates.length) return;

  karatRates.forEach(k => {
    const el = document.getElementById(`kp-${k.karat}`);
    if (!el) return;

    const prevPrice = prevKaratPrices[k.karat] ?? null;
    const text = k.ask !== null ? k.ask.toLocaleString('en-IN') : '—';
    const cls = k.ask !== null && prevPrice !== null
      ? (k.ask > prevPrice ? 'karat-price up' : k.ask < prevPrice ? 'karat-price down' : 'karat-price')
      : 'karat-price';

    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;

    prevKaratPrices[k.karat] = k.ask;
  });
}

/* ================================================================
   MASTER RENDER — called on every socket rates:update
   ================================================================ */
function renderAll(data) {
  lastRatesData = data;
  const admin = CFG?.admin || {};

  /* Product tables (desktop + mobile share same data) */
  renderTable(dom.goldProductsBox, data?.goldProducts, prev.goldProducts, 'mini');
  renderTable(dom.silverProductsBox, data?.silverProducts, prev.silverProducts, 'mini');

  /* Market rate tables — desktop cards + mobile slider */
  renderTable(dom.futureBox, data?.futureRows, prev.future, 'rate');
  renderTable(dom.futureBoxMobile, data?.futureRows, prev.future, 'rate');
  renderTable(dom.spotBox, data?.spotRows, prev.spot, 'rate');
  renderTable(dom.spotBoxMobile, data?.spotRows, prev.spot, 'rate');

  /* Karat rates — update karat card grid in gold swipe slide */
  if (data?.karatRates) {
    renderKaratGrid(data.karatRates);
  }

  /* Coin tables */
  const goldDiv = admin.goldCoins?.divisor || 10;
  const silverDiv = admin.silverCoins?.divisor || 1000;
  const goldPremiumPerGram = admin.goldCoins?.premiumPerGram ?? 0;
  const silverPremiumPerGram = admin.silverCoins?.premiumPerGram ?? 12;
  const goldPremiumPercent = admin.goldCoins?.premiumPercent ?? 1;
  const silverPremiumPercent = admin.silverCoins?.premiumPercent ?? 0;

  renderCoinTable('goldCoinBox', admin.goldCoins?.rows, data?.goldCoinBase, goldDiv, goldPremiumPerGram, goldPremiumPercent, 'goldCoinBase');
  renderCoinTable('silverCoinBox', admin.silverCoins?.rows, data?.silverCoinBase, silverDiv, silverPremiumPerGram, silverPremiumPercent, 'silverCoinBase');

  /* Advance prev maps */
  prev.goldProducts = updatePrevMap(data?.goldProducts);
  prev.silverProducts = updatePrevMap(data?.silverProducts);
  prev.future = updatePrevMap(data?.futureRows);
  prev.spot = updatePrevMap(data?.spotRows);

  /* Timestamp */
  const ts = data?.updatedAt ? new Date(data.updatedAt) : null;
  dom.lastUpdated.textContent = ts
    ? ts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  /* Connection status */
  const live = data?.connected?.gopnath || data?.connected?.swayam;
  setStatus(live ? 'live' : 'connecting');
}

/* ================================================================
   STATUS INDICATOR
   ================================================================ */
function setStatus(state) {
  if (!dom.status) return;
  dom.status.className = 'status-dot ' + state;
  dom.status.title = state === 'live' ? 'Connected – live' : 'Connecting…';
}

/* ================================================================
   SOCKET
   ================================================================ */
function connectSocket() {
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => setStatus('live'));
  socket.on('disconnect', () => setStatus('disconnected'));
  socket.on('connect_error', () => setStatus('disconnected'));
  socket.on('rates:update', renderAll);
}

/* ================================================================
   COIN TAB SWITCHING
   ================================================================ */
function switchCoinTab(tabId) {
  document.querySelectorAll('.coin-panel').forEach(el => {
    el.classList.toggle('hidden', el.id !== 'panel-' + tabId);
  });
  document.querySelectorAll('.coin-tab').forEach(btn => {
    const on = btn.id === 'tab-' + tabId;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on);
  });
}

/* ================================================================
   GOLD CARD SLIDER (in-card swipe: Products ↔ Karat Rates)
   ================================================================ */
function initGoldSlider() {
  /* Swipe layout removed for Gold Products */
}

/* ================================================================
   SLIDER (mobile)
   ================================================================ */
function initSlider() {
  const track = dom.slider;
  if (!track) return;

  function updateDots(index) {
    dom.dots.forEach((d, i) => d.classList.toggle('active', i === index));
  }

  dom.dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      const cards = track.querySelectorAll('.slider-card');
      if (cards[i]) cards[i].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    });
  });

  let scrollTimer;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const cards = Array.from(track.querySelectorAll('.slider-card'));
      const scrollLeft = track.scrollLeft;
      let closest = 0, minDist = Infinity;
      cards.forEach((card, i) => {
        const dist = Math.abs(card.offsetLeft - scrollLeft);
        if (dist < minDist) { minDist = dist; closest = i; }
      });
      updateDots(closest);
    }, 50);
  }, { passive: true });
}

/* ================================================================
   CALL MODAL
   ================================================================ */
/* ── SVG icon helpers ── */
const ICON = {
  phone: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.97-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 17z"/></svg>`,
  whatsapp: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.484 2 12.017c0 1.987.518 3.849 1.426 5.462L2 22l4.672-1.396A9.938 9.938 0 0 0 12 22c5.523 0 10-4.484 10-10.017C22 6.476 17.523 2 12 2zm0 18.033a8.014 8.014 0 0 1-4.073-1.112l-.292-.173-3.02.902.9-2.996-.19-.308A8.027 8.027 0 0 1 4 12.017C4 7.588 7.589 4 12 4c4.411 0 8 3.588 8 8.017 0 4.428-3.589 8.016-8 8.016z"/></svg>`,
  gold: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>`,
  silver: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  coin: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v2m0 8v2M9.17 9.17A4 4 0 1 0 14.83 14.83"/></svg>`,
  image: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
};

function showCallModal() {
  const biz = CFG?.site?.business || {};
  const phone = biz.phone || '+91 99131 37069';
  const phone2 = biz.phone2 || '';
  const whatsapp = biz.whatsapp || '';

  /* If only one number and no whatsapp, dial directly */
  if (phone && !phone2 && !whatsapp) {
    window.location.href = 'tel:' + phone.replace(/\s/g, '');
    return;
  }

  document.querySelector('.share-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'share-overlay call-overlay';
  overlay.innerHTML = `
    <div class="share-modal">
      <h3 class="share-modal-title">Contact Us</h3>
      <p class="share-modal-sub">Choose an option to reach us:</p>
      <div class="share-opts">
        ${phone ? `
          <a href="tel:${phone.replace(/\s/g, '')}" class="share-opt-btn" style="text-decoration:none;">
            <span class="share-opt-icon">${ICON.phone}</span>
            <span>${escape(phone)}</span>
          </a>` : ''}
        ${phone2 ? `
          <a href="tel:${phone2.replace(/\s/g, '')}" class="share-opt-btn" style="text-decoration:none;">
            <span class="share-opt-icon">${ICON.phone}</span>
            <span>${escape(phone2)}</span>
          </a>` : ''}
        ${whatsapp ? `
          <a href="https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}" class="share-opt-btn" style="text-decoration:none;" target="_blank">
            <span class="share-opt-icon">${ICON.whatsapp}</span>
            <span>WhatsApp</span>
          </a>` : ''}
      </div>
      <button class="share-cancel-btn" onclick="document.querySelector('.call-overlay')?.remove()">Cancel</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

/* ================================================================
   SHARE RATES — choose which section to share as PNG
   ================================================================ */
function shareRates() {
  document.querySelector('.share-overlay')?.remove();
  const admin = CFG?.admin || {};

  const opts = [];
  if (admin.sections?.goldProducts !== false) opts.push({ id: 'gold', label: 'Gold Products', icon: ICON.gold });
  if (admin.sections?.silverProducts !== false) opts.push({ id: 'silver', label: 'Silver Products', icon: ICON.silver });
  if (admin.sections?.coinRates !== false) opts.push({ id: 'coins', label: 'Coin Rates', icon: ICON.coin });

  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  overlay.innerHTML = `
    <div class="share-modal">
      <h3 class="share-modal-title">Share Rate Card</h3>
      <p class="share-modal-sub">Choose which rates to generate as an image:</p>
      <div class="share-opts">
        ${opts.map(o => `
          <button class="share-opt-btn" id="sopt-${o.id}" onclick="doSharePage('${o.id}')">
            <span class="share-opt-icon">${o.icon}</span>
            <span>${o.label}</span>
          </button>`).join('')}
      </div>
      <button class="share-cancel-btn" onclick="document.querySelector('.share-overlay')?.remove()">Cancel</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function doSharePage(pageId) {
  const btn = document.getElementById('sopt-' + pageId);
  const lbl = btn?.querySelector('span:last-child');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('share-generating');
    if (lbl) lbl.textContent = 'Generating…';
  }
  try {
    const blob = await generateRateImage(pageId);
    if (!blob) throw new Error('empty blob');
    document.querySelector('.share-overlay')?.remove();

    const biz = CFG?.site?.business || {};
    const fname = `${(biz.name || 'dharamraj-rates').replace(/\s+/g, '-').toLowerCase()}-${pageId}-${new Date().toISOString().slice(0, 10)}.png`;
    const file = new File([blob], fname, { type: 'image/png' });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `${biz.name || 'Live Rates'} – ${pageId}` });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      document.querySelector('.share-overlay')?.remove();
      console.error('[share]', err);
    }
  }
}

/* ================================================================
   GENERATE RATE IMAGE — Canvas-based PNG (no external libs)
   ================================================================ */
async function generateRateImage(pageId) {
  const site = CFG?.site || {};
  const admin = CFG?.admin || {};
  const biz = site.business || {};
  const theme = site.theme || {};
  const data = lastRatesData || {};

  const BRAND = theme.primaryColor || '#003336';
  const GOLD = theme.accentColor || '#d9b25f';

  const W = 1080;
  const PAD = 52;
  const RLINE = 48;

  const isGold = pageId === 'gold';
  const isSilver = pageId === 'silver';
  const isCoins = pageId === 'coins';

  const goldProds = isGold ? (data.goldProducts || []) : [];
  const karatRates = isGold ? (data.karatRates || []) : [];
  const silvProds = isSilver ? (data.silverProducts || []) : [];

  const gcRows = isCoins ? (admin.goldCoins?.rows || []) : [];
  const scRows = isCoins ? (admin.silverCoins?.rows || []) : [];
  const gcBase = isCoins ? toNum(data.goldCoinBase) : null;
  const scBase = isCoins ? toNum(data.silverCoinBase) : null;
  const gcDiv = admin.goldCoins?.divisor || 10;
  const scDiv = admin.silverCoins?.divisor || 1000;
  const gcPPG = admin.goldCoins?.premiumPerGram ?? 0;
  const scPPG = admin.silverCoins?.premiumPerGram ?? 12;
  const gcPct = admin.goldCoins?.premiumPercent ?? 1;
  const scPct = admin.silverCoins?.premiumPercent ?? 0;

  /* ── Height calculation ── */
  const HDR_H = 180;
  const SEC_H = 40;
  const FOOT_H = 110;
  let H = HDR_H;

  if (goldProds.length) H += SEC_H + RLINE + goldProds.length * RLINE + 28;
  if (karatRates.length) H += SEC_H + RLINE + karatRates.length * RLINE + 28;
  if (silvProds.length) H += SEC_H + RLINE + silvProds.length * RLINE + 28;
  if (gcRows.length && gcBase !== null) H += SEC_H + RLINE + gcRows.length * RLINE + 28;
  if (scRows.length && scBase !== null) H += SEC_H + RLINE + scRows.length * RLINE + 28;
  if (isCoins && (gcRows.length || scRows.length)) H += 50;
  H += FOOT_H;
  H = Math.max(H, 640);

  /* ── Canvas ── */
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  /* Background gradient */
  const bgGrd = ctx.createLinearGradient(0, 0, 0, H);
  bgGrd.addColorStop(0, BRAND);
  bgGrd.addColorStop(0.55, '#032a2e');
  bgGrd.addColorStop(1, '#01161a');
  ctx.fillStyle = bgGrd;
  ctx.fillRect(0, 0, W, H);

  /* Subtle gold corner glow */
  const glw = ctx.createRadialGradient(W, 0, 0, W, 0, 360);
  glw.addColorStop(0, 'rgba(217,178,95,0.10)');
  glw.addColorStop(1, 'transparent');
  ctx.fillStyle = glw;
  ctx.fillRect(0, 0, W, H);

  let y = PAD;

  /* ── Logo ── */
  let logoImg = null;
  const logoSrc = biz.logo || '/Media/Dharamraj_Logo-1000x1000.png';
  try {
    logoImg = await Promise.race([
      new Promise((res, rej) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = logoSrc;
      }),
      new Promise((_, rej) => setTimeout(rej, 3000)),
    ]);
  } catch { }

  if (logoImg) {
    const lh = 90;
    const lw = Math.min((logoImg.naturalWidth / logoImg.naturalHeight) * lh, 280);
    ctx.drawImage(logoImg, PAD, y, lw, lh);
  } else {
    ctx.fillStyle = GOLD; ctx.font = 'bold 38px Inter,Arial,sans-serif';
    ctx.fillText(biz.name || 'Dharamraj Silver Arts', PAD, y + 54);
  }

  /* Date & time right-aligned */
  const now = new Date();
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.40)'; ctx.font = '13px Inter,Arial,sans-serif';
  ctx.fillText(now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), W - PAD, y + 28);
  ctx.fillStyle = GOLD; ctx.font = 'bold 26px Inter,Arial,sans-serif';
  ctx.fillText(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), W - PAD, y + 64);
  ctx.textAlign = 'left';
  y += 116;

  /* Gold divider */
  const divGrd = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  divGrd.addColorStop(0, 'transparent');
  divGrd.addColorStop(0.1, GOLD);
  divGrd.addColorStop(0.9, GOLD);
  divGrd.addColorStop(1, 'transparent');
  ctx.fillStyle = divGrd; ctx.fillRect(PAD, y, W - PAD * 2, 1.5); y += 24;

  /* Column x-positions */
  const NM_X = PAD + 12;
  const BUY_X = 570;
  const SELL_X = 720;
  const HIGH_X = 870;
  const LOW_X = W - PAD - 4;
  const NAME_MAX_W = BUY_X - NM_X - 20;

  /* ── Product table helper ── */
  function drawProdTable(title, titleCol, rows) {
    if (!rows.length) return;
    ctx.fillStyle = titleCol; ctx.font = 'bold 18px Inter,Arial,sans-serif';
    ctx.fillText(title, PAD, y + 24); y += 38;

    /* Header row */
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 12px Inter,Arial,sans-serif';
    ctx.fillText('PRODUCT', NM_X, y + 30);
    ctx.textAlign = 'right';
    ctx.fillText('BUY', BUY_X, y + 30);
    ctx.fillText('SELL', SELL_X, y + 30);
    ctx.fillText('HIGH', HIGH_X, y + 30);
    ctx.fillText('LOW', LOW_X, y + 30);
    ctx.textAlign = 'left'; y += RLINE;

    rows.forEach((p, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(NM_X, y, NAME_MAX_W, RLINE); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '15px Inter,Arial,sans-serif';
      ctx.fillText(String(p.name || p.symbol || ''), NM_X, y + 31);
      ctx.restore();

      ctx.textAlign = 'right'; ctx.font = 'bold 18px Inter,Arial,sans-serif';
      if (p.bid != null) { ctx.fillStyle = '#86efac'; ctx.fillText(String(p.bid), BUY_X, y + 31); }
      if (p.ask != null) { ctx.fillStyle = '#fca5a5'; ctx.fillText(String(p.ask), SELL_X, y + 31); }
      if (p.high != null) { ctx.fillStyle = '#86efac'; ctx.fillText(String(p.high), HIGH_X, y + 31); }
      if (p.low != null) { ctx.fillStyle = '#fca5a5'; ctx.fillText(String(p.low), LOW_X, y + 31); }
      ctx.textAlign = 'left'; y += RLINE;
    });

    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(PAD, y, W - PAD * 2, 1); y += 26;
  }

  /* ── Coin table helper ── */
  function drawCoinTable(title, titleCol, rows, baseVal, divisor, premiumPerGram, premiumPercent) {
    if (!rows.length || baseVal === null) return;
    const base1u = baseVal / divisor;
    const pctFactor = 1 + (premiumPercent || 0) / 100;
    const COIN_NAME_W = (W - PAD * 2) * 0.64;

    ctx.fillStyle = titleCol; ctx.font = 'bold 18px Inter,Arial,sans-serif';
    ctx.fillText(title, PAD, y + 24); y += 38;

    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 12px Inter,Arial,sans-serif';
    ctx.fillText('PRODUCT', PAD + 12, y + 30);
    ctx.textAlign = 'right'; ctx.fillText('PRICE (₹)', W - PAD, y + 30);
    ctx.textAlign = 'left'; y += RLINE;

    rows.forEach((c, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
      }
      const price = Math.round((base1u * c.grams + premiumPerGram * c.grams) * pctFactor);
      ctx.save();
      ctx.beginPath(); ctx.rect(PAD + 12, y, COIN_NAME_W, RLINE); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '15px Inter,Arial,sans-serif';
      ctx.fillText(String(c.name || ''), PAD + 12, y + 31);
      ctx.restore();
      ctx.textAlign = 'right'; ctx.fillStyle = GOLD; ctx.font = 'bold 22px Inter,Arial,sans-serif';
      ctx.fillText('₹' + price.toLocaleString('en-IN'), W - PAD, y + 31);
      ctx.textAlign = 'left'; y += RLINE;
    });

    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(PAD, y, W - PAD * 2, 1); y += 26;
  }

  /* ── Karat table helper ── */
  function drawKaratTable(title, titleCol, rows) {
    if (!rows || !rows.length) return;
    ctx.fillStyle = titleCol; ctx.font = 'bold 18px Inter,Arial,sans-serif';
    ctx.fillText(title, PAD, y + 24); y += 38;

    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 12px Inter,Arial,sans-serif';
    ctx.fillText('KARAT', PAD + 12, y + 30);
    ctx.textAlign = 'right'; ctx.fillText('PRICE (per 10g)', W - PAD, y + 30);
    ctx.textAlign = 'left'; y += RLINE;

    rows.forEach((k, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 16px Inter,Arial,sans-serif';
      ctx.fillText(k.karat + 'K', PAD + 12, y + 31);

      ctx.textAlign = 'right'; ctx.fillStyle = GOLD; ctx.font = 'bold 22px Inter,Arial,sans-serif';
      const txt = k.ask !== null ? '₹' + k.ask.toLocaleString('en-IN') : '—';
      ctx.fillText(txt, W - PAD, y + 31);
      ctx.textAlign = 'left'; y += RLINE;
    });

    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(PAD, y, W - PAD * 2, 1); y += 26;
  }

  /* ── Draw content ── */
  drawProdTable('GOLD PRODUCTS', GOLD, goldProds);
  drawKaratTable('KARAT RATES', GOLD, karatRates);
  drawProdTable('SILVER PRODUCTS', '#94a3b8', silvProds);
  drawCoinTable('GOLD COINS', GOLD, gcRows, gcBase, gcDiv, gcPPG, gcPct);
  drawCoinTable('SILVER COINS', '#94a3b8', scRows, scBase, scDiv, scPPG, scPct);

  /* Coin disclaimer */
  if (isCoins && (gcRows.length || scRows.length)) {
    ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.font = 'italic 13px Inter,Arial,sans-serif';
    ctx.fillText('Rates are exclusive of making charges and packing charges.*', PAD, y + 22);
    y += 46;
  }

  /* ── Footer ── */
  const fy = Math.max(y + 10, H - FOOT_H);
  ctx.fillStyle = divGrd; ctx.fillRect(PAD, fy, W - PAD * 2, 1.5);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '14px Inter,Arial,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Rates are for reference only. Contact office for booking.', W / 2, fy + 30);
  const phone = biz.phone || '+91 99131 37069';
  if (phone) {
    ctx.fillStyle = GOLD; ctx.font = 'bold 20px Inter,Arial,sans-serif';
    ctx.fillText(phone, W / 2, fy + 62);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.font = '11px Inter,Arial,sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Dharamraj Silver Arts – Live Rates', W - PAD, H - 12);
  ctx.textAlign = 'left';

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
}
