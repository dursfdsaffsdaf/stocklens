// ======================================
// STOCKLENS — app.js
// Universe: Top 50 US (NASDAQ+NYSE) by market cap
// Data priority: FMP (stable) -> Polygon -> Yahoo proxies
// ======================================
//
// SECURITY NOTE:
// Client-side keys are exposed. Do not commit real keys to public repos.
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
  FMP: 9000,
  POLYGON: 9000,
  YAHOO: 9000,
};

// --- Limits / tuning ---
const UNIVERSE_SIZE = 50;
const UNIVERSE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const HISTORY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_CONCURRENCY = 5; // throttle to reduce rate limiting

// --- Fallback universe (static) if API screener fails ---
const DEFAULT_UNIVERSE = [
  'MSFT','AAPL','NVDA','AMZN','GOOGL','GOOG','META','BRK.B','TSLA','LLY',
  'AVGO','JPM','V','MA','XOM','UNH','COST','PG','HD','JNJ',
  'ABBV','CRM','ORCL','BAC','WMT','KO','PEP','ADBE','CSCO','ACN',
  'TMO','MCD','ABT','CVX','DIS','LIN','AMD','WFC','PM','IBM',
  'INTU','TXN','QCOM','CAT','GE','RTX','AMAT','SPGI','GS','ISRG'
];

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
const sourceLog = {}; // symbol -> source string

// ======================================
// CACHES
// ======================================
const universeCache = { ts: 0, symbols: null, source: null };
const historyCache = new Map(); // symbol -> { ts, closes, source }

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
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
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

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

