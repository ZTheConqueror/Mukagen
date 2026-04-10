export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const path = req.url.replace(/^\/api\/yahoo/, '');

  const urls = [
    `https://query1.finance.yahoo.com${path}`,
    `https://query2.finance.yahoo.com${path}`,
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com',
    'Origin': 'https://finance.yahoo.com',
    'Cache-Control': 'no-cache',
  };

  let lastError = null;

  for (const url of urls) {
    try {
      const yahooRes = await fetch(url, { headers });

      if (yahooRes.status === 429) { lastError = 'Rate limited'; continue; }
      if (!yahooRes.ok) { lastError = `Status ${yahooRes.status}`; continue; }

      const data = await yahooRes.json();
      if (!data?.chart?.result?.[0]) { lastError = 'Invalid response'; continue; }

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.status(200).json(data);
    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  console.error(`Yahoo proxy failed for ${path}:`, lastError);
  return res.status(502).json({ error: lastError || 'Yahoo Finance unavailable' });
}