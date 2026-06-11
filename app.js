const SOCKET_URL = "https://starlinesupport.in:10001";
const ROOM_NAME = "gopnathrefinery";

const statusEl = document.getElementById("status");
const futureBox = document.getElementById("futureBox");
const spotBox = document.getElementById("spotBox");
const productBox = document.getElementById("productBox");

const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"]
});

socket.on("connect", () => {
  statusEl.textContent = "Connected. Loading live rates…";
  socket.emit("room", ROOM_NAME);
});

socket.on("disconnect", () => {
  statusEl.textContent = "Disconnected from live source.";
});

socket.on("connect_error", (err) => {
  statusEl.textContent = "Connection error: " + (err.message || "Unknown");
});

socket.on("ClientData", (data) => {
  try {
    window.clientData = typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) {
    console.log("ClientData parse error", e);
  }
});

socket.on("message", (data) => {
  renderProductTable(data);
  statusEl.textContent = "Live product rates updated.";
});

socket.on("Liverate", (data) => {
  renderFutureAndSpot(data);
  statusEl.textContent = "Live future/spot rates updated.";
});

function renderProductTable(data) {
  if (!data || !Array.isArray(data.Rate)) {
    productBox.innerHTML = "<p>No product data received.</p>";
    return;
  }

  const rows = data.Rate
    .filter(x => String(x.IsDisplay).toLowerCase() === "true")
    .map(x => `
      <tr>
        <td class="rowhead">${escapeHtml(x.Symbol || "")}</td>
        <td>${escapeHtml(String(x.Bid ?? ""))}</td>
        <td>${escapeHtml(String(x.Ask ?? ""))}</td>
        <td>${escapeHtml(String(x.High ?? ""))}</td>
        <td>${escapeHtml(String(x.Low ?? ""))}</td>
      </tr>
    `)
    .join("");

  productBox.innerHTML = `
    <table>
      <tr>
        <td class="rowhead">Product</td>
        <td class="rowhead">Buy</td>
        <td class="rowhead">Sell</td>
        <td class="rowhead">High</td>
        <td class="rowhead">Low</td>
      </tr>
      ${rows || "<tr><td colspan='5'>No visible rows</td></tr>"}
    </table>
  `;
}

function renderFutureAndSpot(data) {
  if (!Array.isArray(data)) {
    futureBox.innerHTML = "<p>No future data received.</p>";
    spotBox.innerHTML = "<p>No spot data received.</p>";
    return;
  }

  const futureItems = data.filter(x => {
    const s = String(x.symbol || "").toLowerCase();
    return s === "gold" || s === "silver" || s === "goldnext" || s === "silvernext";
  });

  const spotItems = data.filter(x => {
    const s = String(x.symbol || "").toLowerCase();
    return s === "xauusd" || s === "xagusd" || s === "inrspot";
  });

  futureBox.innerHTML = buildTable(futureItems);
  spotBox.innerHTML = buildTable(spotItems);
}

function buildTable(items) {
  if (!items.length) return "<p>No data</p>";

  return `
    <table>
      <tr>
        <td class="rowhead">Symbol</td>
        <td class="rowhead">Buy</td>
        <td class="rowhead">Sell</td>
        <td class="rowhead">High</td>
        <td class="rowhead">Low</td>
      </tr>
      ${items.map(x => `
        <tr>
          <td class="rowhead">${escapeHtml(x.Symbol_Name || x.symbol || "")}</td>
          <td>${escapeHtml(String(x.Bid ?? ""))}</td>
          <td>${escapeHtml(String(x.Ask ?? ""))}</td>
          <td>${escapeHtml(String(x.High ?? ""))}</td>
          <td>${escapeHtml(String(x.Low ?? ""))}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}