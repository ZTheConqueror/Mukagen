export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
  const BASE = 'https://gamma-api.polymarket.com';

  try {
    // Try every known way Gamma exposes the Weather category
    // Polymarket's nav shows "Weather" as a real category — these are the possible API forms
    const searches = [
      // Tag slug approaches
      `${BASE}/markets?active=true&closed=false&limit=100&tag_slug=weather`,
      `${BASE}/markets?active=true&closed=false&limit=100&tags=weather`,
      `${BASE}/markets?active=true&closed=false&limit=100&category=weather`,
      // Known numeric tag IDs for weather on Polymarket (100381 was in old docs)
      `${BASE}/markets?active=true&closed=false&limit=100&tag_id=100381`,
      `${BASE}/markets?active=true&closed=false&limit=100&tagId=100381`,
      // Keyword searches
      `${BASE}/markets?active=true&closed=false&limit=100&question=temperature`,
      `${BASE}/markets?active=true&closed=false&limit=100&question=weather`,
      `${BASE}/markets?active=true&closed=false&limit=100&question=rainfall`,
      `${BASE}/markets?active=true&closed=false&limit=100&question=precipitation`,
      `${BASE}/markets?active=true&closed=false&limit=100&question=highest+temperature`,
      `${BASE}/markets?active=true&closed=false&limit=100&question=lowest+temperature`,
      // Events endpoint with weather tag
      `${BASE}/events?active=true&closed=false&limit=100&tag_slug=weather`,
      `${BASE}/events?active=true&closed=false&limit=100&category=weather`,
    ];

    const fetches = await Promise.allSettled(
      searches.map(url =>
        fetch(url, { headers })
          .then(r => {
            console.log(`${url} → ${r.status}`);
            return r.ok ? r.json() : [];
          })
          .catch(e => { console.log(`${url} → ERROR: ${e.message}`); return []; })
      )
    );

    const seen = new Set();
    const all = [];

    for (const result of fetches) {
      if (result.status !== 'fulfilled') continue;
      const value = result.value;

      // Handle both /markets and /events response shapes
      let items = [];
      if (Array.isArray(value)) {
        items = value;
      } else if (value?.markets) {
        items = value.markets;
      } else if (value?.events) {
        // Events contain nested markets
        for (const ev of value.events) {
          items.push(...(ev.markets || []));
        }
      }

      for (const m of items) {
        const id = m.id || m.conditionId || m.question;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const eventSlug = m.events?.[0]?.slug || m.slug || null;
        const polyUrl = eventSlug ? `https://polymarket.com/event/${eventSlug}` : null;
        all.push({ ...m, eventSlug, polyUrl, volumeNum: parseFloat(m.volume || 0) });
      }
    }

    console.log(`Total unique weather markets found: ${all.length}`);

    // Log first 5 questions so we can see what's coming back
    all.slice(0, 5).forEach((m, i) => console.log(`  [${i}] ${m.question}`));

    return res.status(200).json(all);

  } catch (err) {
    console.error('Polymarket proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}