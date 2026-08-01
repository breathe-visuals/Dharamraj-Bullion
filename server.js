const express  = require('express');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const { Server }    = require('socket.io');
const { io: createClient } = require('socket.io-client');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

/* ══════════════════════════════════════════════════════════════
   CONFIG — loaded once at startup from /config/*.json
   ══════════════════════════════════════════════════════════════ */
function loadConfig(filename) {
  const p = path.join(__dirname, 'config', filename);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`[config] Cannot load ${filename}: ${err.message}`);
    process.exit(1);
  }
}

const siteConfig  = loadConfig('site-config.json');
const adminConfig = loadConfig('admin-config.json');

/* Config-driven APX source rows & GST % */
const APX_GOLD_SOURCE_ROW       = adminConfig?.goldRates?.apxSourceRow        || '999 IMP RTGS';
const APX_GOLD_GST_PCT          = adminConfig?.goldRates?.apxGstPercent       ?? 3;
const APX_SILVER_SOURCE_ROW     = adminConfig?.silverRates?.apxSourceRow      || 'SILVER 999+GST';
const APX_SILVER_GST_PCT        = adminConfig?.silverRates?.apxGstPercent     ?? 3;
const SILVER_BEFORE_GST_ROW     = adminConfig?.silverRates?.beforeGstSourceRow || 'SILVER PETI RTGS';
const SILVER_BEFORE_GST_PCT     = adminConfig?.silverRates?.beforeGstPercent   ?? 3;
const SILVER_COIN_ROW           = adminConfig?.silverCoins?.baseRow           || 'SILVER 999+GST';
const GOLD_COIN_ROW             = adminConfig?.goldCoins?.baseRow             || 'REFF ONLY IMP';
const GOLD_COIN_OVERALL_ADD     = Number(adminConfig?.goldCoins?.overallAddAmount)   || 0;
const SILVER_COIN_OVERALL_ADD   = Number(adminConfig?.silverCoins?.overallAddAmount) || 0;

/* ══════════════════════════════════════════════════════════════
   PRODUCT ADJUSTMENTS
   Reads adminConfig.productAdjustments — keyed by exact product Name.
   Formula applied to every numeric field (bid/ask/high/low):
     adjusted = round( raw * (1 + addPercent/100) + addAmount + addPerGram * unitGrams )
   This runs for DISPLAY (product tables) AND for base-rate lookups
   (coins, APX), so any adjustment automatically cascades.
   ══════════════════════════════════════════════════════════════ */
const PRODUCT_ADJ = adminConfig?.productAdjustments || {};

/* Look up adjustment config by product name (case-insensitive) */
function adjFor(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  const entry = Object.entries(PRODUCT_ADJ).find(
    ([k]) => String(k).trim().toLowerCase() === key
  );
  return entry ? entry[1] : null;
}

/* Apply adjustment to a single numeric rate value */
function applyAdj(name, value) {
  if (value === null || value === undefined) return value;
  const adj = adjFor(name);
  if (!adj) return value;
  const unitGrams = Number(adj.unitGrams) || 1;
  const result = Number(value) * (1 + (Number(adj.addPercent) || 0) / 100)
               + (Number(adj.addAmount)  || 0)
               + (Number(adj.addPerGram) || 0) * unitGrams;
  return Math.round(result);
}

/* Apply adjustment to all numeric fields of a standardized item */
function applyAdjToItem(item) {
  if (!item) return item;
  const name = item.name || item.symbol || '';
  /* For High/Low: treat 0 as null — feeds often send 0 as "no data",
     and applying addAmount to 0 would produce a wrong value. */
  const rawHigh = (item.high === 0) ? null : item.high;
  const rawLow  = (item.low  === 0) ? null : item.low;
  return {
    ...item,
    bid:  applyAdj(name, item.bid),
    ask:  applyAdj(name, item.ask),
    high: applyAdj(name, rawHigh),
    low:  applyAdj(name, rawLow),
  };
}

/* ══════════════════════════════════════════════════════════════
   FEED CONFIGURATION
   ══════════════════════════════════════════════════════════════ */
const FEEDS = {
  gopnath: { url: 'https://starlinesupport.in:10001',  room: 'gopnathrefinery' },
  swayam:  { url: 'https://starlinesolutions.in:10001', room: 'swayamtrading'   },
};

/* ══════════════════════════════════════════════════════════════
   SERVER STATE
   ══════════════════════════════════════════════════════════════ */
const state = {
  gopnath: { connected: false, lastSeen: null, live: [], rawRate: [], map: {}, products: [] },
  swayam:  { connected: false, lastSeen: null, live: [], rawRate: [], map: {}, products: [] },
};

