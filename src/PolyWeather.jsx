import { useState, useEffect, useMemo, useCallback } from "react";

// ── POLYMARKET GAMMA API ────────────────────────────────────────────────────
// Gamma is Polymarket's public REST API — no auth required for reading markets
const GAMMA_BASE = "https://gamma-api.polymarket.com";

// ── NOAA + Open-Meteo ───────────────────────────────────────────────────────
// Open-Meteo: free, no key, hourly forecasts. More granular than public NWS.
// NWS API: official NOAA data, no key required.
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

// ── CITIES CONFIG ───────────────────────────────────────────────────────────
const CITIES = [
  { name: "New York",     lat: 40.7128,  lon: -74.0060  },
  { name: "Los Angeles",  lat: 34.0522,  lon: -118.2437 },
  { name: "Chicago",      lat: 41.8781,  lon: -87.6298  },
  { name: "Miami",        lat: 25.7617,  lon: -80.1918  },
  { name: "Dallas",       lat: 32.7767,  lon: -96.7970  },
  { name: "Seattle",      lat: 47.6062,  lon: -122.3321 },
  { name: "Denver",       lat: 39.7392,  lon: -104.9903 },
  { name: "Phoenix",      lat: 33.4484,  lon: -112.0740 },
  { name: "Boston",       lat: 42.3601,  lon: -71.0589  },
  { name: "Atlanta",      lat: 33.7490,  lon: -84.3880  },
  { name: "Houston",      lat: 29.7604,  lon: -95.3698  },
  { name: "Las Vegas",    lat: 36.1699,  lon: -115.1398 },
  // International — Polymarket has active markets for all of these
  { name: "London",       lat: 51.5074,  lon: -0.1278   },
  { name: "Tokyo",        lat: 35.6762,  lon: 139.6503  },
  { name: "Seoul",        lat: 37.5665,  lon: 126.9780  },
  { name: "Paris",        lat: 48.8566,  lon: 2.3522    },
  { name: "Berlin",       lat: 52.5200,  lon: 13.4050   },
  { name: "Sydney",       lat: -33.8688, lon: 151.2093  },
  { name: "Dubai",        lat: 25.2048,  lon: 55.2708   },
  { name: "Singapore",    lat: 1.3521,   lon: 103.8198  },
  { name: "Shanghai",     lat: 31.2304,  lon: 121.4737  },
  { name: "Bangkok",      lat: 13.7563,  lon: 100.5018  },
];

// ── HELPERS ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function kelvinToF(k) { return (k - 273.15) * 9/5 + 32; }
function celsiusToF(c) { return c * 9/5 + 32; }

// Parse a threshold from a market question string
// e.g. "Will NYC high exceed 85°F on July 4?" → { type:'high', threshold:85, unit:'F' }
function parseWeatherQuestion(question) {
  const q = question.toLowerCase();

  // Temperature patterns
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
  else if (isTempQ) type = 'temp_high'; // default

  // Extract date
  const datePatterns = [
    /(\w+ \d{1,2},?\s*\d{4})/,
    /(\w+ \d{1,2})/,
    /(today|tomorrow)/,
    /(\d{4}-\d{2}-\d{2})/,
  ];
  let dateStr = null;
  for (const pat of datePatterns) {
    const m = question.match(pat);
    if (m) { dateStr = m[1]; break; }
  }

  return { type, threshold, unit, rainThreshold, dateStr };
}

// Extract city name from question by matching against our city list
function extractCity(question) {
  const q = question.toLowerCase();
  for (const city of CITIES) {
    if (q.includes(city.name.toLowerCase())) return city;
  }
  // Common abbreviations — only whole-word or unambiguous matches
  if (/\bnyc\b/.test(q) || q.includes('new york')) return CITIES[0];
  if (/\bla\b/.test(q)  || q.includes('los angeles')) return CITIES[1];
  return null;
}

