import { useState, useEffect, useMemo, useCallback } from "react";

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

const CITIES = [
  { name: "New York",    lat: 40.7128,  lon: -74.0060  },
  { name: "Los Angeles", lat: 34.0522,  lon: -118.2437 },
  { name: "Chicago",     lat: 41.8781,  lon: -87.6298  },
  { name: "Miami",       lat: 25.7617,  lon: -80.1918  },
  { name: "Dallas",      lat: 32.7767,  lon: -96.7970  },
  { name: "Seattle",     lat: 47.6062,  lon: -122.3321 },
  { name: "Denver",      lat: 39.7392,  lon: -104.9903 },
  { name: "Phoenix",     lat: 33.4484,  lon: -112.0740 },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function celsiusToF(c) { return c * 9/5 + 32; }

function parseWeatherQuestion(question) {
  const q = question.toLowerCase();
  const tempMatch = q.match(/(\d+(?:\.\d+)?)\s*°?\s*([fc])/);
  const threshold = tempMatch ? parseFloat(tempMatch[1]) : null;
  const unit = tempMatch ? tempMatch[2].toUpperCase() : 'F';
  const isHigh = /high|max|maximum|above|exceed|over/.test(q);
  const isLow  = /low|min|minimum|below|under/.test(q);
  const isRain = /rain|precip|inch|mm|rainfall/.test(q);
  const isSnow = /snow|snowfall|accumul/.test(q);
  const isTempQ = threshold !== null && !isRain && !isSnow;
  const rainMatch = q.match(/(\d+(?:\.\d+)?)\s*inch/);
  const rainThreshold = rainMatch ? parseFloat(rainMatch[1]) : null;
  let type = 'unknown';
  if (isRain) type = 'rain';
  else if (isSnow) type = 'snow';
  else if (isTempQ && isHigh) type = 'temp_high';
  else if (isTempQ && isLow) type = 'temp_low';
  else if (isTempQ) type = 'temp_high';
  const datePatterns = [/(\w+ \d{1,2},?\s*\d{4})/, /(\w+ \d{1,2})/, /(today|tomorrow)/, /(\d{4}-\d{2}-\d{2})/];
  let dateStr = null;
  for (const pat of datePatterns) { const m = question.match(pat); if (m) { dateStr = m[1]; break; } }
  return { type, threshold, unit, rainThreshold, dateStr };
}

function extractCity(question) {
  const q = question.toLowerCase();
  for (const city of CITIES) {
    if (q.includes(city.name.toLowerCase())) return city;
  }
  if (/\bnyc\b/.test(q) || q.includes('new york')) return CITIES[0];
  if (/\bla\b/.test(q)  || q.includes('los angeles')) return CITIES[1];
  if (q.includes('chicago') || q.includes('chi')) return CITIES[2];
  return null;
}

async function fetchForecast(city) {
  const params = new URLSearchParams({
    latitude: city.lat, longitude: city.lon,
    hourly: "temperature_2m,precipitation,snowfall,weathercode",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max",
    temperature_unit: "fahrenheit", precipitation_unit: "inch",
    forecast_days: 7, timezone: "America/New_York",
  });
  const res = await fetch(`${OPEN_METEO}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  return res.json();
}

// ── FIXED: no tag_slug, no extra params that cause empty results ─────────────
async function fetchPolyWeatherMarkets() {
  try {
    // Ask for high-volume active markets — no tag filter (unreliable on Gamma)
    const res = await fetch('/api/polymarkets?active=true&closed=false&limit=200');
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const raw = Array.isArray(data) ? data : (data.markets || data.data || []);
    console.log(`[PolyWeather] raw markets from proxy: ${raw.length}`);
    return raw;
  } catch (e) {
    console.error('[PolyWeather] fetch error:', e);
    return [];
  }
}

// ── OUTCOME PARSING ──────────────────────────────────────────────────────────
// Polymarket temperature markets have buckets like:
//   "Below 15°C" | "15-17°C" | "17-19°C" | "Above 19°C"
// Each outcome has a price (0-1) = market's implied probability for that bucket.
// We parse bucket bounds and compare against forecast to find mispriced buckets.

function parseTempBucket(name) {
  if (!name) return null;

  const str = name.toLowerCase().replace(/°/g, '').trim();

  // Detect unit
  const unit = str.includes('c') ? 'C' : 'F';

  // Normalize words
  const cleaned = str
    .replace(/fahrenheit|f/g, '')
    .replace(/celsius|c/g, '')
    .replace(/to/g, '-')
    .replace(/\s+/g, '');

  // Match ranges like 70-75
  const rangeMatch = cleaned.match(/(-?\d+)\s*-\s*(-?\d+)/);
  if (rangeMatch) {
    return {
      lo: parseFloat(rangeMatch[1]),
      hi: parseFloat(rangeMatch[2]),
      unit
    };
  }

  // Match "above 80"
  const aboveMatch = cleaned.match(/above(-?\d+)/);
  if (aboveMatch) {
    return {
      lo: parseFloat(aboveMatch[1]),
      hi: Infinity,
      unit
    };
  }

  // Match "below 32"
  const belowMatch = cleaned.match(/below(-?\d+)/);
  if (belowMatch) {
    return {
      lo: -Infinity,
      hi: parseFloat(belowMatch[1]),
      unit
    };
  }

  return null;
}

// Normal CDF approximation — probability that forecast temp (with uncertainty) falls in [lo, hi]
function bucketProb(temp, lo, hi) {
  if (temp == null || lo == null || hi == null) return null;

  // Standard deviation (tunable)
  const sigma = 3; // ~3°C or ~5°F spread

  // Normal CDF
  const cdf = (x) => 0.5 * (1 + erf((x - temp) / (sigma * Math.sqrt(2))));

  const prob = cdf(hi) - cdf(lo);

  return Math.max(0, Math.min(1, prob));
}

// Error function approximation
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) *
    t * Math.exp(-x * x);

  return sign * y;
}

// ── MAIN SIGNAL LOGIC ─────────────────────────────────────────────────────────
function computeBucketSignals(market, forecast) {
  if (!forecast?.daily) return null;

  const rawOutcomes = market.outcomes || [];
  if (!rawOutcomes.length) return null;

  const question = (market.question || '').toLowerCase();

  const isLowTemp = /low|minimum/.test(question);
  const forecastTempC = isLowTemp
    ? forecast.daily.temperature_2m_min?.[0]
    : forecast.daily.temperature_2m_max?.[0];

  if (forecastTempC == null) return null;

  const outcomes = rawOutcomes.map(o => {
    const name = o.name || o.title || '';
    
    let price = parseFloat(o.price ?? o.probability ?? 0);

    // Normalize price
    if (price > 1) price = price / 100;

    const bucket = parseTempBucket(name);
    if (!bucket) {
      return { name, price, ourProb: null, edge: null };
    }

    const forecastTemp =
      bucket.unit === 'C'
        ? forecastTempC
        : (forecastTempC * 9) / 5 + 32;

    const ourProb = bucketProb(forecastTemp, bucket.lo, bucket.hi);
    if (ourProb == null) {
      return { name, price, ourProb: null, edge: null };
    }

    const edge = ourProb - price;

    return {
      name,
      price,
      ourProb,
      edge,
      bucket,
      forecastTemp
    };
  });

  const valid = outcomes.filter(o => o.edge != null);

  const bestBuy = valid
    .filter(o => o.edge > 0)
    .reduce((best, o) => (!best || o.edge > best.edge ? o : best), null);

  const bestSell = valid
    .filter(o => o.edge < 0)
    .reduce((best, o) => (!best || o.edge < best.edge ? o : best), null);

  return {
    outcomes,
    bestBuy,
    bestSell,
    forecastTempC
  };
}

// ── SIGNAL CARD ───────────────────────────────────────────────────────────────
function SignalCard({ market, forecast, city }) {
  const question = market.question || market.title || market.name || '';
  const endDate  = market.endDate
    ? new Date(market.endDate).toLocaleDateString('en-US', { month:'short', day:'numeric' })
    : '—';
  const volume = market.volumeNum ? `$${(market.volumeNum/1000).toFixed(0)}k` : '—';

  const bucketData = useMemo(() => computeBucketSignals(market, forecast), [market, forecast]);

  // Top signal for the card header badge
  const topEdge    = bucketData?.bestBuy?.edge ?? null;
  const topSignal  = topEdge === null ? 'NO_DATA'
    : topEdge > 0.12  ? 'BUY'
    : topEdge < -0.12 ? 'SELL'
    : 'HOLD';

  const sigColor = topSignal === 'BUY' ? '#4ade80' : topSignal === 'SELL' ? '#f87171' : '#64748b';
  const sigLabel = topSignal === 'BUY'  ? `▲ BUY "${bucketData.bestBuy.name}"`
                 : topSignal === 'SELL' ? `▼ SELL "${bucketData.bestSell?.name}"`
                 : topSignal === 'HOLD' ? '— HOLD' : '? NO DATA';
  const isBuy = topSignal === 'BUY' || topSignal === 'SELL';

  const forecastDisplay = bucketData?.forecastTempC != null
    ? `${bucketData.forecastTempC.toFixed(1)}°C / ${(bucketData.forecastTempC * 9/5 + 32).toFixed(1)}°F`
    : null;

  return (
    <div style={{ background: isBuy ? `${sigColor}0d` : 'rgba(255,255,255,0.02)', borderRadius:'14px', border: isBuy ? `1.5px solid ${sigColor}40` : '1px solid rgba(255,255,255,0.06)', padding:'14px', marginBottom:'10px' }}>

      {/* Header: title + city + signal badge */}
      <div style={{ marginBottom:'10px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px', flexWrap:'wrap' }}>
          <div style={{ padding:'3px 10px', borderRadius:'20px', fontSize:'0.65rem', fontFamily:"'Courier New',monospace", fontWeight:'700', letterSpacing:'0.08em', background:`${sigColor}20`, color:sigColor, border:`1px solid ${sigColor}40`, flexShrink:0 }}>
            {sigLabel}
          </div>
          {city && (
            <div style={{ padding:'2px 8px', borderRadius:'20px', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", background:'rgba(56,189,248,0.1)', color:'#38bdf8', border:'1px solid rgba(56,189,248,0.2)' }}>
              📍 {city.name}
            </div>
          )}
        </div>
        <div style={{ color:'#e2e8f0', fontSize:'0.82rem', fontWeight:'600', lineHeight:1.4 }}>{question}</div>
        {forecastDisplay && (
          <div style={{ marginTop:'4px', color:'#38bdf8', fontSize:'0.65rem', fontFamily:"'Courier New',monospace" }}>
            📡 Forecast: {forecastDisplay}
          </div>
        )}
      </div>

      {/* Bucket breakdown — the core of the card */}
      {bucketData?.outcomes?.length > 0 && (
        <div style={{ marginBottom:'10px' }}>
          <div style={{ color:'#475569', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'6px' }}>
            OUTCOME BUCKETS — MARKET PRICE vs FORECAST MODEL
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            {bucketData.outcomes.map((o, i) => {
              const edge = o.edge;
              const hasData = edge !== null;
              const edgeColor = !hasData ? '#475569' : edge > 0.12 ? '#4ade80' : edge < -0.12 ? '#f87171' : '#94a3b8';
              const isTopBuy = bucketData.bestBuy?.name === o.name && edge > 0.12;
              return (
                <div key={i} style={{
                  background: isTopBuy ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)',
                  borderRadius:'8px',
                  border: isTopBuy ? '1px solid rgba(74,222,128,0.25)' : '1px solid rgba(255,255,255,0.05)',
                  padding:'8px 10px',
                }}>
                  {/* Bucket name + edge badge */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: hasData ? '6px' : '0' }}>
                    <span style={{ color: isTopBuy ? '#4ade80' : '#cbd5e1', fontSize:'0.75rem', fontFamily:"'Courier New',monospace", fontWeight: isTopBuy ? '700' : '400' }}>
                      {isTopBuy ? '★ ' : ''}{o.name}
                    </span>
                    {hasData && (
                      <span style={{ color: edgeColor, fontSize:'0.65rem', fontFamily:"'Courier New',monospace", fontWeight:'700' }}>
                        EDGE {edge > 0 ? '+' : ''}{(edge * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>

                  {/* Three columns: market price | our model | bar */}
                  {hasData && (
                    <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                      {/* Market price */}
                      <div style={{ textAlign:'center', minWidth:'52px' }}>
                        <div style={{ color:'#475569', fontSize:'0.5rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.08em' }}>MARKET</div>
                        <div style={{ color:'#e2e8f0', fontSize:'0.85rem', fontWeight:'700', fontFamily:"'Courier New',monospace" }}>{(o.price * 100).toFixed(0)}¢</div>
                      </div>
                      {/* Model prob */}
                      <div style={{ textAlign:'center', minWidth:'52px' }}>
                        <div style={{ color:'#475569', fontSize:'0.5rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.08em' }}>MODEL</div>
                        <div style={{ color: edgeColor, fontSize:'0.85rem', fontWeight:'700', fontFamily:"'Courier New',monospace" }}>{(o.ourProb * 100).toFixed(0)}¢</div>
                      </div>
                      {/* Visual edge bar */}
                      <div style={{ flex:1, position:'relative', height:'6px', background:'rgba(255,255,255,0.06)', borderRadius:'3px' }}>
                        <div style={{
                          position:'absolute',
                          left: edge >= 0 ? '50%' : `${((edge + 1) / 2) * 100}%`,
                          width: `${Math.abs(edge) * 50}%`,
                          height:'100%', background: edgeColor, borderRadius:'3px',
                        }}/>
                        <div style={{ position:'absolute', left:'50%', top:0, width:'1px', height:'100%', background:'rgba(255,255,255,0.2)' }}/>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer meta */}
      <div style={{ display:'flex', gap:'12px', flexWrap:'wrap', marginTop:'8px' }}>
        {[['CLOSES', endDate], ['VOLUME', volume]].map(([label, val]) => (
          <div key={label}>
            <span style={{ color:'#334155', fontSize:'0.58rem', fontFamily:"'Courier New',monospace" }}>{label}: </span>
            <span style={{ color:'#64748b', fontSize:'0.58rem', fontFamily:"'Courier New',monospace" }}>{val}</span>
          </div>
        ))}
      </div>
      {market.eventSlug && (
        <a href={`https://polymarket.com/event/${market.eventSlug}`} target="_blank" rel="noopener noreferrer"
          style={{ display:'block', marginTop:'8px', color:'#38bdf8', fontSize:'0.6rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.08em', textDecoration:'none' }}>
          → VIEW ON POLYMARKET ↗
        </a>
      )}
    </div>
  );
}