/* ══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ══════════════════════════════════════════════════════════════ */
function toNum(val) {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '--') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeed(data) {
  if (Array.isArray(data))              return data;
  if (data && Array.isArray(data.Rate)) return data.Rate;
  return [];
}

function symbolOf(item) {
  return String(item?.symbol ?? item?.Symbol ?? item?.Source ?? '').trim().toLowerCase();
}

function labelOf(symbol, item) {
  const s = String(symbol || '').toLowerCase();
  if (s === 'gold')       return 'Gold';
  if (s === 'silver')     return 'Silver';
  if (s === 'goldnext')   return 'Gold Next';
  if (s === 'silvernext') return 'Silver Next';
  if (s === 'xauusd')     return 'XAU/USD';
  if (s === 'xagusd')     return 'XAG/USD';
  if (s === 'inrspot')    return 'INR Spot';
  if (item?.Name)         return String(item.Name).toUpperCase();
  return String(symbol || '').toUpperCase();
}

function indexBySymbol(items) {
  const map = {};
  for (const item of items) {
    const sym = symbolOf(item);
    if (!sym || map[sym]) continue;
    map[sym] = item;
  }
  return map;
}

function standardizeItem(item, sourceKey) {
  if (!item) return null;
  const symbol = symbolOf(item);
  return {
    symbol,
    name:  item.Name || item.Symbol_Name || item.Symbol || labelOf(symbol, item),
    bid:   toNum(item.Bid   ?? item.Buy),
    ask:   toNum(item.Ask   ?? item.Sell),
    high:  toNum(item.High),
    low:   toNum(item.Low),
    open:  toNum(item.Open),
    close: toNum(item.Close),
    diff:  toNum(item.Difference),
    ltp:   toNum(item.LTP),
    time:  item.Time || null,
    source: sourceKey,
  };
}

function visibleProducts(rows, sourceKey) {
  return rows
    .filter(row => String(row?.IsDisplay).toLowerCase() === 'true')
    .map(row    => applyAdjToItem(standardizeItem(row, sourceKey)))  /* adjustment applied here */
    .filter(Boolean);
}

/* Search full raw Rate array by Name field — ignores IsDisplay */
function findRawByName(rows, name) {
  if (!Array.isArray(rows)) return null;
  const t = String(name).trim().toLowerCase();
  return rows.find(r => String(r?.Name ?? '').trim().toLowerCase() === t) || null;
}

/* ══════════════════════════════════════════════════════════════
   FEED HANDLER
   ══════════════════════════════════════════════════════════════ */
