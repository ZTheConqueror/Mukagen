export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };

  try {
    // ── Use the official weather tag_id=100381 from Polymarket docs ──────────
    // Fetch from /events (not /markets) — events contain nested markets array
    // and have better tag filtering support.
    // Sort by volume_24hr so the most active temperature markets come first.
    const urls = [
      'https://gamma-api.polymarket.com/events?tag_id=100381&active=true&closed=false&limit=100&order=volume_24hr&ascending=false',
      // Also try the broader climate tag in case weather is nested under it
      'https://gamma-api.polymarket.com/events?tag_id=100380&active=true&closed=false&limit=50&order=volume_24hr&ascending=false',
    ];

    const results = await Promise.allSettled(
      urls.map(url => fetch(url, { headers }).then(r => r.ok ? r.json() : []))
    );

    // Flatten: each event has a .markets array — pull those out
    const seen = new Set();
    const markets = [];

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const events = Array.isArray(result.value) ? result.value : [];

      for (const event of events) {
        const eventMarkets = Array.isArray(event.markets) ? event.markets : [];

        for (const m of eventMarkets) {
          const id = m.id || m.conditionId || m.question;
          if (!id || seen.has(id)) continue;
          seen.add(id);

          // Build the correct Polymarket URL using the EVENT slug, not market slug
          // URL format: polymarket.com/event/{event-slug}
          const polyUrl = event.slug
            ? `https://polymarket.com/event/${event.slug}`
            : null;

          markets.push({
            ...m,
            // Override slug with event slug for correct URL linking
            eventSlug:  event.slug,
            polyUrl,
            question:   m.question || event.title || '',
            endDate:    m.endDate  || event.endDate || '',
            volume:     m.volume   || event.volume  || '0',
            volumeNum:  parseFloat(m.volume || event.volume || 0),
            // outcomes and outcomePrices come from the market object
            outcomes:      m.outcomes,
            outcomePrices: m.outcomePrices,
          });
        }
      }
    }

    // Filter strictly to temperature/weather questions only
    // This removes any non-weather markets that sneak through the tag
    const weatherMarkets = markets.filter(m => {
      const q = (m.question || '').toLowerCase();
      return /temperature|°f|°c|degrees|rain|rainfall|snow|high temp|low temp|weather|precip|humid|heat|forecast|highest temp|lowest temp/.test(q);
    });

    // Fall back to all tag results if filter is too aggressive
    const final = weatherMarkets.length > 0 ? weatherMarkets : markets;

    console.log(`tag_id=100381 returned ${markets.length} markets, ${weatherMarkets.length} after weather filter`);
    return res.status(200).json(final);

  } catch (err) {
    console.error('Polymarket proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}