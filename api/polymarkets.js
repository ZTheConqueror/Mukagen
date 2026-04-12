export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };

  try {
    const fetches = await Promise.allSettled([
      fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&order=volume_24hr&ascending=false', { headers }).then(r => r.ok ? r.json() : []),
      fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&order=created_at&ascending=false', { headers }).then(r => r.ok ? r.json() : []),
    ]);

    const seen = new Set();
    const all = [];

    for (const result of fetches) {
      if (result.status !== 'fulfilled') continue;
      const items = Array.isArray(result.value)
        ? result.value
        : (result.value?.markets || []);

      for (const m of items) {
        const id = m.id || m.conditionId || m.question;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const eventSlug = m.events?.[0]?.slug || m.slug || null;
        const polyUrl = eventSlug ? `https://polymarket.com/event/${eventSlug}` : null;
        all.push({ ...m, eventSlug, polyUrl, volumeNum: parseFloat(m.volume || 0) });
      }
    }

    console.log(`Total markets fetched: ${all.length}`);

    // TEST FILTER — only "weather" or "temperature" in the question
    const weatherMarkets = all.filter(m => {
      const q = (m.question || m.title || '').toLowerCase();
      return q.includes('weather') || q.includes('temperature');
    });

    console.log(`Weather markets: ${weatherMarkets.length}`);

    // Return weather matches, or all markets if nothing matched (so debug panel shows samples)
    return res.status(200).json(weatherMarkets.length > 0 ? weatherMarkets : all);

  } catch (err) {
    console.error('Polymarket proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}