// Simple concurrency limiter
async function mapLimit(items, limit, mapper) {
  const out = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      out[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

// ======================================
// UNIVERSE — FMP STABLE company-screener (NASDAQ+NYSE), top 50 by market cap
// ======================================
//
// Docs show stable company-screener with exchange filter: exchange=NASDAQ,NYSE 【2-2d4f0a】
//
async function getUniverseFMPTop50() {
  // Pull a bigger set and sort client-side (avoids relying on undocumented server-side sort).
  const base =
    `https://financialmodelingprep.com/stable/company-screener` +
    `?exchange=${encodeURIComponent('NASDAQ,NYSE')}` +
    `&isEtf=false&isFund=false&isActivelyTrading=true` +
    `&limit=1000`;

  let lastErr = null;

  for (const key of FMP_KEYS) {
    const url = `${base}&apikey=${encodeURIComponent(key)}`;

    try {
      const { res, data } = await fetchJson(url, PROVIDER_TIMEOUT_MS.FMP);

      if (!res.ok) {
        lastErr = new Error(`FMP screener HTTP ${res.status}`);
        continue;
      }
      if (!Array.isArray(data) || data.length === 0) {
        lastErr = new Error(`FMP screener empty payload`);
        continue;
      }

      // Expect screener rows to include symbol + marketCap (common in screener datasets).
      const cleaned = data
        .filter(r => r && r.symbol && isFinite(r.marketCap) && r.marketCap > 0)
        .sort((a, b) => b.marketCap - a.marketCap)
        .slice(0, UNIVERSE_SIZE)
        .map(r => String(r.symbol).trim().toUpperCase());

      if (cleaned.length < 10) {
        lastErr = new Error(`FMP screener insufficient usable rows (${cleaned.length})`);
        continue;
      }

      return cleaned;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr ?? new Error('FMP screener failed');
}

async function getUniverse() {
  // Cache
  if (universeCache.symbols && (Date.now() - universeCache.ts) < UNIVERSE_CACHE_TTL_MS) {
    return { symbols: universeCache.symbols, source: universeCache.source };
  }

  try {
    const symbols = await getUniverseFMPTop50();
    universeCache.ts = Date.now();
    universeCache.symbols = symbols;
    universeCache.source = 'FMP stable company-screener (Top 50 by market cap)';
    return { symbols, source: universeCache.source };
  } catch (e) {
    // Hard fallback
    universeCache.ts = Date.now();
    universeCache.symbols = DEFAULT_UNIVERSE.slice(0, UNIVERSE_SIZE);
    universeCache.source = 'Static fallback list (DEFAULT_UNIVERSE)';
    return { symbols: universeCache.symbols, source: universeCache.source };
  }
}

// ======================================
// API — PRIMARY: FMP STABLE historical-price-eod/light
// ======================================
//
// Endpoint: https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=AAPL&from=...&to=...&apikey=...
// Returns: [{symbol,date,price,volume}, ...] 【3-03507a】【4-b91756】
//
async function getHistoryFMP(symbol) {
  // Pull enough calendar days to obtain ~90 trading closes.
  const toDate = new Date();
  const fromDate = new Date(Date.now() - 140 * 24 * 60 * 60 * 1000);

  const base =
    `https://financialmodelingprep.com/stable/historical-price-eod/light` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&from=${encodeURIComponent(isoDate(fromDate))}` +
    `&to=${encodeURIComponent(isoDate(toDate))}`;

  let lastErr = null;

  for (const key of FMP_KEYS) {
    const url = `${base}&apikey=${encodeURIComponent(key)}`;

    try {
      const { res, data } = await fetchJson(url, PROVIDER_TIMEOUT_MS.FMP);

      if (!res.ok) {
        lastErr = new Error(`FMP HTTP ${res.status}`);
        continue;
      }

      if (!Array.isArray(data)) {
        const msg = data?.['Error Message'] || data?.message || 'FMP bad payload';
        lastErr = new Error(`FMP error: ${msg}`);
        continue;
      }

      const rows = data
        .filter(r => r && r.date && (r.price != null))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));

      const closes = normalizeCloses(rows.map(r => r.price)).slice(-90);

      if (closes.length < 30) {
        lastErr = new Error(`FMP insufficient data (${closes.length})`);
        continue;
      }

      sourceLog[symbol] = 'Financial Modeling Prep (stable)';
      return closes;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr ?? new Error(`FMP failed for ${symbol}`);
}

// ======================================
// API — BACKUP: Polygon.io aggregates
// ======================================
async function getHistoryPolygon(symbol) {
  const toDate = new Date();
  const fromDate = new Date(Date.now() - 140 * 24 * 60 * 60 * 1000);
  const to = isoDate(toDate);
  const from = isoDate(fromDate);

  let lastErr = null;

  for (const key of POLYGON_KEYS) {
    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=90&apiKey=${encodeURIComponent(key)}`;

    try {
      const { res, data } = await fetchJson(url, PROVIDER_TIMEOUT_MS.POLYGON);

      if (res.status === 429) {
        lastErr = new Error(`Polygon rate limited (429)`);
        continue;
      }
      if (!res.ok || !data) {
        lastErr = new Error(`Polygon HTTP ${res.status}`);
        continue;
      }

      const status = data.status;
      const results = Array.isArray(data.results) ? data.results : [];

      // Accept OK or DELAYED if data exists.
      if (!results.length) {
        lastErr = new Error(`Polygon empty results (${status ?? 'no-status'})`);
        continue;
      }
      if (status !== 'OK' && status !== 'DELAYED') {
        lastErr = new Error(`Polygon status ${status}`);
        continue;
      }

      const closes = normalizeCloses(results.map(b => b.c)).slice(-90);
      if (closes.length < 30) {
        lastErr = new Error(`Polygon insufficient data (${closes.length})`);
        continue;
      }

      sourceLog[symbol] = `Polygon.io (${status})`;
      return closes;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr ?? new Error(`Polygon failed for ${symbol}`);
}

// ======================================
// API — FINAL FALLBACK: Yahoo Finance via proxies
// ======================================
//
// Yahoo is commonly blocked by CORS in browsers; public proxies are unreliable. 【1-e38cc0】
//
const YAHOO_PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://thingproxy.freeboard.io/fetch/${u}`,
];

async function getHistoryYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`;

  let lastErr = null;

  for (const makeProxy of YAHOO_PROXIES) {
    try {
      const { res, data } = await fetchJson(makeProxy(url), PROVIDER_TIMEOUT_MS.YAHOO);

      if (!res.ok || !data) {
        lastErr = new Error(`Yahoo proxy HTTP ${res.status}`);
        continue;
      }

      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      const cleaned = normalizeCloses(closes).slice(-90);

      if (cleaned.length >= 30) {
        sourceLog[symbol] = 'Yahoo Finance (proxy)';
        return cleaned;
      }

      lastErr = new Error(`Yahoo insufficient data (${cleaned.length})`);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr ?? new Error(`Yahoo failed for ${symbol}`);
}

// ======================================
// API — getHistory (cache -> FMP -> Polygon -> Yahoo)
// ======================================
async function getHistory(symbol) {
  const cached = historyCache.get(symbol);
  if (cached && (Date.now() - cached.ts) < HISTORY_CACHE_TTL_MS && Array.isArray(cached.closes)) {
    sourceLog[symbol] = cached.source;
    return cached.closes;
  }

  try {
    const closes = await getHistoryFMP(symbol);
    historyCache.set(symbol, { ts: Date.now(), closes, source: sourceLog[symbol] });
    return closes;
  } catch (fmpErr) {
    console.warn(`FMP failed for ${symbol} — trying Polygon.io:`, fmpErr.message);
    try {
      const closes = await getHistoryPolygon(symbol);
      historyCache.set(symbol, { ts: Date.now(), closes, source: sourceLog[symbol] });
      return closes;
    } catch (polyErr) {
      console.warn(`Polygon failed for ${symbol} — trying Yahoo:`, polyErr.message);
      const closes = await getHistoryYahoo(symbol);
      historyCache.set(symbol, { ts: Date.now(), closes, source: sourceLog[symbol] });
      return closes;
    }
  }
}

// ======================================
// MATH
// ======================================
function movingAverage(arr, period) {
  const slice = arr.slice(-period);
  if (!slice.length) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function calcMomentum(history, days) {
  if (history.length <= days) return 0;
  const latest = history[history.length - 1];
  const prev = history[history.length - 1 - days];
  if (!isFinite(prev) || prev === 0) return 0;
  return ((latest - prev) / prev) * 100;
}

function calcATR(history) {
  const ranges = [];
  for (let i = 1; i < history.length; i++) {
    ranges.push(Math.abs(history[i] - history[i - 1]));
  }
  if (!ranges.length) return 0;
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

// Score model (unchanged)
function scoreHistory(history) {
  const m5 = calcMomentum(history, 5);
  const m20 = calcMomentum(history, 20);
  const vol = calcATR(history);
  const score = m5 + m20 - vol * 0.1;
  return { momentum5: m5, momentum20: m20, volatility: vol, score };
}

// ======================================
// TRADE MODEL (unchanged)
// ======================================
function buildTradeModel(currentPrice, history) {
  const ma20 = movingAverage(history, 20);
  const atr = calcATR(history);
  const entry = ma20 - atr * 0.8;
  const stop = entry - atr * 1.2;
  const exit = currentPrice * 1.18;
  const rr = (exit - entry) / Math.max(1e-9, (entry - stop));
  return { entry, stop, exit, rr };
}

// ======================================
// RENDER
// ======================================
function renderHeroTopStock(winner) {
  document.getElementById('heroSector').innerHTML = `
    <div class="card hero-card">
      <div class="eyebrow">Top Ranked Stock (Universe)</div>
      <div class="hero-row">
        <div class="hero-title">${winner.symbol}</div>
        <div class="hero-performance green">Score ${winner.score.toFixed(2)}</div>
      </div>
      <div class="trade-company" style="margin-top:6px;">
        5d ${winner.momentum5.toFixed(2)}% · 20d ${winner.momentum20.toFixed(2)}% · Vol ${winner.volatility.toFixed(2)}
      </div>
    </div>
  `;
}

function renderTrade(symbol, price, model) {
  document.getElementById('tradeCard').innerHTML = `
    <div class="card trade-card">
      <div class="eyebrow">Model Output</div>
      <div class="trade-header">
        <div>
          <div class="trade-ticker">${symbol}</div>
          <div class="trade-company">Selected from Top ${UNIVERSE_SIZE} US Universe</div>
        </div>
        <div>
          <div class="current-price">$${price.toFixed(2)}</div>
          <div class="trade-company">Current (last close)</div>
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

function renderRankingTable(ranked, universeSource) {
  const top = ranked.slice(0, 15);
  document.getElementById('sectorTable').innerHTML = `
    <div class="card table-card">
      <div class="eyebrow">Stock Rankings (Top ${UNIVERSE_SIZE} Universe)</div>
      <div class="trade-company" style="margin:6px 0 10px 0;">Universe source: ${universeSource}</div>
      ${top.map((r, i) => `
        <div class="table-row">
          <div>${i + 1}</div>
          <div style="width:80px;">${r.symbol}</div>
          <div style="width:110px;">${r.score.toFixed(2)}</div>
          <div style="margin-left:auto;">5d ${r.momentum5.toFixed(2)}% · 20d ${r.momentum20.toFixed(2)}%</div>
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

    // Step 0: Universe
    setLoadingStep('Building top US universe');
    const { symbols, source: universeSource } = await getUniverse();

    // Step 1: Score all stocks (throttled)
    setLoadingStep('Scoring momentum and volatility');
    const scored = await mapLimit(symbols, MAX_CONCURRENCY, async (sym) => {
      const history = await getHistory(sym);
      const s = scoreHistory(history);
      return { symbol: sym, ...s, history };
    });

    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];

    // Step 2: Build trade model on winner
    setLoadingStep('Building trade levels');
    const currentPrice = winner.history[winner.history.length - 1];
    const model = buildTradeModel(currentPrice, winner.history);

    // Step 3: Render
    renderHeroTopStock(winner);
    renderTrade(winner.symbol, currentPrice, model);
    renderRankingTable(scored, universeSource);

    // JSON block: include sources
    const sourceSummary = {};
    Object.entries(sourceLog).forEach(([sym, src]) => {
      sourceSummary[src] = sourceSummary[src] ?? [];
      sourceSummary[src].push(sym);
    });

    document.getElementById('jsonBlock').textContent = JSON.stringify({
      generatedAt: new Date().toISOString(),
      universe: { size: symbols.length, source: universeSource, symbols },
      dataSources: sourceSummary,
      winner: {
        symbol: winner.symbol,
        score: winner.score,
        momentum5: winner.momentum5,
        momentum20: winner.momentum20,
        volatility: winner.volatility
      },
      model
    }, null, 2);

    document.getElementById('apiStatus').textContent = 'Market Data Loaded';
    document.getElementById('apiStatus').className = 'status-pill pill-live';
    showState('app');
  } catch (err) {
    console.error(err);
    showState('error');
  }
}

runApp();
document.getElementById('refreshBtn').addEventListener('click', runApp);