// Fetch Open-Meteo forecast for a city — returns hourly temp/precip for next 7 days
async function fetchForecast(city) {
  const params = new URLSearchParams({
    latitude: city.lat,
    longitude: city.lon,
    hourly: "temperature_2m,precipitation,snowfall,weathercode",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    forecast_days: 7,
    timezone: "America/New_York",
  });
  const res = await fetch(`${OPEN_METEO}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  return res.json();
}

// Fetch active Polymarket weather markets
async function fetchPolyWeatherMarkets() {
  try {
    const params = new URLSearchParams({
      tag_slug: "weather",
      active: "true",
      closed: "false",
      limit: 100,
    });

    const res = await fetch(`/api/polymarkets?${params}`);

    if (!res.ok) throw new Error(`API ${res.status}`);

    const data = await res.json();

    return Array.isArray(data) ? data : (data.markets || []);
  } catch (e) {
    console.error("Polymarket fetch error:", e);
    return [];
  }
}

// ── SIGNAL ENGINE ────────────────────────────────────────────────────────────
// Given a market and forecast data, compute:
//   marketProb   — what Polymarket implies (YES price ≈ probability)
//   ourProb      — what weather data says
//   edge         — ourProb - marketProb (positive = YES undervalued)
//   signal       — BUY_YES | BUY_NO | HOLD
//   confidence   — 0-1
function computeSignal(market, forecast, parsed, city) {
  if (!forecast || !parsed || parsed.type === 'unknown') {
    return { marketProb: null, ourProb: null, edge: null, signal: 'INSUFFICIENT_DATA' };
  }

  // Market probability: in Polymarket, YES token price ≈ probability (0-1)
  const outcomes = market.outcomes || [];
  const yesOutcome = outcomes.find(o => o.name?.toLowerCase() === 'yes') || outcomes[0];
  const marketProb = yesOutcome ? parseFloat(yesOutcome.price) : null;
  if (marketProb === null) return { marketProb: null, ourProb: null, edge: null, signal: 'NO_PRICE' };

  const daily = forecast.daily;
  if (!daily) return { marketProb, ourProb: null, edge: null, signal: 'NO_FORECAST' };

  let ourProb = null;

  if (parsed.type === 'temp_high' && parsed.threshold !== null) {
    // Use max temp forecast + uncertainty band
    const maxTemps = daily.temperature_2m_max || [];
    if (!maxTemps.length) return { marketProb, ourProb: null, edge: null, signal: 'NO_FORECAST' };

    // Use nearest relevant day (today or tomorrow based on dateStr)
    const targetTemp = maxTemps[0]; // simplification: use tomorrow's high
    const threshold = parsed.unit === 'C' ? celsiusToF(parsed.threshold) : parsed.threshold;

    // Model uncertainty: ±3.5°F for 1-day, growing with distance
    const uncertainty = 3.5;
    // Normal CDF approximation
    const z = (targetTemp - threshold) / uncertainty;
    ourProb = 1 / (1 + Math.exp(-1.7 * z)); // logistic approximation of normal CDF

  } else if (parsed.type === 'temp_low' && parsed.threshold !== null) {
    const minTemps = daily.temperature_2m_min || [];
    if (!minTemps.length) return { marketProb, ourProb: null, edge: null, signal: 'NO_FORECAST' };
    const targetTemp = minTemps[0];
    const threshold = parsed.unit === 'C' ? celsiusToF(parsed.threshold) : parsed.threshold;
    const uncertainty = 3.0;
    const z = (targetTemp - threshold) / uncertainty;
    ourProb = 1 / (1 + Math.exp(-1.7 * z));

  } else if (parsed.type === 'rain' && parsed.rainThreshold !== null) {
    const precips = daily.precipitation_sum || [];
    const probMax = daily.precipitation_probability_max || [];
    if (!precips.length) return { marketProb, ourProb: null, edge: null, signal: 'NO_FORECAST' };

    const expectedPrecip = precips[0];
    const precipProb = (probMax[0] || 50) / 100;

    // If rain is likely, estimate probability of exceeding threshold
    if (expectedPrecip > 0 && precipProb > 0.3) {
      // Exponential model: P(X > threshold | rain occurs)
      const lambda = 1 / Math.max(expectedPrecip, 0.01);
      const pExceedGivenRain = Math.exp(-lambda * parsed.rainThreshold);
      ourProb = precipProb * pExceedGivenRain + (1 - precipProb) * 0.02;
    } else {
      ourProb = 0.05; // low base rate if no rain expected
    }

  } else if (parsed.type === 'snow') {
    const snowfall = daily.snowfall_sum || [];
    const snowVal = snowfall[0] || 0;
    // Simple: if model shows snow > 0.1in, prob is high
    ourProb = snowVal > 0.5 ? 0.75 : snowVal > 0.1 ? 0.45 : 0.08;
  }

  if (ourProb === null) return { marketProb, ourProb: null, edge: null, signal: 'UNRESOLVABLE' };

  const edge = ourProb - marketProb;
  const absEdge = Math.abs(edge);

  // Signal thresholds
  let signal = 'HOLD';
  if (edge > 0.12) signal = 'BUY_YES';
  else if (edge < -0.12) signal = 'BUY_NO';

  // Confidence: based on edge size and forecast certainty
  const confidence = Math.min(1, absEdge * 4);

  return { marketProb, ourProb, edge, signal, confidence, targetForecastValue: null };
}

// ── SIGNAL CARD ───────────────────────────────────────────────────────────────
function SignalCard({ market, forecast, city }) {
  const parsed = useMemo(() => parseWeatherQuestion(market.question || ''), [market.question]);
  const signal = useMemo(() => computeSignal(market, forecast, parsed, city), [market, forecast, parsed, city]);

  const signalColors = {
    BUY_YES: '#4ade80',
    BUY_NO:  '#f87171',
    HOLD:    '#64748b',
    INSUFFICIENT_DATA: '#475569',
    NO_PRICE: '#475569',
    NO_FORECAST: '#475569',
    UNRESOLVABLE: '#475569',
  };
  const signalLabels = {
    BUY_YES: '▲ BUY YES',
    BUY_NO:  '▼ BUY NO',
    HOLD:    '— HOLD',
    INSUFFICIENT_DATA: '? NO DATA',
    NO_PRICE: '? NO PRICE',
    NO_FORECAST: '? NO FCST',
    UNRESOLVABLE: '~ N/A',
  };

  const sigColor = signalColors[signal.signal] || '#475569';
  const sigLabel = signalLabels[signal.signal] || signal.signal;
  const isBuy = signal.signal === 'BUY_YES' || signal.signal === 'BUY_NO';

  const endDate = market.endDate ? new Date(market.endDate).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '—';
  const volume = market.volumeNum ? `$${(market.volumeNum/1000).toFixed(0)}k` : (market.volume ? `$${market.volume}` : '—');

  return (
    <div style={{
      background: isBuy ? `${sigColor}0d` : 'rgba(255,255,255,0.02)',
      borderRadius: '14px',
      border: isBuy ? `1.5px solid ${sigColor}40` : '1px solid rgba(255,255,255,0.06)',
      padding: '14px',
      marginBottom: '10px',
    }}>
      {/* Signal badge + city */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'10px', marginBottom:'10px' }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px', flexWrap:'wrap' }}>
            {/* Signal pill */}
            <div style={{
              padding:'3px 10px', borderRadius:'20px', fontSize:'0.65rem',
              fontFamily:"'Courier New',monospace", fontWeight:'700', letterSpacing:'0.08em',
              background:`${sigColor}20`, color:sigColor,
              border:`1px solid ${sigColor}40`,
              flexShrink:0,
            }}>{sigLabel}</div>
            {/* City tag */}
            {city && (
              <div style={{ padding:'2px 8px', borderRadius:'20px', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", background:'rgba(56,189,248,0.1)', color:'#38bdf8', border:'1px solid rgba(56,189,248,0.2)' }}>
                📍 {city.name}
              </div>
            )}
          </div>
          {/* Question */}
          <div style={{ color:'#e2e8f0', fontSize:'0.78rem', lineHeight:1.45, fontWeight: isBuy ? '600' : '400' }}>
            {market.question}
          </div>
        </div>
      </div>

      {/* Probability comparison */}
      {signal.marketProb !== null && signal.ourProb !== null && (
        <div style={{ marginBottom:'10px' }}>
          <div style={{ display:'flex', gap:'8px', marginBottom:'6px' }}>
            <div style={{ flex:1, background:'rgba(255,255,255,0.04)', borderRadius:'8px', padding:'8px 10px' }}>
              <div style={{ color:'#64748b', fontSize:'0.55rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'3px' }}>MARKET ODDS</div>
              <div style={{ color:'#e2e8f0', fontWeight:'700', fontSize:'1.1rem', fontFamily:"'Courier New',monospace" }}>{(signal.marketProb*100).toFixed(0)}%</div>
            </div>
            <div style={{ flex:1, background:'rgba(255,255,255,0.04)', borderRadius:'8px', padding:'8px 10px' }}>
              <div style={{ color:'#64748b', fontSize:'0.55rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'3px' }}>NOAA MODEL</div>
              <div style={{ color:sigColor, fontWeight:'700', fontSize:'1.1rem', fontFamily:"'Courier New',monospace" }}>{(signal.ourProb*100).toFixed(0)}%</div>
            </div>
            <div style={{ flex:1, background:'rgba(255,255,255,0.04)', borderRadius:'8px', padding:'8px 10px' }}>
              <div style={{ color:'#64748b', fontSize:'0.55rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'3px' }}>EDGE</div>
              <div style={{ color:sigColor, fontWeight:'700', fontSize:'1.1rem', fontFamily:"'Courier New',monospace" }}>
                {signal.edge > 0 ? '+' : ''}{(signal.edge*100).toFixed(0)}%
              </div>
            </div>
          </div>

          {/* Edge bar */}
          <div style={{ position:'relative', height:'5px', background:'rgba(255,255,255,0.06)', borderRadius:'3px', overflow:'hidden' }}>
            <div style={{
              position:'absolute',
              left: signal.edge >= 0 ? '50%' : `${((signal.edge+1)/2)*100}%`,
              width:`${Math.abs(signal.edge)*50}%`,
              height:'100%', background:sigColor, borderRadius:'3px',
            }}/>
            <div style={{ position:'absolute', left:'50%', top:0, width:'1px', height:'100%', background:'rgba(255,255,255,0.2)' }}/>
          </div>

          {/* Confidence */}
          {isBuy && (
            <div style={{ marginTop:'6px', display:'flex', alignItems:'center', gap:'6px' }}>
              <span style={{ color:'#475569', fontSize:'0.58rem', fontFamily:"'Courier New',monospace" }}>CONFIDENCE</span>
              <div style={{ flex:1, height:'3px', background:'rgba(255,255,255,0.06)', borderRadius:'2px' }}>
                <div style={{ height:'100%', width:`${signal.confidence*100}%`, background:sigColor, borderRadius:'2px' }}/>
              </div>
              <span style={{ color:sigColor, fontSize:'0.58rem', fontFamily:"'Courier New',monospace" }}>{(signal.confidence*100).toFixed(0)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Market meta */}
      <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
        {[
          { label:'CLOSES', val: endDate },
          { label:'VOLUME', val: volume },
          { label:'TYPE', val: parsed.type.replace('_',' ').toUpperCase() },
        ].map(({ label, val }) => (
          <div key={label}>
            <span style={{ color:'#334155', fontSize:'0.58rem', fontFamily:"'Courier New',monospace" }}>{label}: </span>
            <span style={{ color:'#64748b', fontSize:'0.58rem', fontFamily:"'Courier New',monospace" }}>{val}</span>
          </div>
        ))}
      </div>

      {/* Polymarket link */}
      {market.slug && (
        <a href={`https://polymarket.com/event/${market.slug}`} target="_blank" rel="noopener noreferrer"
          style={{ display:'block', marginTop:'8px', color:'#38bdf8', fontSize:'0.6rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.08em', textDecoration:'none' }}>
          → VIEW ON POLYMARKET ↗
        </a>
      )}
    </div>
  );
}

