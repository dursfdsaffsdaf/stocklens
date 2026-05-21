// ===============================
// STOCKLENS - COMPLETE app.js
// ===============================

const SECTORS = {
  XLK: {
    name: 'Technology',
    emoji: '💻',
    stocks: ['MSFT', 'NVDA', 'AVGO', 'AAPL']
  },

  XLF: {
    name: 'Financials',
    emoji: '🏦',
    stocks: ['JPM', 'V', 'MA', 'BRK-B']
  },

  XLE: {
    name: 'Energy',
    emoji: '⚡',
    stocks: ['XOM', 'CVX', 'COP', 'SLB']
  },

  XLI: {
    name: 'Industrials',
    emoji: '🏭',
    stocks: ['CAT', 'GE', 'HON', 'DE']
  },

  XLV: {
    name: 'Healthcare',
    emoji: '🏥',
    stocks: ['LLY', 'JNJ', 'ABBV', 'PFE']
  },

  XLP: {
    name: 'Consumer Staples',
    emoji: '🛒',
    stocks: ['PG', 'KO', 'PEP', 'COST']
  }
};

// ===============================
// UI HELPERS
// ===============================

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

// ===============================
// CLOCK
// ===============================

function updateClock() {

  const now = new Date();

  document.getElementById('clock').textContent =
    now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

  const ny = new Date(
    now.toLocaleString('en-US', {
      timeZone: 'America/New_York'
    })
  );

  const mins =
    ny.getHours() * 60 + ny.getMinutes();

  const day = ny.getDay();

  let status = 'US Market Closed';

  if (day !== 0 && day !== 6) {

    if (mins >= 570 && mins < 960) {
      status = 'US Market Open';
    }
  }

  document.getElementById('marketStatus').textContent =
    status;
}

setInterval(updateClock, 1000);
updateClock();

// ===============================
// ALPHA VANTAGE
// FREE DEMO KEY
// ===============================

async function getHistory(symbol) {

  const url =
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=demo`;

  const res = await fetch(url);

  const data = await res.json();

  if (!data['Time Series (Daily)']) {
    throw new Error('API limit reached');
  }

  const series = data['Time Series (Daily)'];

  const closes =
    Object.values(series)
      .map(day => parseFloat(day['4. close']))
      .reverse();

  return closes.slice(-60);
}

async function getQuote(symbol) {

  const history = await getHistory(symbol);

  const currentPrice =
    history[history.length - 1];

  const yearHigh =
    Math.max(...history);

  return {
    symbol,
    name: symbol,
    price: currentPrice,
    yearHigh
  };
}

// ===============================
// MATH
// ===============================

function movingAverage(arr, period) {

  const slice = arr.slice(-period);

  return (
    slice.reduce((a, b) => a + b, 0) /
    slice.length
  );
}

function calcATR(history, period = 14) {

  const ranges = [];

  for (let i = 1; i < history.length; i++) {

    ranges.push(
      Math.abs(history[i] - history[i - 1])
    );
  }

  const slice = ranges.slice(-period);

  return (
    slice.reduce((a, b) => a + b, 0) /
    slice.length
  );
}

function calcMomentum(history, days) {

  const latest =
    history[history.length - 1];

  const previous =
    history[history.length - 1 - days];

  return (
    ((latest - previous) / previous) * 100
  );
}

function scoreSector(m5, m20, vol) {

  return (
    m5 * 0.45 +
    m20 * 0.45 -
    vol * 0.1
  );
}

// ===============================
// TRADE MODEL
// ===============================

function buildTradeModel(stock) {

  const ma20 =
    movingAverage(stock.history, 20);

  const atr =
    calcATR(stock.history);

  const entry =
    ma20 - atr * 0.8;

  const stop =
    entry - atr * 1.2;

  const risk =
    entry - stop;

  const target1 =
    stock.currentPrice * 1.18;

  const target2 =
    stock.yearHigh * 0.985;

  const exit =
    Math.max(target1, target2);

  const reward =
    exit - entry;

  const rr =
    reward / risk;

  let confidence = 'Medium';

  if (rr >= 2.5) {
    confidence = 'High';
  }

  if (rr < 1.8) {
    confidence = 'Low';
  }

  return {
    ma20,
    atr,
    entry,
    stop,
    exit,
    rr,
    confidence
  };
}

// ===============================
// RENDER
// ===============================

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

        <div class="
          hero-performance
          ${perf >= 0 ? 'green' : 'red'}
        ">
          ${perf >= 0 ? '+' : ''}
          ${perf.toFixed(2)}%
        </div>

      </div>

    </div>
  `;
}

