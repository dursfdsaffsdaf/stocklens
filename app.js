// ======================================
// STOCKLENS — app.js
// Primary: Financial Modeling Prep (FMP)
// Backup:  Polygon.io
// Fallback: Yahoo Finance (CORS proxy)
// ======================================
//
// SECURITY NOTE:
// This is a client-side app. Any API key hardcoded here will be exposed to anyone who loads the site.
// If you commit this to a public repo, assume the keys are compromised.
//
// ======================================

// --- API KEYS (ordered; first working key wins) ---
const FMP_KEYS = [
  'lGbZF4GmiStsHo3O6p8y1VQNDKihLChQ',
];

const POLYGON_KEYS = [
  'NSas3vD1pTpPUnRh7BOPayKIMWdRGMFG',
];

// --- Provider timeouts (ms) ---
const PROVIDER_TIMEOUT_MS = {
  FMP: 6500,
  POLYGON: 8000,
  YAHOO: 8000,
};

// --- Universe ---
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
  document.getElementById('loadingState').classList.toggle('hidden', state !== 'loading');
  document.getElementById('appState').classList.toggle('hidden', state !== 'app');
  document.getElementById('errorState').classList.toggle('hidden', state !== 'error');
}

// ======================================
// CLOCK
// ======================================
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  document.getElementById('marketStatus').textContent = 'US Market';
}
setInterval(updateClock, 1000);
updateClock();

// ======================================
// DATA SOURCE TRACKING
// ======================================
const sourceLog = {};

// ======================================
// FETCH HELPERS
// ======================================
function withTimeout(ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

async function fetchJson(url, timeoutMs) {
  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal: t.signal });
    const text = await res.text();

    // Some proxies/providers return HTML or empty response on failure.
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }

    return { res, data, rawText: text };
  } finally {
    t.cancel();
  }
}

function normalizeCloses(closes) {
  if (!Array.isArray(closes)) return [];
  return closes
    .map(v => (typeof v === 'string' ? Number(v) : v))
    .filter(v => v != null && isFinite(v) && v > 0);
}

// ======================================
// API — PRIMARY: Financial Modeling Prep (FMP)
// ======================================
//
// Endpoint style (daily):
// /api/v3/historical-price-full/{symbol}?serietype=line&apikey=...
//
async function getHistoryFMP(symbol) {
  const urlBase = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(symbol)}?serietype=line`;

  let lastErr = null;

  for (const key of FMP_KEYS) {
    const url = `${urlBase}&apikey=${encodeURIComponent(key)}`;

    try {
      const { res, data } = await fetchJson(url, PROVIDER_TIMEOUT_MS.FMP);

      if (!res.ok || !data || !Array.isArray(data.historical) || data.historical.length < 30) {
        lastErr = new Error(`FMP bad response for ${symbol} (HTTP ${res.status})`);
        continue;
      }

      // FMP often returns newest-first. Sort to oldest-first for consistency.
      const sorted = data.historical
        .filter(r => r && r.date && (r.close != null))
        .slice(0, 2000) // safety cap
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));

      const closes = normalizeCloses(sorted.map(r => r.close));

      // keep last ~90 trading closes
      const trimmed = closes.slice(-90);

      if (trimmed.length < 30) {
        lastErr = new Error(`FMP insufficient data for ${symbol}`);
        continue;
      }

      sourceLog[symbol] = `Financial Modeling Prep (primary)`;
      return trimmed;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr ?? new Error(`FMP failed for ${symbol}`);
}

// ======================================
// API — BACKUP: Polygon.io
// ======================================
//
// Endpoint: /v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}?adjusted=true&sort=asc&limit=90&apiKey=...
//
async function getHistoryPolygon(symbol) {
  const toDate = new Date();
  const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const to = toDate.toISOString().split('T')[0];
  const from = fromDate.toISOString().split('T')[0];

  let lastErr = null;

  for (const key of POLYGON_KEYS) {
    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=90&apiKey=${encodeURIComponent(key)}`;

    try {
      const { res, data } = await fetchJson(url, PROVIDER_TIMEOUT_MS.POLYGON);

      if (
        res.status === 429 ||
        !res.ok ||
        !data ||
        data.status !== 'OK' ||
        !Array.isArray(data.results) ||
        data.results.length < 30
      ) {
        lastErr = new Error(`Polygon unavailable for ${symbol} (${data?.status ?? res.status})`);
        continue;
      }

      const closes = normalizeCloses(data.results.map(bar => bar.c));
      if (closes.length < 30) {
        lastErr = new Error(`Polygon insufficient data for ${symbol}`);
        continue;
      }

      sourceLog[symbol] = `Polygon.io (backup)`;
      return closes;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr ?? new Error(`Polygon failed for ${symbol}`);
}