function handleFeed(sourceKey, data) {
  try {
    const items = normalizeFeed(data);
    if (!items.length) return;

    state[sourceKey].live    = items;
    state[sourceKey].map     = indexBySymbol(items);
    state[sourceKey].lastSeen = new Date().toISOString();

    if (data && Array.isArray(data.Rate)) {
      state[sourceKey].rawRate  = data.Rate;
      state[sourceKey].products = visibleProducts(data.Rate, sourceKey);
    } else if (Array.isArray(data)) {
      state[sourceKey].rawRate = data;
    }

    publish();
  } catch (err) {
    console.log(`[${sourceKey}] parse error:`, err.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   FEED CONNECTION
   ══════════════════════════════════════════════════════════════ */
function connectFeed(sourceKey) {
  const feed   = FEEDS[sourceKey];
  const socket = createClient(feed.url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    rejectUnauthorized: false,
  });

  socket.on('connect', () => {
    state[sourceKey].connected = true;
    socket.emit('room',   feed.room);
    socket.emit('Client', feed.room);
    publish();
  });
  socket.on('disconnect',    ()    => { state[sourceKey].connected = false; publish(); });
  socket.on('connect_error', (err) => {
    state[sourceKey].connected = false;
    console.log(`[${sourceKey}] connect_error:`, err.message);
    publish();
  });
  socket.on('ClientData', data => {
    try { state[sourceKey].clientData = typeof data === 'string' ? JSON.parse(data) : data; } catch {}
  });
  socket.on('message',  data => handleFeed(sourceKey, data));
  socket.on('Liverate', data => handleFeed(sourceKey, data));

  return socket;
}

/* ══════════════════════════════════════════════════════════════
   SYMBOL ROUTING
   ══════════════════════════════════════════════════════════════ */
function chooseRaw(symbol) {
  const s = String(symbol || '').toLowerCase();
  if (s === 'gold')   return state.gopnath.map.gold   || state.swayam.map.gold   || null;
  if (s === 'silver') return state.swayam.map.silver  || state.gopnath.map.silver || null;
  return state.swayam.map[s] || state.gopnath.map[s] || null;
}

function sourceFor(symbol) {
  const s = String(symbol || '').toLowerCase();
  if (s === 'silver' || s === 'silvernext') return 'swayam';
  return state.gopnath.map[s] ? 'gopnath' : 'swayam';
}

function buildRows(symbols) {
  return symbols
    .map(sym => { const raw = chooseRaw(sym); return raw ? standardizeItem(raw, sourceFor(sym)) : null; })
    .filter(Boolean);
}

/* ══════════════════════════════════════════════════════════════
   CONFIG-DRIVEN BASE RATE LOOKUP
   Priority:
     1. Visible products (standardized .ask = Sell)
     2. Full rawRate array (original Name/Ask fields)
     3. Fuzzy keyword fallback
   ══════════════════════════════════════════════════════════════ */
function getBaseAsk(sourceKey, rowName) {
  const target = String(rowName).trim().toLowerCase();

  /* 1 — visible products */
  const p = state[sourceKey].products.find(
    p => String(p?.name ?? '').trim().toLowerCase() === target
  );
  if (p?.ask != null) return toNum(p.ask);

  /* 2 — raw Rate array (apply adjustment since products list may not include hidden rows) */
  const r = findRawByName(state[sourceKey].rawRate, rowName)
         || findRawByName(state[sourceKey].live,    rowName);
  if (r) return applyAdj(rowName, toNum(r.Ask ?? r.Sell));

  /* 3 — fuzzy: first word > 3 chars in row name */
  const kw = target.split(' ').find(w => w.length > 3);
  if (kw) {
    const fuzzy = [...state[sourceKey].rawRate, ...state[sourceKey].live].find(
      r => String(r?.Name ?? r?.name ?? '').toLowerCase().includes(kw)
    );
    if (fuzzy) return applyAdj(rowName, toNum(fuzzy.Ask ?? fuzzy.Sell ?? fuzzy.ask));
  }

  return null;
}

/* Get full row data (ask, high, low) for a named row */
function getBaseRow(sourceKey, rowName) {
  const target = String(rowName).trim().toLowerCase();
  /* 1 — visible products */
  const p = state[sourceKey].products.find(
    p => String(p?.name ?? '').trim().toLowerCase() === target
  );
  if (p) return {
    ask:  toNum(p.ask),
    high: p.high === 0 ? null : toNum(p.high),
    low:  p.low  === 0 ? null : toNum(p.low),
  };
  /* 2 — raw array (apply adjustment) */
  const r = findRawByName(state[sourceKey].rawRate, rowName)
         || findRawByName(state[sourceKey].live,    rowName);
  if (r) {
    const rawH = toNum(r.High);
    const rawL = toNum(r.Low);
    return {
      ask:  applyAdj(rowName, toNum(r.Ask ?? r.Sell)),
      high: (rawH === 0 || rawH === null) ? null : applyAdj(rowName, rawH),
      low:  (rawL === 0 || rawL === null) ? null : applyAdj(rowName, rawL),
    };
  }
  return null;
}

/* APX W/O GST: remove GST % from ask/high/low of source row */
function apxRow(rowData, gstPct) {
  if (!rowData) return null;
  const f = 1 + gstPct / 100;
  return {
    sell: rowData.ask  !== null ? Math.round(rowData.ask  / f) : null,
    high: rowData.high !== null ? Math.round(rowData.high / f) : null,
    low:  rowData.low  !== null ? Math.round(rowData.low  / f) : null,
  };
}

function getGoldApxFull()          { return apxRow(getBaseRow('gopnath', APX_GOLD_SOURCE_ROW),   APX_GOLD_GST_PCT); }
function getSilverApxFull()        { return apxRow(getBaseRow('swayam',  APX_SILVER_SOURCE_ROW), APX_SILVER_GST_PCT); }
function getSilverBeforeGstFull()  { return apxRow(getBaseRow('swayam',  SILVER_BEFORE_GST_ROW), SILVER_BEFORE_GST_PCT); }

function getGoldApx()    { return getGoldApxFull()?.sell  ?? null; }
function getSilverApx()  { return getSilverApxFull()?.sell ?? null; }

function getGoldCoinBase() {
  if (GOLD_COIN_ROW === 'APX_GOLD') return getGoldApx();
  return getBaseAsk('gopnath', GOLD_COIN_ROW);
}
function getSilverCoinBase() { return getBaseAsk('swayam', SILVER_COIN_ROW); }

/* ══════════════════════════════════════════════════════════════
   KARAT RATES BUILDER
   Base: "98.S REF+GST" from gopnath (already 24K rate, per 10g)
   Per-gram karat rate = (base / 10) * (karat / 24)
   ══════════════════════════════════════════════════════════════ */
const KARAT_SOURCE_ROW = adminConfig?.karatRates?.sourceRow || '999 IMP RTGS';
const KARAT_DIVISOR    = adminConfig?.karatRates?.divisor   || 1;
const KARAT_LIST       = [24, 22, 21, 20, 18, 14, 9];

function buildKaratRates() {
  const baseRow = getBaseRow('gopnath', KARAT_SOURCE_ROW) || getBaseRow('swayam', KARAT_SOURCE_ROW);
  if (!baseRow || baseRow.ask === null) return null;

  const base24Ask  = baseRow.ask  !== null ? baseRow.ask  / KARAT_DIVISOR : null;
  const base24High = baseRow.high !== null ? baseRow.high / KARAT_DIVISOR : null;
  const base24Low  = baseRow.low  !== null ? baseRow.low  / KARAT_DIVISOR : null;

  return KARAT_LIST.map(k => {
    const factor = k / 24;
    return {
      karat: k,
      ask:  base24Ask  !== null ? Math.round(base24Ask  * factor) : null,
      high: base24High !== null ? Math.round(base24High * factor) : null,
      low:  base24Low  !== null ? Math.round(base24Low  * factor) : null,
    };
  });
}

/* ══════════════════════════════════════════════════════════════
   PAYLOAD BUILDER
   ══════════════════════════════════════════════════════════════ */
function buildPayload() {
  const goldApxFull          = getGoldApxFull();
  const silverApxFull        = getSilverApxFull();
  const silverBeforeGstFull  = getSilverBeforeGstFull();
  return {
    updatedAt: state.swayam.lastSeen || state.gopnath.lastSeen || null,
    connected: { gopnath: state.gopnath.connected, swayam: state.swayam.connected },
    summary: {
      gold:   standardizeItem(chooseRaw('gold'),   'gopnath'),
      silver: standardizeItem(chooseRaw('silver'), 'swayam'),
    },
    goldProducts:   state.gopnath.products,
    silverProducts: state.swayam.products,
    futureRows: buildRows(['gold', 'silver', 'goldnext', 'silvernext']),
    spotRows:   buildRows(['xauusd', 'xagusd', 'inrspot']),
    /* Coin bases */
    goldCoinBase:   getGoldCoinBase(),
    silverCoinBase: getSilverCoinBase(),
    goldCoinOverallAdd:   GOLD_COIN_OVERALL_ADD,
    silverCoinOverallAdd: SILVER_COIN_OVERALL_ADD,
    goldApxRow:         goldApxFull,
    silverApxRow:       silverApxFull,
    silverBeforeGstRow: silverBeforeGstFull,
    /* Karat rates (per gram, based on 98.S REF+GST) */
    karatRates: buildKaratRates(),
  };
}

function publish() {
  io.emit('rates:update', buildPayload());
}

/* ══════════════════════════════════════════════════════════════
   START FEEDS
   ══════════════════════════════════════════════════════════════ */
connectFeed('gopnath');
connectFeed('swayam');

/* ══════════════════════════════════════════════════════════════
   EXPRESS — static files + API
   ══════════════════════════════════════════════════════════════ */
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});
app.use(express.static(__dirname));