function renderTrade(stock, model) {

  document.getElementById('tradeCard').innerHTML = `

    <div class="card trade-card">

      <div class="eyebrow">
        Primary Trade Setup
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
          <div class="metric-label">
            Buy Zone
          </div>

          <div class="metric-value green">
            $${model.entry.toFixed(2)}
          </div>
        </div>

        <div class="metric-box">
          <div class="metric-label">
            Sell Target
          </div>

          <div class="metric-value blue">
            $${model.exit.toFixed(2)}
          </div>
        </div>

        <div class="metric-box">
          <div class="metric-label">
            Protection Level
          </div>

          <div class="metric-value red">
            $${model.stop.toFixed(2)}
          </div>
        </div>

        <div class="metric-box">
          <div class="metric-label">
            Risk / Reward
          </div>

          <div class="metric-value">
            ${model.rr.toFixed(2)} : 1
          </div>
        </div>

        <div class="metric-box">
          <div class="metric-label">
            Confidence
          </div>

          <div class="metric-value amber">
            ${model.confidence}
          </div>
        </div>

      </div>

    </div>
  `;
}

function renderSectorTable(ranked) {

  const max =
    Math.max(
      ...ranked.map(x => Math.abs(x.score))
    );

  document.getElementById('sectorTable').innerHTML = `

    <div class="card table-card">

      <div class="eyebrow">
        Sector Momentum Ranking
      </div>

      ${ranked.map((item, index) => {

        const width =
          (Math.abs(item.score) / max) * 100;

        return `

          <div class="table-row">

            <div>
              ${index + 1}
            </div>

            <div style="width:40px;">
              ${SECTORS[item.symbol].emoji}
            </div>

            <div style="width:180px;">
              ${SECTORS[item.symbol].name}
            </div>

            <div class="bar-wrap">

              <div
                class="bar"
                style="
                  width:${width}%;
                  background:
                  ${item.score >= 0
                    ? 'var(--green)'
                    : 'var(--red)'};
                ">
              </div>

            </div>

            <div style="
              width:80px;
              text-align:right;
            ">
              ${item.score.toFixed(2)}
            </div>

          </div>
        `;
      }).join('')}

    </div>
  `;
}

// ===============================
// ANALYSIS
// ===============================

async function analyseSector(etf) {

  const quote =
    await getQuote(etf);

  const history =
    await getHistory(etf);

  const momentum5 =
    calcMomentum(history, 5);

  const momentum20 =
    calcMomentum(history, 20);

  const volatility =
    calcATR(history);

  const score =
    scoreSector(
      momentum5,
      momentum20,
      volatility
    );

  return {
    symbol: etf,
    quote,
    history,
    momentum5,
    momentum20,
    volatility,
    score
  };
}

async function buildStockData(symbol) {

  const quote =
    await getQuote(symbol);

  const history =
    await getHistory(symbol);

  return {
    symbol: quote.symbol,
    name: quote.name,
    currentPrice: quote.price,
    yearHigh: quote.yearHigh,
    history
  };
}

// ===============================
// MAIN
// ===============================

async function runApp() {

  try {

    showState('loading');

    setLoadingStep(
      'Analysing sector momentum'
    );

    const sectorResults = [];

    for (const etf of Object.keys(SECTORS)) {

      const data =
        await analyseSector(etf);

      sectorResults.push(data);
    }

    sectorResults.sort(
      (a, b) => b.score - a.score
    );

    const winnerSector =
      sectorResults[0];

    setLoadingStep(
      'Analysing blue-chip leaders'
    );

    const stocks =
      SECTORS[winnerSector.symbol].stocks;

    const analysedStocks = [];

    for (const symbol of stocks) {

      const stock =
        await buildStockData(symbol);

      const model =
        buildTradeModel(stock);

      analysedStocks.push({
        stock,
        model
      });
    }

    analysedStocks.sort((a, b) => {

      const scoreA =
        a.model.rr;

      const scoreB =
        b.model.rr;

      return scoreB - scoreA;
    });

    const winner =
      analysedStocks[0];

    renderHero(
      winnerSector.symbol,
      winnerSector.momentum5
    );

    renderTrade(
      winner.stock,
      winner.model
    );

    renderSectorTable(
      sectorResults
    );

    document.getElementById(
      'jsonBlock'
    ).textContent =
      JSON.stringify({

        generatedAt:
          new Date().toISOString(),

        sectorRanking:
          sectorResults.map(x => ({
            symbol: x.symbol,
            score: x.score,
            momentum5: x.momentum5,
            momentum20: x.momentum20,
            volatility: x.volatility
          })),

        recommendation: {
          stock: winner.stock,
          model: winner.model
        }

      }, null, 2);

    document.getElementById(
      'apiStatus'
    ).textContent =
      'Live Market Data';

    document.getElementById(
      'apiStatus'
    ).className =
      'status-pill pill-live';

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
