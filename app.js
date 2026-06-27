/* ================================================================
   Dharamraj Silver Arts — app.js  v8
   Config-driven. Coin rates. PNG share. Call modal.
   ─ Boot:    fetch /api/config → store CFG → connect socket
   ─ Render:  socket rates:update → incremental DOM updates
   ================================================================ */

'use strict';

/* ── Global config & socket ─────────────────────────────────── */
let CFG    = null;   /* { site:{}, admin:{} } */
let socket = null;

/* ── Previous-state maps ────────────────────────────────────── */
const prev = {
  future:         {},
  spot:           {},
  goldProducts:   {},
  silverProducts: {},
  goldCoinBase:   null,
  silverCoinBase: null,
};

/* ── Highlight linger store (3-second green/red) ─────────────── */
const highlights = {};

/* ── Latest rates snapshot — used by PNG generator ───────────── */
let lastRatesData = null;

/* ── DOM refs ────────────────────────────────────────────────── */
const dom = {
  status:           document.getElementById('status'),
  lastUpdated:      document.getElementById('lastUpdated'),
  futureBox:        document.getElementById('futureBox'),
  futureBoxMobile:  document.getElementById('futureBoxMobile'),
  spotBox:          document.getElementById('spotBox'),
  spotBoxMobile:    document.getElementById('spotBoxMobile'),
  goldProductsBox:  document.getElementById('goldProductsBox'),
  silverProductsBox:document.getElementById('silverProductsBox'),
  goldCoinBox:      document.getElementById('goldCoinBox'),
  silverCoinBox:    document.getElementById('silverCoinBox'),
  slider:           document.getElementById('rateSlider'),
  dots:             Array.from(document.querySelectorAll('.dot')),
};

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

  connectSocket();
  initSlider();
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