function ForecastStrip({ city, forecast }) {
  if (!forecast?.daily) return null;
  const days = forecast.daily;
  const dates = days.time || [];
  return (
    <div style={{ marginBottom:'14px', background:'rgba(56,189,248,0.05)', borderRadius:'12px', padding:'10px 12px', border:'1px solid rgba(56,189,248,0.12)' }}>
      <div style={{ color:'#38bdf8', fontSize:'0.6rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'8px' }}>📡 {city.name.toUpperCase()} — 7-DAY FORECAST</div>
      <div style={{ display:'flex', gap:'6px', overflowX:'auto', paddingBottom:'2px' }}>
        {dates.slice(0,7).map((date, i) => {
          const hi = days.temperature_2m_max?.[i];
          const lo = days.temperature_2m_min?.[i];
          const precip = days.precipitation_sum?.[i];
          const precipProb = days.precipitation_probability_max?.[i];
          const d = new Date(date);
          const dayLabel = i===0?'Today':i===1?'Tmrw':d.toLocaleDateString('en-US',{weekday:'short'});
          return (
            <div key={date} style={{ flexShrink:0, textAlign:'center', minWidth:'44px', background:'rgba(255,255,255,0.03)', borderRadius:'8px', padding:'6px 4px' }}>
              <div style={{ color:'#475569', fontSize:'0.55rem', fontFamily:"'Courier New',monospace", marginBottom:'3px' }}>{dayLabel}</div>
              <div style={{ color:'#f87171', fontSize:'0.7rem', fontWeight:'700', fontFamily:"'Courier New',monospace" }}>{hi?.toFixed(0)}°</div>
              <div style={{ color:'#38bdf8', fontSize:'0.65rem', fontFamily:"'Courier New',monospace" }}>{lo?.toFixed(0)}°</div>
              {precip > 0.01 && <div style={{ color:'#60a5fa', fontSize:'0.52rem', marginTop:'2px', fontFamily:"'Courier New',monospace" }}>{precip.toFixed(2)}"</div>}
              {precipProb > 20 && <div style={{ color:'#64748b', fontSize:'0.5rem', fontFamily:"'Courier New',monospace" }}>{precipProb}%💧</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PolyWeather() {
  const [markets, setMarkets]             = useState([]);
  const [forecasts, setForecasts]         = useState({});
  const [loading, setLoading]             = useState(true);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [error, setError]                 = useState(null);
  const [lastUpdated, setLastUpdated]     = useState(null);
  const [selectedCity, setSelectedCity]   = useState(null);
  const [filterSignal, setFilterSignal]   = useState('ALL');
  const [sortBy, setSortBy]               = useState('edge');
  // Debug: show raw first 3 questions when no weather markets found
  const [debugSample, setDebugSample]     = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDebugSample([]);
    try {
      const rawMarkets = await fetchPolyWeatherMarkets();

      // Filter to only actual weather markets using the normalized question field
      const weatherMarkets = rawMarkets.filter(m => {
        const q = (m.question || m.title || m.name || '').toLowerCase();
        return q.includes('weather') || q.includes('temperature');
      });

      console.log(`[PolyWeather] raw: ${rawMarkets.length}, weather: ${weatherMarkets.length}`);

      if (weatherMarkets.length === 0 && rawMarkets.length > 0) {
        // Show a sample of what came back so we can tune the filter
        setDebugSample(rawMarkets.slice(0, 5).map(m => m.question || m.title || '(no question)'));
      }

      setMarkets(weatherMarkets);
      setLastUpdated(new Date());

      setForecastLoading(true);
      const citiesNeeded = new Set(CITIES.map(c => c.name));
      for (const m of weatherMarkets) {
        const city = extractCity(m.question || '');
        if (city) citiesNeeded.add(city.name);
      }
      const forecastResults = {};
      const cityList = CITIES.filter(c => citiesNeeded.has(c.name));
      for (let i = 0; i < cityList.length; i++) {
        try {
          forecastResults[cityList[i].name] = await fetchForecast(cityList[i]);
          if (i < cityList.length - 1) await sleep(150);
        } catch(e) { console.warn(`Forecast failed for ${cityList[i].name}:`, e); }
      }
      setForecasts(forecastResults);
      setForecastLoading(false);
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const enrichedMarkets = useMemo(() => {
  return markets.map(m => {
    // Normalize: Gamma uses question, title, name, or groupItemTitle depending on endpoint
    const question = m.question || m.title || m.name || m.groupItemTitle || m._eventTitle || '';
    
    const city = extractCity(question);
    const forecast = city ? forecasts[city.name] : null;
    const parsed = parseWeatherQuestion(question);

    const bucketData = computeBucketSignals({ ...m, question }, forecast);

    // SAFE + CORRECT signal logic
    let sig = { signal: 'HOLD', edge: null };

    if (bucketData) {
      const buyEdge = bucketData.bestBuy?.edge ?? null;
      const sellEdge = bucketData.bestSell?.edge ?? null;

      // Choose strongest edge (by magnitude)
      if (buyEdge !== null && (sellEdge === null || buyEdge >= Math.abs(sellEdge))) {
        sig = {
          signal: buyEdge > 0.12 ? 'BUY_YES' : 'HOLD',
          edge: buyEdge
        };
      } else if (sellEdge !== null) {
        sig = {
          signal: sellEdge < -0.12 ? 'BUY_NO' : 'HOLD',
          edge: sellEdge
        };
      }
    }

    return { ...m, question, city, forecast, parsed, sig };
  });
}, [markets, forecasts]);

  const displayMarkets = useMemo(() => {
    let filtered = enrichedMarkets;
    if (filterSignal === 'BUY') filtered = filtered.filter(m => m.sig.signal === 'BUY_YES' || m.sig.signal === 'BUY_NO');
    if (filterSignal === 'HOLD') filtered = filtered.filter(m => m.sig.signal === 'HOLD');
    if (selectedCity) filtered = filtered.filter(m => m.city?.name === selectedCity);
    filtered.sort((a, b) => {
      if (sortBy === 'edge') return Math.abs(b.sig.edge||0) - Math.abs(a.sig.edge||0);
      if (sortBy === 'volume') return (b.volumeNum||0) - (a.volumeNum||0);
      if (sortBy === 'closes') return new Date(a.endDate||0) - new Date(b.endDate||0);
      return 0;
    });
    return filtered;
  }, [enrichedMarkets, filterSignal, selectedCity, sortBy]);

  const buySignals = enrichedMarkets.filter(m => m.sig.signal==='BUY_YES'||m.sig.signal==='BUY_NO').length;
  const avgEdge = enrichedMarkets.filter(m=>m.sig.edge!==null).reduce((s,m)=>s+Math.abs(m.sig.edge),0) / Math.max(1, enrichedMarkets.filter(m=>m.sig.edge!==null).length);
  const previewCity = selectedCity ? CITIES.find(c=>c.name===selectedCity) : CITIES[0];
  const previewForecast = previewCity ? forecasts[previewCity.name] : null;

  return (
    <div>
      {/* Header */}
      <div style={{ background:'rgba(56,189,248,0.07)', border:'1px solid rgba(56,189,248,0.2)', borderRadius:'12px', padding:'10px 13px', marginBottom:'12px', fontFamily:"'Courier New',monospace" }}>
        <div style={{ color:'#38bdf8', fontWeight:'700', fontSize:'0.72rem', letterSpacing:'0.08em', marginBottom:'3px' }}>🌦 POLYMARKET WEATHER SIGNALS</div>
        <div style={{ color:'#64748b', fontSize:'0.6rem', lineHeight:1.5 }}>
          Live market odds vs Open-Meteo forecast. Green = YES undervalued · Red = NO undervalued.
          {lastUpdated && <span style={{ color:'#334155' }}> · {lastUpdated.toLocaleTimeString()}</span>}
        </div>
      </div>

      {/* Stats */}
      {!loading && (
        <div style={{ display:'flex', gap:'8px', marginBottom:'12px' }}>
          {[['MARKETS', markets.length, '#e2e8f0'], ['BUY SIGNALS', buySignals, buySignals > 0 ? '#4ade80' : '#64748b'], ['AVG EDGE', `${(avgEdge*100).toFixed(0)}%`, avgEdge > 0.15 ? '#4ade80' : '#64748b']].map(([label, val, color]) => (
            <div key={label} style={{ flex:1, background:'rgba(255,255,255,0.03)', borderRadius:'10px', padding:'8px', border:'1px solid rgba(255,255,255,0.06)', textAlign:'center' }}>
              <div style={{ color:'#334155', fontSize:'0.52rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.08em' }}>{label}</div>
              <div style={{ color, fontWeight:'700', fontSize:'1rem', fontFamily:"'Courier New',monospace" }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div style={{ display:'flex', gap:'6px', marginBottom:'10px', flexWrap:'wrap' }}>
        {[['ALL','All'],['BUY','🟢 Buys'],['HOLD','Hold']].map(([val,label])=>(
          <button key={val} onClick={()=>setFilterSignal(val)} style={{ padding:'5px 10px', borderRadius:'8px', border:'1px solid rgba(255,255,255,0.08)', background:filterSignal===val?'#38bdf8':'rgba(255,255,255,0.04)', color:filterSignal===val?'#000':'#94a3b8', fontSize:'0.62rem', fontFamily:"'Courier New',monospace", cursor:'pointer', fontWeight:filterSignal===val?'700':'400' }}>{label}</button>
        ))}
        <button onClick={loadData} style={{ padding:'5px 10px', borderRadius:'8px', border:'1px solid rgba(56,189,248,0.25)', background:'rgba(56,189,248,0.08)', color:'#38bdf8', fontSize:'0.62rem', fontFamily:"'Courier New',monospace", cursor:'pointer' }}>
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {/* Sort + city filter */}
      <div style={{ display:'flex', gap:'6px', marginBottom:'14px', flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ color:'#334155', fontSize:'0.58rem', fontFamily:"'Courier New',monospace" }}>SORT:</span>
        {[['edge','Edge'],['volume','Volume'],['closes','Closes']].map(([val,label])=>(
          <button key={val} onClick={()=>setSortBy(val)} style={{ padding:'4px 8px', borderRadius:'6px', border:'1px solid rgba(255,255,255,0.07)', background:sortBy===val?'rgba(56,189,248,0.15)':'rgba(255,255,255,0.03)', color:sortBy===val?'#38bdf8':'#475569', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", cursor:'pointer' }}>{label}</button>
        ))}
        <span style={{ color:'#334155', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", marginLeft:'4px' }}>CITY:</span>
        <button onClick={()=>setSelectedCity(null)} style={{ padding:'4px 8px', borderRadius:'6px', border:'1px solid rgba(255,255,255,0.07)', background:!selectedCity?'rgba(56,189,248,0.15)':'rgba(255,255,255,0.03)', color:!selectedCity?'#38bdf8':'#475569', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", cursor:'pointer' }}>All</button>
        {CITIES.map(c=>(
          <button key={c.name} onClick={()=>setSelectedCity(c.name===selectedCity?null:c.name)} style={{ padding:'4px 8px', borderRadius:'6px', border:'1px solid rgba(255,255,255,0.07)', background:selectedCity===c.name?'rgba(56,189,248,0.15)':'rgba(255,255,255,0.03)', color:selectedCity===c.name?'#38bdf8':'#475569', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", cursor:'pointer' }}>{c.name.split(' ')[0]}</button>
        ))}
      </div>

      {previewForecast && previewCity && <ForecastStrip city={previewCity} forecast={previewForecast} />}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign:'center', padding:'40px 20px' }}>
          <div style={{ color:'#38bdf8', fontSize:'1.5rem', marginBottom:'10px' }}>🌦</div>
          <div style={{ color:'#64748b', fontSize:'0.75rem', fontFamily:"'Courier New',monospace" }}>Fetching Polymarket markets…</div>
          {forecastLoading && <div style={{ color:'#334155', fontSize:'0.65rem', marginTop:'6px', fontFamily:"'Courier New',monospace" }}>Loading forecasts…</div>}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:'12px', padding:'14px', marginBottom:'12px', color:'#f87171', fontSize:'0.72rem', fontFamily:"'Courier New',monospace" }}>
          ⚠ {error}
        </div>
      )}

      {/* No weather markets — show debug sample so we can tune filter */}
      {!loading && markets.length === 0 && (
        <div style={{ background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'12px', padding:'14px', marginBottom:'14px' }}>
          <div style={{ color:'#f59e0b', fontWeight:'700', fontSize:'0.72rem', fontFamily:"'Courier New',monospace", marginBottom:'6px' }}>
            NO WEATHER MARKETS FOUND
          </div>
          <div style={{ color:'#94a3b8', fontSize:'0.68rem', lineHeight:1.6 }}>
            The proxy returned markets but none matched the weather filter. Check Vercel function logs for counts.
          </div>
          {debugSample.length > 0 && (
            <div style={{ marginTop:'10px' }}>
              <div style={{ color:'#475569', fontSize:'0.6rem', fontFamily:"'Courier New',monospace", marginBottom:'4px' }}>SAMPLE OF WHAT CAME BACK:</div>
              {debugSample.map((q, i) => (
                <div key={i} style={{ color:'#334155', fontSize:'0.62rem', fontFamily:"'Courier New',monospace", padding:'3px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                  {q}
                </div>
              ))}
              <div style={{ color:'#475569', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", marginTop:'6px' }}>
                → If these look like weather markets, the regex needs updating. Share these with Claude.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Market cards */}
      {!loading && displayMarkets.length > 0 && (
        <div>
          <div style={{ color:'#334155', fontSize:'0.6rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'10px' }}>
            {displayMarkets.length} MARKET{displayMarkets.length!==1?'S':''} · BY {sortBy.toUpperCase()}
          </div>
          {displayMarkets.map((m, i) => (
            <SignalCard key={m.id || i} market={m} forecast={m.forecast} city={m.city} />
          ))}
        </div>
      )}

      {/* City forecast grid */}
      {!forecastLoading && Object.keys(forecasts).length > 0 && (
        <div style={{ marginTop:'16px' }}>
          <div style={{ color:'#334155', fontSize:'0.6rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'10px' }}>📡 CITY FORECASTS — TODAY HIGH / LOW</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
            {CITIES.map(city => {
              const f = forecasts[city.name];
              if (!f?.daily) return null;
              const hi = f.daily.temperature_2m_max?.[0];
              const lo = f.daily.temperature_2m_min?.[0];
              const precip = f.daily.precipitation_sum?.[0];
              const precipProb = f.daily.precipitation_probability_max?.[0];
              return (
                <button key={city.name} onClick={()=>setSelectedCity(city.name===selectedCity?null:city.name)} style={{ background:selectedCity===city.name?'rgba(56,189,248,0.1)':'rgba(255,255,255,0.03)', borderRadius:'10px', border:`1px solid ${selectedCity===city.name?'rgba(56,189,248,0.3)':'rgba(255,255,255,0.06)'}`, padding:'10px', textAlign:'left', cursor:'pointer' }}>
                  <div style={{ color:'#94a3b8', fontSize:'0.65rem', fontFamily:"'Courier New',monospace", fontWeight:'700', marginBottom:'4px' }}>{city.name}</div>
                  <div style={{ display:'flex', gap:'8px', alignItems:'baseline' }}>
                    <span style={{ color:'#f87171', fontWeight:'700', fontSize:'0.9rem', fontFamily:"'Courier New',monospace" }}>{hi?.toFixed(0)}°</span>
                    <span style={{ color:'#38bdf8', fontSize:'0.78rem', fontFamily:"'Courier New',monospace" }}>{lo?.toFixed(0)}°</span>
                    {precip > 0.01 && <span style={{ color:'#60a5fa', fontSize:'0.65rem', fontFamily:"'Courier New',monospace" }}>{precip.toFixed(2)}"</span>}
                    {precipProb > 20 && <span style={{ color:'#64748b', fontSize:'0.58rem' }}>💧{precipProb}%</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ color:'#1e2a38', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", textAlign:'center', marginTop:'20px', lineHeight:1.5 }}>
        Open-Meteo forecasts · Not financial advice · Verify before trading
      </div>
    </div>
  );
}
