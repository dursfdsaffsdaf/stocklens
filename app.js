// ======================================
// STOCKLENS — app.js (Finnhub Edition)
// ======================================
//
// DATA SOURCE: Finnhub
//   Docs  → https://finnhub.io/docs/api
//   Free tier → 60 calls/min, no daily cap
//   Sign up   → https://finnhub.io (free)
//
// HOW TO USE:
//   1. Go to https://finnhub.io and create a free account
//   2. Copy your API key from the dashboard
//   3. Paste it below, replacing YOUR_FINNHUB_API_KEY
// ======================================

const API_KEY = 'd87cd71r01ql0hsl70g0d87cd71r01ql0hsl70gg';

const SECTORS = {
  MSFT: {
    name: 'Technology',
    emoji: '💻',
    stocks: ['MSFT', 'NVDA', 'AAPL']
  },
  JPM: {
    name: 'Financials',
    emoji: '🏦',
    stocks: ['JPM', 'V']
  },
  XOM: {
    name: 'Energy',
    emoji: '⚡',
    stocks: ['XOM']
  },
  LLY: {
    name: 'Healthcare',
    emoji: '🏥',
    stocks: ['LLY']
  }
};

// ======================================
// UI HELPERS
// ======================================

function setLoadingStep(text) {
  document.getElementById('loadingStep').textContent = text;
}

function showState(state) {
  document
    .getElementById('loadingState')
    .classList.toggle('hidden', state !== 'loading');

  document
    .getElementById('appState')
    .classList.toggle('hidden', state !== 'app');

  document
    .getElementById('errorState')
    .classList.toggle('hidden', state !== 'error');
}

// ======================================
// CLOCK
// ======================================

function updateClock() {
  const now = new Date();

  document.getElementById('clock').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  document.getElementById('marketStatus').textContent =
    'US Market';
}

setInterval(updateClock, 1000);
updateClock();

// ======================================
// API — Finnhub
// ======================================

/**
 * getHistory(symbol)
 *
 * Fetches 60 days of daily closing prices from Finnhub's
 * stock candle endpoint. Returns a plain array of numbers,
 * oldest price first.
 *
 * Finnhub candle endpoint:
 *   GET /stock/candle?symbol=MSFT&resolution=D&from=UNIX&to=UNIX&token=KEY
 *
 * Response shape when data exists:
 *   { s: "ok", c: [close, ...], h: [...], l: [...], o: [...], t: [...] }
 *
 * Response shape when no data (weekend, bad symbol, etc):
 *   { s: "no_data" }
 */