/* ================================================================
   CHANGE DETECTION — 3-second linger
   ================================================================ */
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
    const k   = itemKey(cur);
    return `<tr data-key="${k}">
      <td class="rowhead">${escape(symbolLabel(cur.symbol, cur.name))}</td>
      <td class="cell-bid"><span class="chip-val ${dirClass(cur.bid, prv.bid, k+'-bid')}">${fmt(cur.bid)}</span></td>
      <td class="cell-ask"><span class="chip-val ${dirClass(cur.ask, prv.ask, k+'-ask')}">${fmt(cur.ask)}</span></td>
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
  const table  = container.querySelector('table');
  const tbody  = table?.querySelector('tbody');
  const trs    = tbody ? Array.from(tbody.querySelectorAll('tr:not(.apx-tr)')) : [];
  let rebuild  = !table || trs.length !== rows.length;

  if (!rebuild) {
    for (let i = 0; i < rows.length; i++) {
      if (trs[i].getAttribute('data-key') !== itemKey(rowToPlain(rows[i]))) { rebuild = true; break; }
    }
  }

  if (rebuild) {
    container.innerHTML = buildTableHTML(rows, prevMap, colLabel);
  } else {
    rows.forEach((row, i) => {
      const cur = rowToPlain(row);
      const prv = prevMap[itemKey(cur)] || {};
      const k   = itemKey(cur);
      const tr  = trs[i];
      updateCell(tr.querySelector('.cell-bid'),  cur.bid,  prv.bid,  k+'-bid');
      updateCell(tr.querySelector('.cell-ask'),  cur.ask,  prv.ask,  k+'-ask');
      updateCell(tr.querySelector('.cell-high'), cur.high, null, null, 'always-green');
      updateCell(tr.querySelector('.cell-low'),  cur.low,  null, null, 'always-red');
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

  const sell    = apxData?.sell ?? null;
  const high    = apxData?.high ?? null;
  const low     = apxData?.low  ?? null;
  const sellTxt = sell !== null ? String(sell) : '—';
  const highTxt = high !== null ? String(high) : '—';
  const lowTxt  = low  !== null ? String(low)  : '—';
  const rowId   = containerId + '-apx';

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
    const elLow  = document.getElementById(rowId + '-low');
    if (elSell && elSell.textContent !== sellTxt) elSell.textContent = sellTxt;
    if (elHigh && elHigh.textContent !== highTxt) elHigh.textContent = highTxt;
    if (elLow  && elLow.textContent  !== lowTxt)  elLow.textContent  = lowTxt;
  }
}

/* ================================================================
   COIN TABLE RENDERER
   Formula: price = round((baseVal/divisor * grams + premiumPerGram * grams) * (1 + premiumPercent/100))
   ================================================================ */
function renderCoinTable(containerId, configRows, baseVal, divisor, premiumPerGram, premiumPercent, prevKey) {
  const container = document.getElementById(containerId);
  if (!container || !configRows?.length) return;

  const baseRaw   = toNum(baseVal);
  const base1u    = baseRaw !== null ? baseRaw / divisor : null;
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

      const price    = base1u !== null
        ? Math.round((base1u * c.grams + premiumPerGram * c.grams) * pctFactor)
        : null;
      const prevBase = prev[prevKey];
      const prevU    = prevBase !== null ? prevBase / divisor : null;
      const prevP    = prevU !== null
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
   MASTER RENDER — called on every socket rates:update
   ================================================================ */
function renderAll(data) {
  lastRatesData = data;
  const admin = CFG?.admin || {};

  /* Product tables (desktop + mobile share same data, different containers) */
  renderTable(dom.goldProductsBox,   data?.goldProducts,   prev.goldProducts,   'mini');
  renderApxTableRow('goldProductsBox', 'BEFORE GST', data?.goldApxRow);

  renderTable(dom.silverProductsBox, data?.silverProducts, prev.silverProducts, 'mini');
  renderApxTableRow('silverProductsBox', 'BEFORE GST PETI', data?.silverApxRow);

  /* Market rate tables — desktop cards + mobile slider */
  renderTable(dom.futureBox,        data?.futureRows, prev.future, 'rate');
  renderTable(dom.futureBoxMobile,  data?.futureRows, prev.future, 'rate');
  renderTable(dom.spotBox,          data?.spotRows,   prev.spot,   'rate');
  renderTable(dom.spotBoxMobile,    data?.spotRows,   prev.spot,   'rate');

  /* Coin tables */
  const goldDiv             = admin.goldCoins?.divisor        || 10;
  const silverDiv           = admin.silverCoins?.divisor      || 1000;
  const goldPremiumPerGram  = admin.goldCoins?.premiumPerGram   ?? 0;
  const silverPremiumPerGram= admin.silverCoins?.premiumPerGram ?? 12;
  const goldPremiumPercent  = admin.goldCoins?.premiumPercent   ?? 1;
  const silverPremiumPercent= admin.silverCoins?.premiumPercent ?? 0;

  renderCoinTable('goldCoinBox',   admin.goldCoins?.rows,   data?.goldCoinBase,   goldDiv,   goldPremiumPerGram,   goldPremiumPercent,   'goldCoinBase');
  renderCoinTable('silverCoinBox', admin.silverCoins?.rows, data?.silverCoinBase, silverDiv, silverPremiumPerGram, silverPremiumPercent, 'silverCoinBase');

  /* Advance prev maps */
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

/* ================================================================
   STATUS INDICATOR
   ================================================================ */
function setStatus(state) {
  if (!dom.status) return;
  dom.status.className = 'status-dot ' + state;
  dom.status.title     = state === 'live' ? 'Connected – live' : 'Connecting…';
}

/* ================================================================
   SOCKET
   ================================================================ */
function connectSocket() {
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect',       () => setStatus('live'));
  socket.on('disconnect',    () => setStatus('disconnected'));
  socket.on('connect_error', () => setStatus('disconnected'));
  socket.on('rates:update',  renderAll);
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
function showCallModal() {
  const biz = CFG?.site?.business || {};
  const phone     = biz.phone    || '+91 99131 37069';
  const phone2    = biz.phone2   || '';
  const whatsapp  = biz.whatsapp || '';

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
          <a href="tel:${phone.replace(/\s/g,'')}" class="share-opt-btn" style="text-decoration:none;">
            <span class="share-opt-icon">📞</span>
            <span>${escape(phone)}</span>
          </a>` : ''}
        ${phone2 ? `
          <a href="tel:${phone2.replace(/\s/g,'')}" class="share-opt-btn" style="text-decoration:none;">
            <span class="share-opt-icon">📞</span>
            <span>${escape(phone2)}</span>
          </a>` : ''}
        ${whatsapp ? `
          <a href="https://wa.me/${whatsapp.replace(/[^0-9]/g,'')}" class="share-opt-btn" style="text-decoration:none;" target="_blank">
            <span class="share-opt-icon">💬</span>
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
  if (admin.sections?.goldProducts   !== false) opts.push({ id: 'gold',   label: 'Gold Products',   icon: '🥇' });
  if (admin.sections?.silverProducts !== false) opts.push({ id: 'silver', label: 'Silver Products', icon: '🥈' });
  if (admin.sections?.coinRates      !== false) opts.push({ id: 'coins',  label: 'Coin Rates',      icon: '🪙' });

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

    const biz   = CFG?.site?.business || {};
    const fname = `${(biz.name || 'dharamraj-rates').replace(/\s+/g, '-').toLowerCase()}-${pageId}-${new Date().toISOString().slice(0,10)}.png`;
    const file  = new File([blob], fname, { type: 'image/png' });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `${biz.name || 'Live Rates'} – ${pageId}` });
    } else {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }
  } catch(err) {
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
  const site  = CFG?.site  || {};
  const admin = CFG?.admin || {};
  const biz   = site.business || {};
  const theme = site.theme    || {};
  const data  = lastRatesData || {};

  const BRAND = theme.primaryColor || '#003336';
  const GOLD  = theme.accentColor  || '#d9b25f';

  const W     = 1080;
  const PAD   = 52;
  const RLINE = 48;

  const isGold   = pageId === 'gold';
  const isSilver = pageId === 'silver';
  const isCoins  = pageId === 'coins';

  const goldProds = isGold   ? (data.goldProducts  || []) : [];
  const silvProds = isSilver ? (data.silverProducts || []) : [];

  const gcRows = isCoins ? (admin.goldCoins?.rows   || []) : [];
  const scRows = isCoins ? (admin.silverCoins?.rows || []) : [];
  const gcBase = isCoins ? toNum(data.goldCoinBase)  : null;
  const scBase = isCoins ? toNum(data.silverCoinBase) : null;
  const gcDiv  = admin.goldCoins?.divisor   || 10;
  const scDiv  = admin.silverCoins?.divisor || 1000;
  const gcPPG  = admin.goldCoins?.premiumPerGram   ?? 0;
  const scPPG  = admin.silverCoins?.premiumPerGram ?? 12;
  const gcPct  = admin.goldCoins?.premiumPercent   ?? 1;
  const scPct  = admin.silverCoins?.premiumPercent ?? 0;

  /* ── Height calculation ── */
  const HDR_H  = 180;
  const SEC_H  = 40;
  const FOOT_H = 110;
  let H = HDR_H;

  if (goldProds.length) H += SEC_H + RLINE + goldProds.length * RLINE + (data.goldApxRow ? RLINE : 0) + 28;
  if (silvProds.length) H += SEC_H + RLINE + silvProds.length * RLINE + (data.silverApxRow ? RLINE : 0) + 28;
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
  bgGrd.addColorStop(0,   BRAND);
  bgGrd.addColorStop(0.55, '#032a2e');
  bgGrd.addColorStop(1,   '#01161a');
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
        img.onload  = () => res(img);
        img.onerror = rej;
        img.src     = logoSrc;
      }),
      new Promise((_, rej) => setTimeout(rej, 3000)),
    ]);
  } catch {}

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
  const NM_X       = PAD + 12;
  const BUY_X      = 570;
  const SELL_X     = 720;
  const HIGH_X     = 870;
  const LOW_X      = W - PAD - 4;
  const NAME_MAX_W = BUY_X - NM_X - 20;

  /* ── Product table helper ── */
  function drawProdTable(title, titleCol, rows, apxLabel, apxData) {
    if (!rows.length) return;
    ctx.fillStyle = titleCol; ctx.font = 'bold 18px Inter,Arial,sans-serif';
    ctx.fillText(title, PAD, y + 24); y += 38;

    /* Header row */
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 12px Inter,Arial,sans-serif';
    ctx.fillText('PRODUCT', NM_X, y + 30);
    ctx.textAlign = 'right';
    ctx.fillText('BUY',  BUY_X,  y + 30);
    ctx.fillText('SELL', SELL_X, y + 30);
    ctx.fillText('HIGH', HIGH_X, y + 30);
    ctx.fillText('LOW',  LOW_X,  y + 30);
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
      if (p.bid  != null) { ctx.fillStyle = '#86efac'; ctx.fillText(String(p.bid),  BUY_X,  y + 31); }
      if (p.ask  != null) { ctx.fillStyle = '#fca5a5'; ctx.fillText(String(p.ask),  SELL_X, y + 31); }
      if (p.high != null) { ctx.fillStyle = '#86efac'; ctx.fillText(String(p.high), HIGH_X, y + 31); }
      if (p.low  != null) { ctx.fillStyle = '#fca5a5'; ctx.fillText(String(p.low),  LOW_X,  y + 31); }
      ctx.textAlign = 'left'; y += RLINE;
    });

    /* APX row */
    if (apxData) {
      const sell = apxData.sell ?? null;
      const high = apxData.high ?? null;
      const low  = apxData.low  ?? null;
      ctx.fillStyle = 'rgba(217,178,95,0.12)'; ctx.fillRect(PAD, y, W - PAD * 2, RLINE);
      ctx.fillStyle = GOLD; ctx.fillRect(PAD, y, 4, RLINE);
      ctx.fillStyle = GOLD; ctx.font = 'italic bold 14px Inter,Arial,sans-serif';
      ctx.fillText(apxLabel, NM_X + 6, y + 31);
      ctx.textAlign = 'right'; ctx.font = 'bold 18px Inter,Arial,sans-serif';
      if (sell != null) { ctx.fillStyle = GOLD;      ctx.fillText(String(sell), SELL_X, y + 31); }
      if (high != null) { ctx.fillStyle = '#86efac'; ctx.fillText(String(high), HIGH_X, y + 31); }
      if (low  != null) { ctx.fillStyle = '#fca5a5'; ctx.fillText(String(low),  LOW_X,  y + 31); }
      ctx.textAlign = 'left'; y += RLINE;
    }

    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(PAD, y, W - PAD * 2, 1); y += 26;
  }

  /* ── Coin table helper ── */
  function drawCoinTable(title, titleCol, rows, baseVal, divisor, premiumPerGram, premiumPercent) {
    if (!rows.length || baseVal === null) return;
    const base1u      = baseVal / divisor;
    const pctFactor   = 1 + (premiumPercent || 0) / 100;
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

  /* ── Draw content ── */
  drawProdTable('GOLD PRODUCTS',   GOLD,     goldProds, 'BEFORE GST',      data.goldApxRow);
  drawProdTable('SILVER PRODUCTS', '#94a3b8', silvProds, 'BEFORE GST PETI', data.silverApxRow);
  drawCoinTable('GOLD COINS',    GOLD,     gcRows, gcBase, gcDiv, gcPPG, gcPct);
  drawCoinTable('SILVER COINS',  '#94a3b8', scRows, scBase, scDiv, scPPG, scPct);

  /* Coin disclaimer */
  if (isCoins && (gcRows.length || scRows.length)) {
    ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.font = 'italic 13px Inter,Arial,sans-serif';
    ctx.fillText('Rates are inclusive of making charges and exclusive of packing charges.*', PAD, y + 22);
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
