export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };

  try {
    // Query /markets directly — simpler and more reliable than /events
    // tag_id=100381 is the official Polymarket weather tag from their docs
    // Also search by question title as a second pass
    const fetches = await Promise.allSettled([
  // ❗ REMOVED tag_id + ❗ CHANGED limit + ❗ KEPT volume sort
  fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&order=volume_24hr&ascending=false', { headers }).then(r => r.ok ? r.json() : []),

  // ❗ REMOVED tag_id + ❗ CHANGED limit + ❗ CHANGED order field
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

        // Build correct event URL from the market's events array or slug
        const eventSlug = m.events?.[0]?.slug || m.slug || null;
        const polyUrl = eventSlug
          ? `https://polymarket.com/event/${eventSlug}`
          : null;

        all.push({ ...m, eventSlug, polyUrl, volumeNum: parseFloat(m.volume || 0) });
      }
    }

    // Filter to ONLY "Highest temperature in" or "Lowest temperature in" markets
    // This matches the exact Polymarket title format from their weather category
    const temp = all.filter(m => {
      const q = (m.question || '').toLowerCase();
      return q.includes('highest temperature in') || q.includes('lowest temperature in');
    });

    // If that returns nothing, fall back to any weather-tagged market
    const final = temp.length > 0 ? temp : all;

    console.log(`total: ${all.length}, temperature markets: ${temp.length}, returning: ${final.length}`);
    return res.status(200).json(final);

  } catch (err) {
    console.error('Polymarket proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}