export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
  const BASE = 'https://gamma-api.polymarket.com';

  try {
    const searches = [
      `${BASE}/markets?active=true&closed=false&limit=100&tag_slug=weather`,
      `${BASE}/markets?active=true&closed=false&limit=100&tags=weather`,
      `${BASE}/markets?active=true&closed=false&limit=100&category=weather`,
      `${BASE}/markets?active=true&closed=false&limit=100&tag_id=100381`,
      `${BASE}/markets?active=true&closed=false&limit=100&question=temperature`,
      `${BASE}/markets?active=true&closed=false&limit=100&question=weather`,
      `${BASE}/markets?active=true&closed=false&limit=100&question=highest+temperature`,
      `${BASE}/markets?active=true&closed=false&limit=100&question=lowest+temperature`,
      `${BASE}/events?active=true&closed=false&limit=100&tag_slug=weather`,
      `${BASE}/events?active=true&closed=false&limit=100&category=weather`,
    ];

    const fetches = await Promise.allSettled(
      searches.map(url =>
        fetch(url, { headers })
          .then(r => { console.log(`${url.replace(BASE,'')} → ${r.status}`); return r.ok ? r.json() : []; })
          .catch(e => { console.log(`ERROR: ${e.message}`); return []; })
      )
    );

    const seen = new Set();
    const all = [];

    for (const result of fetches) {
      if (result.status !== 'fulfilled') continue;
      const value = result.value;

      let items = [];
      if (Array.isArray(value)) {
        items = value;
      } else if (value?.markets) {
        items = value.markets;
      } else if (value?.events) {
        for (const ev of value.events) {
          // Flatten event markets, inheriting event title if market has no question
          const evTitle = ev.title || ev.name || '';
          for (const m of (ev.markets || [])) {
            items.push({ ...m, _eventTitle: evTitle });
          }
        }
      }

      for (const m of items) {
        const id = m.id || m.conditionId;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        // ── NORMALIZE question field ──────────────────────────────────────
        // Gamma uses different field names depending on endpoint:
        // /markets  → m.question  OR  m.title  OR  m.name
        // /events   → nested markets may have no question, use event title
        const question =
          m.question ||
          m.title ||
          m.name ||
          m.groupItemTitle ||
          m._eventTitle ||
          '';

        const eventSlug = m.events?.[0]?.slug || m.slug || null;
        const polyUrl = eventSlug ? `https://polymarket.com/event/${eventSlug}` : null;

        // Log first few so we can see field names in Vercel logs
        if (all.length < 5) {
          console.log(`MARKET FIELDS: ${JSON.stringify(Object.keys(m))}`);
          console.log(`  question="${m.question}" title="${m.title}" name="${m.name}" groupItemTitle="${m.groupItemTitle}"`);
          console.log(`  → normalized: "${question}"`);
        }

        all.push({ ...m, question, eventSlug, polyUrl, volumeNum: parseFloat(m.volume || 0) });
      }
    }

    console.log(`Total unique weather markets: ${all.length}`);
    return res.status(200).json(all);

  } catch (err) {
    console.error('Polymarket proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}