// ======================================
// API — FINAL FALLBACK: Yahoo Finance (CORS proxy)
// ======================================
const YAHOO_PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

async function getHistoryYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`;

  for (const makeProxy of YAHOO_PROXIES) {
    try {
      const { res, data } = await fetchJson(makeProxy(url), PROVIDER_TIMEOUT_MS.YAHOO);
      if (!res.ok || !data) continue;

      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      const cleaned = normalizeCloses(closes);

      if (cleaned.length >= 30) {
        sourceLog[symbol] = `Yahoo Finance (final fallback)`;
        return cleaned;
      }
    } catch (_) {
      // try next proxy
    }
  }

  throw new Error(`Yahoo Finance also failed for ${symbol}`);
}

// ======================================
// API — getHistory (priority: FMP -> Polygon -> Yahoo)
// ======================================
async function getHistory(symbol) {
  try {
    return await getHistoryFMP(symbol);
  } catch (fmpErr) {
    console.warn(`FMP failed for ${symbol} — trying Polygon.io:`, fmpErr.message);
    try {
      return await getHistoryPolygon(symbol);
    } catch (polygonErr) {
      console.warn(`Polygon failed for ${symbol} — trying Yahoo Finance:`, polygonErr.message);
      return await getHistoryYahoo(symbol);
    }
  }
}

// ======================================
// API — getQuote
// ======================================
async function getQuote(symbol) {
  const history = await getHistory(symbol);
  const currentPrice = history[history.length - 1];
  const yearHigh = Math.max(...history);
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
  return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
}

function calcMomentum(history, days) {
  if (history.length <= days) return 0;
  const latest = history[history.length - 1];
  const previous = history[history.length - 1 - days];
  if (!isFinite(previous) || previous === 0) return 0;
  return ((latest - previous) / previous) * 100;
}

function calcATR(history) {
  const ranges = [];
  for (let i = 1; i < history.length; i++) {
    ranges.push(Math.abs(history[i] - history[i - 1]));
  }
  return ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length);
}

// ======================================
// ANALYSIS
// ======================================
async function analyseSector(symbol) {
  const history = await getHistory(symbol);
  const momentum5 = calcMomentum(history, 5);
  const momentum20 = calcMomentum(history, 20);
  const volatility = calcATR(history);
  const score = momentum5 + momentum20 - volatility * 0.1;
  return { symbol, history, momentum5, momentum20, volatility, score };
}

function buildTradeModel(stock) {
  const ma20 = movingAverage(stock.history, 20);
  const atr = calcATR(stock.history);
  const entry = ma20 - atr * 0.8;
  const stop = entry - atr * 1.2;
  const exit = stock.currentPrice * 1.18;
  const rr = (exit - entry) / Math.max(1e-9, (entry - stop));
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
    Object.keys(sourceLog).forEach(k => delete sourceLog[k]); // reset log

    // ── Step 1: Score each sector ────────────────────────────
    setLoadingStep('Analysing sector momentum');
    const sectorResults = [];
    for (const sector of Object.keys(SECTORS)) {
      const result = await analyseSector(sector);
      sectorResults.push(result);
    }

    sectorResults.sort((a, b) => b.score - a.score);
    const winningSector = sectorResults[0];

    // ── Step 2: Analyse stocks in the winning sector ─────────
    setLoadingStep('Selecting strongest blue-chip stock');
    const stockSymbols = SECTORS[winningSector.symbol].stocks;
    const analysedStocks = [];

    for (const symbol of stockSymbols) {
      const quote = await getQuote(symbol);
      const stock = {
        ...quote,
        currentPrice: quote.price,
        history: quote.history,
      };
      const model = buildTradeModel(stock);
      analysedStocks.push({ stock, model });
    }

    analysedStocks.sort((a, b) => b.model.rr - a.model.rr);
    const winner = analysedStocks[0];

    // ── Step 3: Render ───────────────────────────────────────
    renderHero(winningSector.symbol, winningSector.momentum5);
    renderTrade(winner.stock, winner.model);
    renderSectorTable(sectorResults);

    // Summarise which source each symbol actually came from
    const sourceSummary = {};
    Object.entries(sourceLog).forEach(([sym, src]) => {
      sourceSummary[src] = sourceSummary[src] ?? [];
      sourceSummary[src].push(sym);
    });

    document.getElementById('jsonBlock').textContent =
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        dataSources: sourceSummary,
        winningSector: winningSector.symbol,
        recommendation: {
          stock: winner.stock,
          model: winner.model,
        }
      }, null, 2);

    document.getElementById('apiStatus').textContent = 'Live Market Data';
    document.getElementById('apiStatus').className = 'status-pill pill-live';
    showState('app');
  } catch (err) {
    console.error(err);
    showState('error');
  }
}

runApp();
document.getElementById('refreshBtn').addEventListener('click', runApp);
