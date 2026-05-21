const API_KEY = 'PASTE_YOUR_FMP_API_KEY_HERE';
    });

    const winner = analysedStocks[0];

    renderHero(
      winningSector.symbol,
      winningSector.momentum5
    );

    renderTrade(
      winner.stock,
      winner.model
    );

    renderSectorTable(sectorResults);

    document.getElementById('jsonBlock').textContent = JSON.stringify({

      generatedAt: new Date().toISOString(),

      sectorRanking: sectorResults.map(x => ({
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
