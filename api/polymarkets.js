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

    // Single broad regex — any one match is enough, no AND chains
    const WEATHER_RE = /weather|temperature|\btemp\b|rainfall|\brain\b|snowfall|\bsnow\b|°[fc]|\bdegree|\bprecip|hurricane|tornado|flood|drought|\bwind\b|humid|sunshine|forecast|high of|low of|hottest|coldest|heat wave|freeze|frost/i;

    const weatherMarkets = all.filter(m => {
      const q = m.question || m.title || '';
      if (WEATHER_RE.test(q)) return true;
      const tags = (m.tags || []).map(t => (t.slug || t.name || '').toLowerCase());
      if (tags.some(t => t.includes('weather') || t.includes('climate') || t.includes('temperature'))) return true;
      const cat = (m.category || '').toLowerCase();
      if (cat.includes('weather') || cat.includes('climate')) return true;
      return false;
    });

    console.log(`Weather markets: ${weatherMarkets.length}, returning: ${weatherMarkets.length > 0 ? weatherMarkets.length : all.length}`);

    // If zero weather markets, return all so client can see what's actually there
    return res.status(200).json(weatherMarkets.length > 0 ? weatherMarkets : all);

  } catch (err) {
    console.error('Polymarket proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}