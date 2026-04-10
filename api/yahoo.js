export default async function handler(req, res) {
  // Strip the /api/yahoo prefix to get the Yahoo Finance path + query string
  // e.g. /api/yahoo/v8/finance/chart/AAPL?interval=1d&range=90d
  //   →  /v8/finance/chart/AAPL?interval=1d&range=90d
  const path = req.url.replace(/^\/api\/yahoo/, '');

  const yahooUrl = `https://query1.finance.yahoo.com${path}`;

  try {
    const yahooRes = await fetch(yahooUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        // Referer helps avoid Yahoo's bot detection
        'Referer': 'https://finance.yahoo.com',
      },
    });

    if (!yahooRes.ok) {
      return res.status(yahooRes.status).json({
        error: `Yahoo Finance returned ${yahooRes.status}`,
      });
    }

    const data = await yahooRes.json();

    // Cache for 5 minutes — stock prices don't need to be real-time to the second
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.status(200).json(data);
  } catch (err) {
    console.error('Yahoo proxy error:', err);
    return res.status(500).json({ error: 'Proxy fetch failed', detail: err.message });
  }
}