async function getHistory(symbol) {
  const to   = Math.floor(Date.now() / 1000);          // now (Unix seconds)
  const from = to - 60 * 24 * 60 * 60;                 // 60 days ago

  const url =
    `https://finnhub.io/api/v1/stock/candle` +
    `?symbol=${symbol}` +
    `&resolution=D` +
    `&from=${from}` +
    `&to=${to}` +
    `&token=${API_KEY}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (data.s !== 'ok' || !data.c?.length) {
    throw new Error(`No price history available for ${symbol}`);
  }

  return data.c; // array of daily closing prices
}

/**
 * getQuote(symbol)
 *
 * Returns current price and 60-day high by re-using getHistory.
 * Importantly, it also returns the full history array so that
 * runApp does NOT need to call getHistory again for the same
 * symbol — that was the double-fetch bug in the original code.
 */
async function getQuote(symbol) {
  const history      = await getHistory(symbol);
  const currentPrice = history[history.length - 1];
  const yearHigh     = Math.max(...history);           // 60-day high

  return {
    symbol,
    name: symbol,
    price: currentPrice,
    yearHigh,
    history,   // ← included here so runApp can skip the second fetch
  };
}

// ======================================
// MATH
// ======================================

function movingAverage(arr, period) {
  const slice = arr.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function calcMomentum(history, days) {
  const latest   = history[history.length - 1];
  const previous = history[history.length - 1 - days];
  return ((latest - previous) / previous) * 100;
}

function calcATR(history) {
  const ranges = [];
  for (let i = 1; i < history.length; i++) {
    ranges.push(Math.abs(history[i] - history[i - 1]));
  }
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

// ======================================
// ANALYSIS
// ======================================

async function analyseSector(symbol) {
  const history    = await getHistory(symbol);
  const momentum5  = calcMomentum(history, 5);
  const momentum20 = calcMomentum(history, 20);
  const volatility = calcATR(history);
  const score      = momentum5 + momentum20 - volatility * 0.1;

  return { symbol, history, momentum5, momentum20, volatility, score };
}

function buildTradeModel(stock) {
  const ma20  = movingAverage(stock.history, 20);
  const atr   = calcATR(stock.history);
  const entry = ma20 - atr * 0.8;
  const stop  = entry - atr * 1.2;
  const exit  = stock.currentPrice * 1.18;
  const rr    = (exit - entry) / (entry - stop);

  return { entry, stop, exit, rr };
}

// ======================================
// RENDER
// ======================================

function renderHero(sectorKey, perf) {
  const sec = SECTORS[sectorKey];

  document.getElementById('heroSector').innerHTML = `
    <div class="card hero-card">
      <div class="eyebrow">
        Current Leading Sector
      </div>
      <div class="hero-row">
        <div class="hero-title">
          ${sec.emoji} ${sec.name}
        </div>
        <div class="hero-performance green">
          +${perf.toFixed(2)}%
        </div>
      </div>
    </div>
  `;
}

function renderTrade(stock, model) {
  document.getElementById('tradeCard').innerHTML = `
    <div class="card trade-card">
      <div class="eyebrow">
        Active Trade Recommendation
      </div>
      <div class="trade-header">
        <div>
          <div class="trade-ticker">
            ${stock.symbol}
          </div>
          <div class="trade-company">
            ${stock.name}
          </div>
        </div>
        <div>
          <div class="current-price">
            $${stock.currentPrice.toFixed(2)}
          </div>
          <div class="trade-company">
            Current Price
          </div>
        </div>
      </div>
      <div class="metrics-grid">
        <div class="metric-box">
          <div class="metric-label">Buy Zone</div>
          <div class="metric-value green">$${model.entry.toFixed(2)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Sell Target</div>
          <div class="metric-value blue">$${model.exit.toFixed(2)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Protection Level</div>
          <div class="metric-value red">$${model.stop.toFixed(2)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Risk / Reward</div>
          <div class="metric-value">${model.rr.toFixed(2)} : 1</div>
        </div>
      </div>
    </div>
  `;
}

function renderSectorTable(ranked) {
  document.getElementById('sectorTable').innerHTML = `
    <div class="card table-card">
      <div class="eyebrow">
        Sector Rankings
      </div>
      ${ranked.map((item, index) => `
        <div class="table-row">
          <div>${index + 1}</div>
          <div style="width:40px;">${SECTORS[item.symbol].emoji}</div>
          <div style="width:180px;">${SECTORS[item.symbol].name}</div>
          <div style="margin-left:auto;">${item.score.toFixed(2)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ======================================
// MAIN
// ======================================

async function runApp() {
  try {
    showState('loading');

    // ── Step 1: Score each sector ──────────────────────────────
    // One API call per sector representative (4 calls total).
    setLoadingStep('Analysing sector momentum');

    const sectorResults = [];

    for (const sector of Object.keys(SECTORS)) {
      const result = await analyseSector(sector);
      sectorResults.push(result);
      // No delay needed — Finnhub allows 60 calls/min
    }

    sectorResults.sort((a, b) => b.score - a.score);
    const winningSector = sectorResults[0];

    // ── Step 2: Analyse stocks in the winning sector ───────────
    // getQuote returns history inside the object, so we do NOT
    // call getHistory again — that was the double-fetch bug fixed.
    setLoadingStep('Selecting strongest blue-chip stock');

    const stockSymbols  = SECTORS[winningSector.symbol].stocks;
    const analysedStocks = [];

    for (const symbol of stockSymbols) {
      const quote = await getQuote(symbol);

      const stock = {
        ...quote,
        currentPrice: quote.price,
        history:      quote.history, // ← already fetched inside getQuote
      };

      const model = buildTradeModel(stock);
      analysedStocks.push({ stock, model });
    }

    analysedStocks.sort((a, b) => b.model.rr - a.model.rr);
    const winner = analysedStocks[0];

    // ── Step 3: Render ─────────────────────────────────────────
    renderHero(winningSector.symbol, winningSector.momentum5);
    renderTrade(winner.stock, winner.model);
    renderSectorTable(sectorResults);

    document.getElementById('jsonBlock').textContent =
      JSON.stringify({
        generatedAt:   new Date().toISOString(),
        dataSource:    'Finnhub (live)',
        winningSector: winningSector.symbol,
        recommendation: {
          stock: winner.stock,
          model: winner.model
        }
      }, null, 2);

    document.getElementById('apiStatus').textContent = 'Live Market Data';
    document.getElementById('apiStatus').className   = 'status-pill pill-live';

    showState('app');

  } catch (err) {
    console.error(err);
    showState('error');
  }
}

runApp();

document
  .getElementById('refreshBtn')
  .addEventListener('click', runApp);
