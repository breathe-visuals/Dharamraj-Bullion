const express = require('express');
const { io: socketClient } = require('socket.io-client');

const app = express();
const PORT = process.env.PORT || 3000;

const SOCKET_URL = 'https://starlinesupport.in:10001';
const ROOM_NAME  = 'gopnathrefinery';
const SOURCE_URL = 'http://gopnathrefinery.in/';

// ── Cached data ──────────────────────────────────────────────
let cachedRates  = null;
let lastUpdated  = null;
let socketStatus = 'connecting';

// ── Socket.IO connection ─────────────────────────────────────
const socket = socketClient(SOCKET_URL, {
  rejectUnauthorized: false,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  socketStatus = 'connected';
  console.log('Socket connected — joining room:', ROOM_NAME);
  socket.emit('room', ROOM_NAME);
  socket.emit('Client', ROOM_NAME);
});

socket.on('disconnect', () => {
  socketStatus = 'disconnected';
  console.log('Socket disconnected');
});

socket.on('connect_error', (err) => {
  socketStatus = 'error';
  console.log('Socket error:', err.message);
});

function handleRateFeed(data) {
  try {
    const rates = data?.Rate;
    if (!Array.isArray(rates)) return;
    cachedRates = parseRates(rates);
    lastUpdated = new Date().toISOString();
    console.log('Rates updated:', JSON.stringify(cachedRates));
  } catch (e) {
    console.log('Parse error:', e.message);
  }
}

socket.on('message', handleRateFeed);
socket.on('Liverate', handleRateFeed);

// ── Helpers ──────────────────────────────────────────────────
function toNum(val) {
  if (val === undefined || val === null) return null;
  const n = Number(String(val).replace(/,/g, '').trim());
  return (Number.isFinite(n) && n > 0) ? n : null;
}

function formatInr(n) {
  return n !== null ? `₹${n.toLocaleString('en-IN')}` : '—';
}

function parseRates(rates) {
  const visible = rates.filter(r =>
    String(r.IsDisplay).toLowerCase() === 'true'
  );

  // Match items by Source field ('Gold' / 'Silver')
  const goldItems   = visible.filter(r => /gold/i.test(String(r.Source || '')));
  const silverItems = visible.filter(r => /silver/i.test(String(r.Source || '')));

  // Pick the first item that has any live rate value
  const goldItem   = goldItems.find(r =>
    toNum(r.Ask) || toNum(r.Bid) || toNum(r.Purity)
  ) || goldItems[0];

  const silverItem = silverItems.find(r =>
    toNum(r.Ask) || toNum(r.Bid) || toNum(r.Purity)
  ) || silverItems[0];

  return {
    gold:   buildRate(goldItem,   'gold',   SOURCE_URL),
    silver: buildRate(silverItem, 'silver', SOURCE_URL)
  };
}

function buildRate(item, type, sourceUrl) {
  if (!item) {
    return {
      source: sourceUrl,
      displayRate: 'Not available',
      note: `No ${type} rate in this feed right now.`
    };
  }

  const bid     = toNum(item.Bid);
  const ask     = toNum(item.Ask);
  const purity  = toNum(item.Purity);
  const mcxBid  = toNum(item.McxBid);
  const mcxAsk  = toNum(item.McxAsk);

  // Primary display: Ask → Purity → Bid (in priority order)
  const primary = ask ?? purity ?? bid;

  const parts = [`${item.Symbol}`];
  if (bid !== null)    parts.push(`Buy ${formatInr(bid)}`);
  if (ask !== null)    parts.push(`Sell ${formatInr(ask)}`);
  if (mcxBid !== null) parts.push(`MCX ${formatInr(mcxBid)}`);
  parts.push(`Live from gopnathrefinery.in`);

  return {
    source: sourceUrl,
    displayRate: primary !== null ? formatInr(primary) : 'Not found',
    note: parts.join(' · ')
  };
}

// ── Express ──────────────────────────────────────────────────
app.use(express.static(__dirname));

app.get('/api/rates', (req, res) => {
  if (!cachedRates) {
    return res.status(503).json({
      error: 'Rates not yet available',
      message: `Socket status: ${socketStatus}. Waiting for live data from ${SOURCE_URL}`,
      updatedAt: new Date().toISOString()
    });
  }
  res.json({
    updatedAt: lastUpdated,
    gold:   cachedRates.gold,
    silver: cachedRates.silver
  });
});

app.listen(PORT, () => {
  console.log(`Dharamraj Silver Arts running on http://localhost:${PORT}`);
});
