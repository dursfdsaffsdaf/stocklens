const API_KEY = '50OQ2U1UED3SZFOB';

const SECTORS = {
  Technology: {
    emoji: '💻',
    stocks: ['MSFT', 'NVDA']
  },

  Financials: {
    emoji: '🏦',
    stocks: ['JPM', 'V']
  },

  Energy: {
    emoji: '⚡',
    stocks: ['XOM']
  },

  Healthcare: {
    emoji: '🏥',
    stocks: ['LLY']
  }
};

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

async function fetchHistory(symbol) {

  const url =
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${API_KEY}`;

  const response =
    await fetch(url);

  const data =
    await response.json();

  if (!data['Time Series (Daily)']) {
    throw new Error(
      `No data for ${symbol}`
    );
  }

  const history =
    Object.entries(
      data['Time Series (Daily)']
    )
    .map(([date, values]) => ({
      date,
      close: Number(values['4. close'])
    }))
    .reverse();

  return history;
}

function calculateMomentum(history) {

  const latest =
    history[history.length - 1].close;

  const previous =
    history[history.length - 6].close;

  return (
    ((latest - previous) / previous) * 100
  );
}

function movingAverage(history, days = 20) {

  const slice =
    history.slice(-days);

  const total =
    slice.reduce(
      (sum, day) => sum + day.close,
      0
    );

  return total / days;
}

function calculateTradeModel(history) {

  const current =
    history[history.length - 1].close;

  const ma20 =
    movingAverage(history, 20);

  const entry =
    ma20 * 0.95;

  const target =
    current * 1.25;

  return {
    current: current.toFixed(2),
    entry: entry.toFixed(2),
    target: target.toFixed(2)
  };
}

async function analyseStock(symbol) {

  const history =
    await fetchHistory(symbol);

  return {
    symbol,
    history,
    momentum:
      calculateMomentum(history),
    trade:
      calculateTradeModel(history)
  };
}

function renderResult(
  sector,
  stock
) {

  document.getElementById(
    'app'
  ).innerHTML = `

    <div class="space-y-6">

      <div class="bg-white rounded-3xl p-6 shadow-lg">

        <div class="text-sm text-gray-500">
          Current Strongest Sector
        </div>

        <div class="text-3xl font-bold mt-2">
          ${SECTORS[sector].emoji}
          ${sector}
        </div>

      </div>

      <div class="bg-white rounded-3xl p-6 shadow-lg">

        <div class="text-sm text-gray-500">
          Suggested Blue-Chip Trade
        </div>

        <div class="mt-4 space-y-3">

          <div>
            <span class="text-gray-500">
              Stock:
            </span>
            <span class="font-bold">
              ${stock.symbol}
            </span>
          </div>

          <div>
            <span class="text-gray-500">
              Current Price:
            </span>
            $${stock.trade.current}
          </div>

          <div>
            <span class="text-gray-500">
              Suggested Entry:
            </span>
            $${stock.trade.entry}
          </div>

          <div>
            <span class="text-gray-500">
              Suggested Target:
            </span>
            $${stock.trade.target}
          </div>

          <div>
            <span class="text-gray-500">
              Risk Profile:
            </span>
            Conservative Blue-Chip
          </div>

        </div>

      </div>

      <div class="bg-black text-green-400 rounded-3xl p-6 overflow-auto text-sm">

<pre>${JSON.stringify(stock, null, 2)}</pre>

      </div>

    </div>
  `;
}

async function runApp() {

  try {

    document.getElementById(
      'app'
    ).innerHTML =
      '<div class="text-center text-white text-xl">Scanning market...</div>';

    const sectorScores = [];

    for (const sector of Object.keys(SECTORS)) {

      const leadStock =
        SECTORS[sector].stocks[0];

      const result =
        await analyseStock(leadStock);

      sectorScores.push({
        sector,
        score: result.momentum
      });

      await sleep(15000);
    }

    sectorScores.sort(
      (a, b) => b.score - a.score
    );

    const bestSector =
      sectorScores[0].sector;

    const candidates =
      [];

    for (
      const symbol
      of SECTORS[bestSector].stocks
    ) {

      const result =
        await analyseStock(symbol);

      candidates.push(result);

      await sleep(15000);
    }

    candidates.sort(
      (a, b) => b.momentum - a.momentum
    );

    renderResult(
      bestSector,
      candidates[0]
    );

  } catch (err) {

    console.error(err);

    document.getElementById(
      'app'
    ).innerHTML = `

      <div class="bg-red-500 text-white p-6 rounded-3xl">

        Unable to load market data.

        <div class="mt-2 text-sm opacity-80">
          ${err.message}
        </div>

      </div>
    `;
  }
}

runApp();