// ── FORECAST SUMMARY STRIP ────────────────────────────────────────────────────
function ForecastStrip({ city, forecast }) {
  if (!forecast?.daily) return null;
  const days = forecast.daily;
  const dates = days.time || [];
  return (
    <div style={{ marginBottom:'14px', background:'rgba(56,189,248,0.05)', borderRadius:'12px', padding:'10px 12px', border:'1px solid rgba(56,189,248,0.12)' }}>
      <div style={{ color:'#38bdf8', fontSize:'0.6rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'8px' }}>
        📡 {city.name.toUpperCase()} — 7-DAY OPEN-METEO FORECAST
      </div>
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
              {precip > 0.01 && (
                <div style={{ color:'#60a5fa', fontSize:'0.52rem', marginTop:'2px', fontFamily:"'Courier New',monospace" }}>
                  {precip.toFixed(2)}"
                </div>
              )}
              {precipProb > 20 && (
                <div style={{ color:'#64748b', fontSize:'0.5rem', fontFamily:"'Courier New',monospace" }}>
                  {precipProb}%💧
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function PolyWeather() {
  const [markets, setMarkets]       = useState([]);
  const [forecasts, setForecasts]   = useState({});
  const [loading, setLoading]       = useState(true);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [error, setError]           = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);
  const [filterSignal, setFilterSignal] = useState('ALL'); // ALL | BUY | HOLD
  const [sortBy, setSortBy]         = useState('edge'); // edge | volume | closes

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rawMarkets = await fetchPolyWeatherMarkets();

      // Filter to markets that mention weather and have a city we know
      const weatherMarkets = rawMarkets.filter(m => {
        const q = (m.question || '').toLowerCase();
        return q.includes('highest temperature in') || q.includes('lowest temperature in');
      });

      setMarkets(weatherMarkets);
      setLastUpdated(new Date());

      // Fetch forecasts for all cities that appear in markets
      setForecastLoading(true);
      const citiesNeeded = new Set();
      for (const m of weatherMarkets) {
        const city = extractCity(m.question || '');
        if (city) citiesNeeded.add(city.name);
      }

      // Always load all 8 cities
      CITIES.forEach(c => citiesNeeded.add(c.name));

      const forecastResults = {};
      const cityList = CITIES.filter(c => citiesNeeded.has(c.name));
      for (let i = 0; i < cityList.length; i++) {
        const city = cityList[i];
        try {
          const f = await fetchForecast(city);
          forecastResults[city.name] = f;
          if (i < cityList.length - 1) await sleep(200); // gentle rate limiting
        } catch(e) {
          console.warn(`Forecast failed for ${city.name}:`, e);
        }
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

  // Enrich markets with city + signal
  const enrichedMarkets = useMemo(() => {
    return markets.map(m => {
      const city = extractCity(m.question || '');
      const forecast = city ? forecasts[city.name] : null;
      const parsed = parseWeatherQuestion(m.question || '');
      const sig = computeSignal(m, forecast, parsed, city);
      return { ...m, city, forecast, parsed, sig };
    });
  }, [markets, forecasts]);

  // Filter + sort
  const displayMarkets = useMemo(() => {
    let filtered = enrichedMarkets;
    if (filterSignal === 'BUY') filtered = filtered.filter(m => m.sig.signal === 'BUY_YES' || m.sig.signal === 'BUY_NO');
    if (filterSignal === 'HOLD') filtered = filtered.filter(m => m.sig.signal === 'HOLD');
    if (selectedCity) filtered = filtered.filter(m => m.city?.name === selectedCity);

    filtered.sort((a, b) => {
      if (sortBy === 'edge') return Math.abs(b.sig.edge||0) - Math.abs(a.sig.edge||0);
      if (sortBy === 'volume') return (parseFloat(b.volumeNum||b.volume||0)) - (parseFloat(a.volumeNum||a.volume||0));
      if (sortBy === 'closes') return new Date(a.endDate||0) - new Date(b.endDate||0);
      return 0;
    });
    return filtered;
  }, [enrichedMarkets, filterSignal, selectedCity, sortBy]);

  const buySignals = enrichedMarkets.filter(m => m.sig.signal==='BUY_YES'||m.sig.signal==='BUY_NO').length;
  const avgEdge = enrichedMarkets.filter(m=>m.sig.edge!==null).reduce((s,m)=>s+Math.abs(m.sig.edge),0) / Math.max(1, enrichedMarkets.filter(m=>m.sig.edge!==null).length);

  // City forecast preview
  const previewCity = selectedCity ? CITIES.find(c=>c.name===selectedCity) : CITIES[0];
  const previewForecast = previewCity ? forecasts[previewCity.name] : null;

  return (
    <div>
      {/* Header banner */}
      <div style={{ background:'rgba(56,189,248,0.07)', border:'1px solid rgba(56,189,248,0.2)', borderRadius:'12px', padding:'10px 13px', marginBottom:'12px', fontFamily:"'Courier New',monospace" }}>
        <div style={{ color:'#38bdf8', fontWeight:'700', fontSize:'0.72rem', letterSpacing:'0.08em', marginBottom:'3px' }}>
          🌦 POLYMARKET WEATHER SIGNALS
        </div>
        <div style={{ color:'#64748b', fontSize:'0.6rem', lineHeight:1.5 }}>
          Live market odds vs Open-Meteo + NOAA forecast models. Green = YES undervalued, Red = NO undervalued.
          {lastUpdated && <span style={{ color:'#334155' }}> · Updated {lastUpdated.toLocaleTimeString()}</span>}
        </div>
      </div>

      {/* Stats row */}
      {!loading && (
        <div style={{ display:'flex', gap:'8px', marginBottom:'12px' }}>
          {[
            { label:'MARKETS', val: markets.length, color:'#e2e8f0' },
            { label:'BUY SIGNALS', val: buySignals, color: buySignals > 0 ? '#4ade80' : '#64748b' },
            { label:'AVG EDGE', val: `${(avgEdge*100).toFixed(0)}%`, color: avgEdge > 0.15 ? '#4ade80' : '#64748b' },
          ].map(({ label, val, color }) => (
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
          <button key={val} onClick={()=>setFilterSignal(val)} style={{ padding:'5px 10px', borderRadius:'8px', border:'1px solid rgba(255,255,255,0.08)', background:filterSignal===val?'#38bdf8':'rgba(255,255,255,0.04)', color:filterSignal===val?'#000':'#94a3b8', fontSize:'0.62rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.06em', cursor:'pointer', fontWeight:filterSignal===val?'700':'400' }}>{label}</button>
        ))}
        <div style={{ width:'1px', background:'rgba(255,255,255,0.08)', margin:'0 2px' }}/>
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
        <div style={{ width:'1px', background:'rgba(255,255,255,0.08)', margin:'0 2px' }}/>
        <span style={{ color:'#334155', fontSize:'0.58rem', fontFamily:"'Courier New',monospace" }}>CITY:</span>
        <button onClick={()=>setSelectedCity(null)} style={{ padding:'4px 8px', borderRadius:'6px', border:'1px solid rgba(255,255,255,0.07)', background:!selectedCity?'rgba(56,189,248,0.15)':'rgba(255,255,255,0.03)', color:!selectedCity?'#38bdf8':'#475569', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", cursor:'pointer' }}>All</button>
        {CITIES.map(c=>(
          <button key={c.name} onClick={()=>setSelectedCity(c.name===selectedCity?null:c.name)} style={{ padding:'4px 8px', borderRadius:'6px', border:'1px solid rgba(255,255,255,0.07)', background:selectedCity===c.name?'rgba(56,189,248,0.15)':'rgba(255,255,255,0.03)', color:selectedCity===c.name?'#38bdf8':'#475569', fontSize:'0.58rem', fontFamily:"'Courier New',monospace", cursor:'pointer' }}>{c.name.split(' ')[0]}</button>
        ))}
      </div>

      {/* Forecast strip for selected/default city */}
      {previewForecast && previewCity && (
        <ForecastStrip city={previewCity} forecast={previewForecast} />
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign:'center', padding:'40px 20px' }}>
          <div style={{ color:'#38bdf8', fontSize:'1.5rem', marginBottom:'10px' }}>🌦</div>
          <div style={{ color:'#64748b', fontSize:'0.75rem', fontFamily:"'Courier New',monospace" }}>
            Fetching Polymarket weather markets…
          </div>
          {forecastLoading && <div style={{ color:'#334155', fontSize:'0.65rem', marginTop:'6px', fontFamily:"'Courier New',monospace" }}>Loading NOAA forecasts…</div>}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:'12px', padding:'14px', marginBottom:'12px', color:'#f87171', fontSize:'0.72rem', fontFamily:"'Courier New',monospace" }}>
          ⚠ {error}
          <div style={{ marginTop:'6px', color:'#64748b', fontSize:'0.62rem' }}>
            Polymarket's API may have CORS restrictions from the browser. The forecast data will still load.
          </div>
        </div>
      )}

      {/* No markets */}
      {!loading && markets.length === 0 && (
        <div style={{ background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'12px', padding:'14px', marginBottom:'14px' }}>
          <div style={{ color:'#f59e0b', fontWeight:'700', fontSize:'0.72rem', fontFamily:"'Courier New',monospace", marginBottom:'6px' }}>
            NO ACTIVE TEMPERATURE MARKETS
          </div>
          <div style={{ color:'#94a3b8', fontSize:'0.68rem', lineHeight:1.6 }}>
            Polymarket has no active "Highest temperature in" markets right now, or the API returned 0 results. Check back soon — new daily markets open each morning.
          </div>
        </div>
      )}

      {/* Market signal cards */}
      {!loading && displayMarkets.length > 0 && (
        <div>
          <div style={{ color:'#334155', fontSize:'0.6rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'10px' }}>
            {displayMarkets.length} MARKET{displayMarkets.length!==1?'S':''} · SORTED BY {sortBy.toUpperCase()}
          </div>
          {displayMarkets.map((m, i) => (
            <SignalCard key={m.id || i} market={m} forecast={m.forecast} city={m.city} />
          ))}
        </div>
      )}

      {/* All-city forecast grid (always shown) */}
      {!forecastLoading && Object.keys(forecasts).length > 0 && (
        <div style={{ marginTop:'16px' }}>
          <div style={{ color:'#334155', fontSize:'0.6rem', fontFamily:"'Courier New',monospace", letterSpacing:'0.1em', marginBottom:'10px' }}>
            📡 ALL CITY FORECASTS — OPEN-METEO · 24H HIGH / LOW
          </div>
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
        Signals from Open-Meteo + NOAA · Not financial advice · Verify before trading
      </div>
    </div>
  );
}
