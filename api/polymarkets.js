export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0',
  };

  try {
    // ── STEP 1: Discover the weather tag ID from /tags ──────────────────────
    const tagsRes = await fetch(
      'https://gamma-api.polymarket.com/tags?limit=200',
      { headers }
    );

    let weatherTagIds = [];

    if (tagsRes.ok) {
      const tags = await tagsRes.json();
      if (Array.isArray(tags)) {
        const weatherTags = tags.filter(t => {
          const label = (t.label || '').toLowerCase();
          const slug  = (t.slug  || '').toLowerCase();
          return /weather|temperature|climate|rain|snow|storm/.test(label)
              || /weather|temperature|climate|rain|snow|storm/.test(slug);
        });
        weatherTagIds = weatherTags.map(t => t.id);
        console.log('Found weather tags:', weatherTags.map(t => `${t.label}(${t.id})`).join(', '));
      }
    }

    // ── STEP 2: Fetch events by weather tag IDs ─────────────────────────────
    let markets = [];

    if (weatherTagIds.length > 0) {
      const eventFetches = weatherTagIds.slice(0, 4).map(tagId =>
        fetch(
          `https://gamma-api.polymarket.com/events?tag_id=${tagId}&active=true&closed=false&limit=50&order=volume_24hr&ascending=false`,
          { headers }
        ).then(r => r.ok ? r.json() : [])
      );

      const eventResults = await Promise.allSettled(eventFetches);

      for (const result of eventResults) {
        if (result.status === 'fulfilled') {
          const events = Array.isArray(result.value) ? result.value : [];
          for (const event of events) {
            const eventMarkets = Array.isArray(event.markets) ? event.markets : [];
            for (const market of eventMarkets) {
              markets.push({
                ...market,
                slug:      market.slug || event.slug,
                question:  market.question || event.title,
                endDate:   market.endDate || event.endDate,
                volume:    market.volume  || event.volume,
                volumeNum: parseFloat(market.volume || event.volume || 0),
              });
            }
          }
        }
      }
    }

    // ── STEP 3: Fallback — scan /markets with broad active filter ───────────
    if (markets.length === 0) {
      console.log('Tag search returned nothing, falling back to broad scan');
      const fallbackRes = await fetch(
        'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&order=volume_24hr&ascending=false',
        { headers }
      );
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        markets = Array.isArray(data) ? data : (data.markets || []);
      }
    }

    // ── STEP 4: Deduplicate ─────────────────────────────────────────────────
    const seen = new Set();
    const unique = [];
    for (const m of markets) {
      const id = m.id || m.conditionId || m.question;
      if (id && !seen.has(id)) {
        seen.add(id);
        unique.push(m);
      }
    }

    // ── STEP 5: Filter to genuine weather questions ─────────────────────────
    const weatherMarkets = unique.filter(m => {
      const q = (m.question || m.title || '').toLowerCase();
      return /temperature|°f|°c|degrees|rain|rainfall|snow|high temp|low temp|weather|precip|humid|heat|forecast/.test(q);
    });

    const final = weatherMarkets.length > 0 ? weatherMarkets : unique;

    console.log(`Returning ${final.length} weather markets (${unique.length} total unique fetched)`);
    return res.status(200).json(final);

  } catch (err) {
    console.error('Polymarket proxy error:', err);
    return res.status(500).json({ error: err.message, markets: [] });
  }
}