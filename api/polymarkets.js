export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Try multiple search strategies to find weather markets
    const searches = [
      'https://gamma-api.polymarket.com/markets?_c=temperature&active=true&closed=false&limit=50',
      'https://gamma-api.polymarket.com/markets?_c=weather&active=true&closed=false&limit=50',
      'https://gamma-api.polymarket.com/markets?_c=rainfall&active=true&closed=false&limit=30',
    ];

    const results = await Promise.allSettled(
      searches.map(url =>
        fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
        }).then(r => r.ok ? r.json() : [])
      )
    );

    // Merge and deduplicate by market id
    const seen = new Set();
    const markets = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const data = Array.isArray(result.value) ? result.value : (result.value.markets || []);
        for (const m of data) {
          const id = m.id || m.conditionId || m.question;
          if (!seen.has(id)) {
            seen.add(id);
            markets.push(m);
          }
        }
      }
    }

    // Filter to genuine weather/temperature questions
    const weatherMarkets = markets.filter(m => {
      const q = (m.question || '').toLowerCase();
      return /temperature|°f|°c|degrees|rain|rainfall|snow|high temp|low temp|weather|precipitation|humid/.test(q);
    });

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    return res.status(200).json(weatherMarkets);
  } catch (err) {
    console.error('Polymarket proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}