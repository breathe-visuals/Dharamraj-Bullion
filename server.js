const express = require('express');
const { io: socketClient } = require('socket.io-client');

const app = express();
const PORT = process.env.PORT || 3000;

const FEEDS = {
  gopnath: {
    url: 'https://starlinesupport.in:10001',
    room: 'gopnathrefinery',
  },
  swayam: {
    url: 'https://starlinesolutions.in:10001',
    room: 'swayamtrading',
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
    products: [],
  },
};

function toNum(val) {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '--') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeed(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.Rate)) return data.Rate;
  return [];
}

function symbolOf(item) {
  return String(item?.symbol ?? item?.Symbol ?? item?.Source ?? '')
    .trim()
    .toLowerCase();
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

function indexBySymbol(items) {
  const map = {};
  for (const item of items) {
    const sym = symbolOf(item);
    if (!sym) continue;
    if (!map[sym]) map[sym] = item;
  }
  return map;
}

function standardizeItem(item, sourceKey) {
  if (!item) return null;
  const symbol = symbolOf(item);
  return {
    symbol,
    name: item.Name || item.Symbol_Name || item.Symbol || titleOf(symbol, item),
    bid: toNum(item.Bid ?? item.Buy),
    ask: toNum(item.Ask ?? item.Sell),
    high: toNum(item.High),
    low: toNum(item.Low),
    open: toNum(item.Open),
    close: toNum(item.Close),
    diff: toNum(item.Difference),
    ltp: toNum(item.LTP),
    time: item.Time || null,
    source: sourceKey,
  };
}

function visibleProducts(rows) {
  return rows
    .filter(row => String(row?.IsDisplay).toLowerCase() === 'true')
    .map(row => standardizeItem(row, 'gopnath'));
}

function handleFeed(sourceKey, data) {
  try {
    const items = normalizeFeed(data);
    if (!items.length) return;

    state[sourceKey].live = items;
    state[sourceKey].map = indexBySymbol(items);
    state[sourceKey].lastSeen = new Date().toISOString();

    if (data && Array.isArray(data.Rate)) {
      state[sourceKey].products = visibleProducts(data.Rate);
    }
  } catch (err) {
    console.log(`[${sourceKey}] parse error:`, err.message);
  }
}

function connectFeed(sourceKey) {
  const feed = FEEDS[sourceKey];
  const socket = socketClient(feed.url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    rejectUnauthorized: false,
  });

  socket.on('connect', () => {
    state[sourceKey].connected = true;
    socket.emit('room', feed.room);
    socket.emit('Client', feed.room);
  });

  socket.on('disconnect', () => {
    state[sourceKey].connected = false;
  });

  socket.on('connect_error', (err) => {
    state[sourceKey].connected = false;
    console.log(`[${sourceKey}] connect_error:`, err.message);
  });

  socket.on('ClientData', (data) => {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      state[sourceKey].clientData = parsed;
    } catch {
      // ignore
    }
  });

  socket.on('message', (data) => handleFeed(sourceKey, data));
  socket.on('Liverate', (data) => handleFeed(sourceKey, data));

  return socket;
}

function chooseRaw(symbol) {
  const sym = String(symbol || '').toLowerCase();

  if (sym === 'gold') {
    return state.gopnath.map.gold || state.swayam.map.gold || null;
  }

  if (sym === 'silver') {
    return state.swayam.map.silver || state.gopnath.map.silver || null;
  }

  return state.swayam.map[sym] || state.gopnath.map[sym] || null;
}

function buildRows(symbols) {
  return symbols
    .map((sym) => {
      const raw = chooseRaw(sym);
      if (!raw) return null;

      const sourceKey = state.swayam.map[sym] ? 'swayam' : 'gopnath';
      return standardizeItem(raw, sourceKey);
    })
    .filter(Boolean);
}

function buildPayload() {
  const futureRows = buildRows(['gold', 'silver', 'goldnext', 'silvernext']);
  const spotRows = buildRows(['xauusd', 'xagusd', 'inrspot']);

  const productRows = state.swayam.products.length
    ? state.swayam.products
    : state.gopnath.products;

  const updatedAt = state.swayam.lastSeen || state.gopnath.lastSeen || null;

  const summary = {
    gold: standardizeItem(chooseRaw('gold'), 'gopnath'),
    silver: standardizeItem(chooseRaw('silver'), 'swayam'),
  };

  return {
    updatedAt,
    connected: {
      gopnath: state.gopnath.connected,
      swayam: state.swayam.connected,
    },
    summary,
    futureRows,
    spotRows,
    productRows,
  };
}

connectFeed('gopnath');
connectFeed('swayam');

app.use(express.static(__dirname));

app.get('/api/rates', (req, res) => {
  res.json(buildPayload());
});

app.listen(PORT, () => {
  console.log(`Dharamraj Silver Arts running on http://localhost:${PORT}`);
});