/* Config endpoint */
app.get('/api/config', (req, res) => {
  res.json({ site: siteConfig, admin: adminConfig });
});

/* Snapshot rates endpoint */
app.get('/api/rates', (req, res) => {
  res.json(buildPayload());
});

/* Debug endpoint */
app.get('/api/debug', (req, res) => {
  res.json({
    goldCoinBase:   getGoldCoinBase(),
    silverCoinBase: getSilverCoinBase(),
    configuredRows: { APX_GOLD_SOURCE_ROW, APX_SILVER_SOURCE_ROW, SILVER_COIN_ROW, GOLD_COIN_ROW },
    productAdjustments: PRODUCT_ADJ,
    gopnathProducts: state.gopnath.rawRate.map(r => ({
      name: r?.Name,
      rawAsk: r?.Ask ?? r?.Sell,
      adjustedAsk: applyAdj(r?.Name, toNum(r?.Ask ?? r?.Sell)),
      display: r?.IsDisplay,
    })),
    swayamProducts: state.swayam.rawRate.map(r => ({
      name: r?.Name,
      rawAsk: r?.Ask ?? r?.Sell,
      adjustedAsk: applyAdj(r?.Name, toNum(r?.Ask ?? r?.Sell)),
      display: r?.IsDisplay,
    })),
  });
});

/* ══════════════════════════════════════════════════════════════
   SOCKET — emit snapshot to every new client
   ══════════════════════════════════════════════════════════════ */
io.on('connection', socket => {
  socket.emit('rates:update', buildPayload());
});

httpServer.listen(PORT, () => {
  console.log(`\n  ${siteConfig?.business?.name || 'Dharamraj Silver Arts'} Live Rates`);
  console.log(`  Running → http://localhost:${PORT}\n`);
});
