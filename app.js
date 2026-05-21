// ======================================
// STOCKLENS — app.js
// Primary:  Polygon.io (free tier)
// Fallback: Yahoo Finance (CORS proxy)
// ======================================
//
// SETUP — Polygon.io (takes ~2 minutes)
//   1. Go to https://polygon.io and sign up (free, no card)
//   2. Your API key appears on the dashboard immediately
//   3. Paste it below, replacing YOUR_POLYGON_API_KEY
// ======================================

const POLYGON_KEY = 'NSas3vD1pTpPUnRh7BOPayKIMWdRGMFG';

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
// DATA SOURCE TRACKING
// ======================================

const sourceLog = {};

// ======================================
// API — PRIMARY: Polygon.io
// ======================================

async function getHistoryPolygon(symbol) {
  const toDate   = new Date();
  const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const to   = toDate.toISOString().split('T')[0];
  const from = fromDate.toISOString().split('T')[0];

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=90&apiKey=${POLYGON_KEY}`;

  const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await res.json();

  // FIX: Polygon free plan returns "DELAYED" instead of "OK".
  // Both statuses include valid price data — accept either.
  const validStatus = data.status === 'OK' || data.status === 'DELAYED';

  if (res.status === 429 || !validStatus || !data.results?.length) {
    throw new Error(`Polygon unavailable for ${symbol} (${data.status ?? res.status})`);
  }

  return data.results.map(bar => bar.c);
}

// ======================================
// API — FALLBACK: Yahoo Finance
// ======================================

const YAHOO_PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

async function getHistoryYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3mo&interval=1d`;

  for (const makeProxy of YAHOO_PROXIES) {
    try {
      const res  = await fetch(makeProxy(url), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;

      const data   = await res.json();
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;

      if (closes?.length) {
        return closes.filter(c => c != null && isFinite(c));
      }
    } catch (_) {
      // try next proxy
    }
  }

  throw new Error(`Yahoo Finance also failed for ${symbol}`);
}

// ======================================
// API — getHistory (with fallback)
// ======================================

async function getHistory(symbol) {
  try {
    const closes = await getHistoryPolygon(symbol);
    sourceLog[symbol] = 'Polygon.io';
    return closes;
  } catch (polygonErr) {
    console.warn(`Polygon failed for ${symbol} — trying Yahoo:`, polygonErr.message);
    const closes = await getHistoryYahoo(symbol);
    sourceLog[symbol] = 'Yahoo Finance (fallback)';
    return closes;
  }
}

// ======================================
// API — getQuote
// ======================================

async function getQuote(symbol) {
  const history      = await getHistory(symbol);
  const currentPrice = history[history.length - 1];
  const yearHigh     = Math.max(...history);

  return {
    symbol,
    name: symbol,
    price: currentPrice,
    yearHigh,
    history,
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
    Object.keys(sourceLog).forEach(k => delete sourceLog[k]);

    // ── Step 1: Score each sector ────────────────────────────
    // FIX: each sector is wrapped in its own try/catch.
    // If a symbol fails both Polygon and Yahoo, it is skipped
    // and the remaining sectors are still ranked normally.
    setLoadingStep('Analysing sector momentum');

    const sectorResults = [];

    for (const sector of Object.keys(SECTORS)) {
      try {
        const result = await analyseSector(sector);
        sectorResults.push(result);
      } catch (err) {
        console.warn(`Skipping sector ${sector} — both data sources failed:`, err.message);
      }
    }

    if (!sectorResults.length) {
      throw new Error('All sector data sources failed. Check your connection and try again.');
    }

    sectorResults.sort((a, b) => b.score - a.score);
    const winningSector = sectorResults[0];

    // ── Step 2: Analyse stocks in the winning sector ─────────
    // FIX: same per-symbol try/catch — a stock that can't be
    // fetched is skipped rather than crashing the whole app.
    setLoadingStep('Selecting strongest blue-chip stock');

    const stockSymbols   = SECTORS[winningSector.symbol].stocks;
    const analysedStocks = [];

    for (const symbol of stockSymbols) {
      try {
        const quote = await getQuote(symbol);

        const stock = {
          ...quote,
          currentPrice: quote.price,
          history:      quote.history,
        };

        const model = buildTradeModel(stock);
        analysedStocks.push({ stock, model });
      } catch (err) {
        console.warn(`Skipping stock ${symbol} — both data sources failed:`, err.message);
      }
    }

    if (!analysedStocks.length) {
      throw new Error('Could not load any stocks in the leading sector. Try again shortly.');
    }

    analysedStocks.sort((a, b) => b.model.rr - a.model.rr);
    const winner = analysedStocks[0];

    // ── Step 3: Render ───────────────────────────────────────
    renderHero(winningSector.symbol, winningSector.momentum5);
    renderTrade(winner.stock, winner.model);
    renderSectorTable(sectorResults);

    const sourceSummary = {};
    Object.entries(sourceLog).forEach(([sym, src]) => {
      sourceSummary[src] = sourceSummary[src] ?? [];
      sourceSummary[src].push(sym);
    });

    document.getElementById('jsonBlock').textContent =
      JSON.stringify({
        generatedAt:   new Date().toISOString(),
        dataSources:   sourceSummary,
        winningSector: winningSector.symbol,
        recommendation: {
          stock: winner.stock,
          model: winner.model,
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
