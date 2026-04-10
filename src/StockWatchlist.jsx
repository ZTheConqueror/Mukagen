import { useState, useEffect, useMemo } from "react";
import Gauge from "./Gauge.jsx";

// ── INDICATOR MATH ───────────────────────────────────────────────────────────
function calcEMA(prices, period) {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const emas = [ema];
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    emas.push(ema);
  }
  return emas;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    ag = (ag * (period - 1) + Math.max(0,  d)) / period;
    al = (al * (period - 1) + Math.max(0, -d)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function calcMACD(prices) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (!ema12.length || !ema26.length) return null;
  const offset = 14;
  const macdLine = ema26.map((v, i) => ema12[i + offset] - v);
  const signal   = calcEMA(macdLine, 9);
  if (!signal.length) return null;
  const aligned = macdLine.slice(macdLine.length - signal.length);
  const hist    = signal.map((s, i) => aligned[i] - s);
  return { histogram: hist[hist.length - 1] };
}

function calcComposite(prices) {
  const scores = [];
  const rsi = calcRSI(prices, 14);
  if (rsi !== null) scores.push({ name: 'RSI', score: Math.max(-1, Math.min(1, (rsi - 50) / 50)), display: rsi.toFixed(1) });

  const macd = calcMACD(prices);
  if (macd) {
    const s = Math.max(-1, Math.min(1, (macd.histogram / prices[prices.length - 1]) * 500));
    scores.push({ name: 'MACD', score: s, display: macd.histogram > 0 ? '+bullish' : '−bearish' });
  }

  const e9  = calcEMA(prices, 9);
  const e21 = calcEMA(prices, 21);
  if (e9.length && e21.length) {
    const spread = (e9[e9.length-1] - e21[e21.length-1]) / e21[e21.length-1];
    scores.push({ name: 'EMA 9/21', score: Math.max(-1, Math.min(1, spread * 20)), display: spread > 0 ? '9 > 21 ↑' : '9 < 21 ↓' });
  }

  const e50 = calcEMA(prices, 50);
  if (e50.length) {
    const pct = (prices[prices.length-1] - e50[e50.length-1]) / e50[e50.length-1];
    scores.push({ name: 'vs EMA50', score: Math.max(-1, Math.min(1, pct * 10)), display: `${pct >= 0 ? '+' : ''}${(pct*100).toFixed(1)}%` });
  }

  const composite = scores.length ? scores.reduce((s, x) => s + x.score, 0) / scores.length : 0;
  return { composite, breakdown: scores };
}

// ── WATCHLIST CONFIG ─────────────────────────────────────────────────────────
const WATCHLIST = [
  { ticker: 'SNOW',  name: 'Snowflake',        sector: 'Cloud Data' },
  { ticker: 'META',  name: 'Meta',             sector: 'Social/AI' },
  { ticker: 'NVDA',  name: 'NVIDIA',           sector: 'Semiconductors' },
  { ticker: 'AMZN',  name: 'Amazon',           sector: 'Cloud/E-Commerce' },
  { ticker: 'ADBE',  name: 'Adobe',            sector: 'Creative SaaS' },
  { ticker: 'NOW',   name: 'ServiceNow',       sector: 'Enterprise SaaS' },
  { ticker: 'PLTR',  name: 'Palantir',         sector: 'Defense AI' },
  { ticker: 'MSFT',  name: 'Microsoft',        sector: 'Enterprise Cloud' },
  { ticker: 'CRM',   name: 'Salesforce',       sector: 'CRM SaaS' },
  { ticker: 'TSLA',  name: 'Tesla',            sector: 'EV/Energy' },
  { ticker: 'ORCL',  name: 'Oracle',           sector: 'Cloud DB' },
  { ticker: 'AMD',   name: 'AMD',              sector: 'Semiconductors' },
  { ticker: 'SOFI',  name: 'SoFi',             sector: 'Fintech' },
  { ticker: 'GEV',   name: 'GE Vernova',       sector: 'Energy Infra' },
  { ticker: 'TNK',   name: 'Teekay Tankers',   sector: 'Marine/Crude' },
  { ticker: 'STNG',  name: 'Scorpio Tankers',  sector: 'Marine/Products' },
  { ticker: 'BYD',   name: 'Boyd Gaming',      sector: 'Gaming/Leisure' },
  { ticker: 'RKLB',  name: 'Rocket Lab',       sector: 'Space/Launch' },
  { ticker: 'MU',    name: 'Micron',           sector: 'Memory/AI Chips' },
];

const CONVICTION = {
  NVDA: { near: '⚠️', long: '🟢', note: 'AI capex intact. Buy dips aggressively.' },
  META: { near: '⚠️', long: '🟢', note: 'Fortress balance sheet. Oil irrelevant to biz.' },
  MSFT: { near: '🟡', long: '🟢', note: 'Most recession-resilient. Azure sticky.' },
  AMZN: { near: '⚠️', long: '🟢', note: 'Fuel hits logistics. AWS offsets long-term.' },
  PLTR: { near: '🟢', long: '🟢', note: 'Defense AI demand rises in wartime. Best setup.' },
  NOW:  { near: '🟡', long: '🟢', note: 'Sticky enterprise SaaS. Rate-valuation risk.' },
  ORCL: { near: '🟡', long: '🟡', note: 'Cloud growth real but slower than peers.' },
  CRM:  { near: '⚠️', long: '🟡', note: 'Underperforms in rate spikes. High multiple.' },
  AMD:  { near: '⚠️', long: '🟢', note: 'Trades with NVDA. Supply chain semi risk.' },
  ADBE: { near: '⚠️', long: '🟡', note: 'AI disruption narrative + rate sensitivity.' },
  SNOW: { near: '🔴', long: '🟡', note: 'Highest multiple. Most rate-sensitive. Avoid near-term.' },
  TSLA: { near: '🔴', long: '🟡', note: 'Brand damage structural. Sentiment toxic.' },
  SOFI: { near: '🔴', long: '🟡', note: 'Rate hike env is worst case. Highest risk.' },
  GEV:  { near: '🟢', long: '🟢', note: '$150B backlog, AI data center power demand. Strong Buy consensus.' },
  TNK:  { near: '🟢', long: '🟢', note: 'Zero net debt, $853M cash. Hormuz disruption is a direct tailwind.' },
  STNG: { near: '🟢', long: '🟢', note: 'Net cash $334M. Q4 TCE +28% YoY. Hormuz rerouting boosts tonne-miles.' },
  BYD:  { near: '🟡', long: '🟡', note: 'Casino gaming resilient. Q4 EPS beat. Neutral — hold for steady cash flow.' },
  RKLB: { near: '⚠️', long: '🟢', note: 'Q4 revenue ~$180M (+36% YoY), $1.85B backlog. Down ~37% from ATH — strong Buy consensus.' },
  MU:   { near: '🟡', long: '🟢', note: 'AI memory supercycle. Q2 FY26 $23.86B revenue, HBM4 supply committed to NVDA.' },
};

// ── HOW TO READ panel ────────────────────────────────────────────────────────
function ReadingGuide({ onClose }) {
  return (
    <div style={{
      background: '#0d1120', border: '1px solid rgba(56,189,248,0.25)',
      borderRadius: '16px', padding: '18px 16px', marginBottom: '16px', position: 'relative',
    }}>
      <button onClick={onClose} style={{
        position: 'absolute', top: '10px', right: '12px',
        background: 'none', border: 'none', color: '#64748b', fontSize: '1.1rem', cursor: 'pointer',
      }}>×</button>
      <div style={{ color: '#38bdf8', fontWeight: '700', fontSize: '0.78rem', fontFamily: "'Courier New', monospace", letterSpacing: '0.1em', marginBottom: '12px' }}>
        📖 HOW TO READ THIS
      </div>
      {[
        { label: 'Sparkline',    desc: '90 days of closing prices. Green = up from 90 days ago, red = down.' },
        { label: 'TREND bar',   desc: 'Composite technical score. Right (green) = bullish, left (red) = bearish. -100 to +100.' },
        { label: 'Gauge',       desc: 'Sweeps left (bearish) to right (bullish). +100% = all indicators agree bullish.' },
        { label: 'RSI',         desc: 'Above 70 = overbought. Below 30 = oversold. 50 = neutral.' },
        { label: 'MACD',        desc: '+bullish means short-term momentum accelerating upward.' },
        { label: 'EMA 9/21',    desc: '"9 > 21 ↑" = fast average above slow = bullish crossover signal.' },
        { label: 'vs EMA50',    desc: 'How far price is above (+) or below (−) the 50-day moving average.' },
        { label: 'Near/Long',   desc: '🟢 positive · 🟡 neutral · ⚠️ caution · 🔴 avoid. Near = weeks, Long = 6–12 months.' },
        { label: '👑 Crown',    desc: 'Top-ranked stock by live composite technical score right now.' },
      ].map(({ label, desc }) => (
        <div key={label} style={{ marginBottom: '9px', display: 'flex', gap: '10px' }}>
          <div style={{ color: '#38bdf8', fontSize: '0.65rem', fontFamily: "'Courier New', monospace", fontWeight: '700', minWidth: '80px', flexShrink: 0 }}>{label}</div>
          <div style={{ color: '#94a3b8', fontSize: '0.65rem', lineHeight: 1.5 }}>{desc}</div>
        </div>
      ))}
      <div style={{ marginTop: '10px', padding: '8px 10px', background: 'rgba(248,113,113,0.08)', borderRadius: '8px', color: '#f87171', fontSize: '0.6rem', fontFamily: "'Courier New', monospace", lineHeight: 1.5 }}>
        ⚠ Technical signals only — not financial advice.
      </div>
    </div>
  );
}

// ── STOCK ROW ────────────────────────────────────────────────────────────────
function StockRowWithRank({ ticker, name, sector, rank, isTop, onComposite }) {
  const [prices, setPrices]     = useState([]);
  const [quote, setQuote]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // ── KEY FIX: use /api/yahoo in production (Vercel), /yahoo locally (Vite proxy) ──
        const base = window.location.hostname === 'localhost' ? '/yahoo' : '/api/yahoo';
        const url  = `${base}/v8/finance/chart/${ticker}?interval=1d&range=90d`;
        const res  = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`${res.status}`);
        const data   = await res.json();
        const result = data.chart.result[0];
        const closes = result.indicators.quote[0].close.filter(Boolean);
        const meta   = result.meta;
        if (!cancelled) {
          setPrices(closes);
          setQuote({ price: meta.regularMarketPrice, prev: meta.chartPreviousClose });
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [ticker]);

  const { composite, breakdown } = useMemo(() => calcComposite(prices), [prices]);

  useEffect(() => {
    if (prices.length > 0) onComposite(ticker, composite);
  }, [composite, ticker, prices.length]);

  const pctChange = quote
    ? ((quote.price - quote.prev) / quote.prev * 100)
    : prices.length >= 2
      ? ((prices[prices.length-1] - prices[prices.length-2]) / prices[prices.length-2] * 100)
      : null;

  const pctChange14d = prices.length >= 14
    ? ((prices[prices.length-1] - prices[prices.length-14]) / prices[prices.length-14] * 100)
    : null;

  const conv       = CONVICTION[ticker];
  const scoreColor = (s) => s > 0.1 ? '#4ade80' : s < -0.1 ? '#f87171' : '#94a3b8';
  const formatPrice = (p) => p >= 1000
    ? `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${p?.toFixed(2) ?? '--'}`;

  const rankColors = ['#f59e0b', '#94a3b8', '#cd7c3f'];
  const rankColor  = rank <= 3 ? rankColors[rank - 1] : '#334155';

  return (
    <div style={{
      background: isTop ? 'rgba(245,158,11,0.06)' : '#0d1120',
      borderRadius: '14px',
      border: isTop ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(255,255,255,0.07)',
      marginBottom: '10px', overflow: 'hidden',
    }}>
      <button onClick={() => setExpanded(v => !v)} style={{
        width: '100%', background: 'none', border: 'none',
        padding: '14px 14px 12px', cursor: 'pointer', textAlign: 'left',
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px', minWidth:0 }}>
            <div style={{
              width:'28px', height:'28px', borderRadius:'50%', flexShrink:0,
              background:`${rankColor}22`, border:`1.5px solid ${rankColor}`,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize: isTop ? '0.9rem' : '0.6rem', fontWeight:'700',
              color:rankColor, fontFamily:"'Courier New', monospace",
            }}>
              {isTop ? '👑' : `#${rank}`}
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <span style={{ color:'#e2e8f0', fontWeight:'700', fontSize:'1rem', fontFamily:"'Courier New', monospace" }}>{ticker}</span>
                {conv && <span style={{ fontSize:'0.7rem' }}>{conv.near}{conv.long}</span>}
              </div>
              <div style={{ color:'#475569', fontSize:'0.65rem', letterSpacing:'0.05em' }}>{sector}</div>
            </div>
          </div>

          <div style={{ textAlign:'right', flexShrink:0 }}>
            {loading ? (
              <div style={{ color:'#475569', fontSize:'0.8rem' }}>loading…</div>
            ) : error ? (
              <div style={{ color:'#f59e0b', fontSize:'0.72rem' }}>unavailable</div>
            ) : (
              <>
                <div style={{ color:'#e2e8f0', fontWeight:'700', fontSize:'0.95rem', fontFamily:"'Courier New', monospace" }}>
                  {formatPrice(quote?.price ?? prices[prices.length-1])}
                </div>
                <div style={{ display:'flex', gap:'6px', justifyContent:'flex-end' }}>
                  {pctChange !== null && (
                    <span style={{ fontSize:'0.68rem', color: pctChange >= 0 ? '#4ade80' : '#f87171' }}>
                      {pctChange >= 0 ? '▲' : '▼'}{Math.abs(pctChange).toFixed(2)}%
                    </span>
                  )}
                  {pctChange14d !== null && (
                    <span style={{ fontSize:'0.68rem', color:'#64748b' }}>
                      14d:{pctChange14d >= 0 ? '+' : ''}{pctChange14d.toFixed(1)}%
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {!loading && !error && prices.length > 1 && (
          <div style={{ marginTop:'8px' }}>
            <svg viewBox="0 0 200 28" width="100%" height="28" preserveAspectRatio="none">
              {(() => {
                const min = Math.min(...prices), max = Math.max(...prices);
                const pts = prices.map((p,i) => ({
                  x: (i/(prices.length-1))*200,
                  y: 25 - ((p-min)/(max-min||1))*22,
                }));
                const d   = pts.map((p,i) => `${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');
                const clr = prices[prices.length-1] > prices[0] ? '#4ade80' : '#f87171';
                return (
                  <>
                    <defs>
                      <linearGradient id={`sp-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={clr} stopOpacity="0.2"/>
                        <stop offset="100%" stopColor={clr} stopOpacity="0"/>
                      </linearGradient>
                    </defs>
                    <path d={`${d} L 200 28 L 0 28 Z`} fill={`url(#sp-${ticker})`}/>
                    <path d={d} fill="none" stroke={clr} strokeWidth="1.5" strokeLinecap="round"/>
                  </>
                );
              })()}
            </svg>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'5px' }}>
              <span style={{ color:'#475569', fontSize:'0.6rem', fontFamily:"'Courier New', monospace", flexShrink:0 }}>TREND</span>
              <div style={{ flex:1, height:'4px', background:'rgba(255,255,255,0.06)', borderRadius:'2px', position:'relative' }}>
                <div style={{
                  position:'absolute',
                  left: composite >= 0 ? '50%' : `${((composite+1)/2)*100}%`,
                  width:`${Math.abs(composite)*50}%`,
                  height:'100%', background:scoreColor(composite), borderRadius:'2px',
                }}/>
                <div style={{ position:'absolute', left:'50%', top:0, width:'1px', height:'100%', background:'rgba(255,255,255,0.15)' }}/>
              </div>
              <span style={{ color:scoreColor(composite), fontSize:'0.6rem', fontFamily:"'Courier New', monospace", flexShrink:0 }}>
                {composite >= 0 ? '+' : ''}{(composite*100).toFixed(0)}
              </span>
            </div>
          </div>
        )}
      </button>

      {expanded && (
        <div style={{ padding:'0 14px 14px', borderTop:'1px solid rgba(255,255,255,0.05)' }}>
          {conv && (
            <div style={{
              background:'rgba(255,255,255,0.03)', borderRadius:'8px',
              padding:'10px 12px', margin:'12px 0 10px',
              fontSize:'0.72rem', color:'#94a3b8', lineHeight:1.5,
              fontFamily:"'Courier New', monospace",
            }}>
              <span style={{ color:'#cbd5e1', fontWeight:'700' }}>Analysis: </span>
              {conv.note}
              <div style={{ marginTop:'4px', color:'#475569', fontSize:'0.62rem' }}>
                Near-term {conv.near} · Long-term {conv.long}
              </div>
            </div>
          )}
          {!loading && !error && (
            <div style={{ display:'flex', justifyContent:'center', margin:'4px 0 10px' }}>
              <Gauge value={composite} label="Trend Score" />
            </div>
          )}
          {breakdown.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
              {breakdown.map(({ name, score, display }) => (
                <div key={name}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'3px' }}>
                    <span style={{ color:'#94a3b8', fontSize:'0.65rem', fontFamily:"'Courier New', monospace" }}>{name}</span>
                    <span style={{ color:scoreColor(score), fontSize:'0.65rem', fontFamily:"'Courier New', monospace" }}>{display}</span>
                  </div>
                  <div style={{ height:'4px', background:'rgba(255,255,255,0.06)', borderRadius:'2px', position:'relative' }}>
                    <div style={{
                      position:'absolute',
                      left: score >= 0 ? '50%' : `${((score+1)/2)*100}%`,
                      width:`${Math.abs(score)*50}%`,
                      height:'100%', background:scoreColor(score), borderRadius:'2px',
                    }}/>
                    <div style={{ position:'absolute', left:'50%', top:0, width:'1px', height:'100%', background:'rgba(255,255,255,0.15)' }}/>
                  </div>
                </div>
              ))}
              <div style={{ color:'#334155', fontSize:'0.58rem', textAlign:'center', marginTop:'4px', fontFamily:"'Courier New', monospace" }}>
                90-day daily closes · RSI/MACD/EMA · Not financial advice
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────────
export default function StockWatchlist() {
  const [composites, setComposites] = useState({});
  const [showGuide, setShowGuide]   = useState(false);
  const [sortBy, setSortBy]         = useState('rank');

  const handleComposite = (ticker, value) => {
    setComposites(prev => prev[ticker] === value ? prev : { ...prev, [ticker]: value });
  };

  const rankedList = useMemo(() => {
    return [...WATCHLIST]
      .map(s => ({ ...s, composite: composites[s.ticker] ?? null }))
      .sort((a, b) => {
        if (a.composite === null && b.composite === null) return 0;
        if (a.composite === null) return 1;
        if (b.composite === null) return -1;
        return b.composite - a.composite;
      });
  }, [composites]);

  const convictionOrder = { '🟢': 0, '🟡': 1, '⚠️': 2, '🔴': 3 };
  const displayList = sortBy === 'conviction'
    ? [...WATCHLIST].sort((a, b) =>
        (convictionOrder[CONVICTION[a.ticker]?.near] ?? 9) -
        (convictionOrder[CONVICTION[b.ticker]?.near] ?? 9)
      )
    : rankedList;

  return (
    <div>
      <div style={{
        background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)',
        borderRadius:'12px', padding:'10px 13px', marginBottom:'12px',
        fontSize:'0.68rem', color:'#fbbf24', fontFamily:"'Courier New', monospace", lineHeight:1.6,
      }}>
        ⚠ Tariff shock active · S&P -15% from ATH · Rate uncertainty elevated
        <span style={{ color:'#64748b' }}> — technicals only</span>
      </div>

      <div style={{ display:'flex', gap:'8px', marginBottom:'12px', alignItems:'center', flexWrap:'wrap' }}>
        {[['rank', '👑 Live Rank'], ['conviction', 'Conviction ↑']].map(([s, label]) => (
          <button key={s} onClick={() => setSortBy(s)} style={{
            padding:'6px 12px', borderRadius:'8px', border:'1px solid rgba(255,255,255,0.08)',
            background: sortBy === s ? '#38bdf8' : 'rgba(255,255,255,0.04)',
            color: sortBy === s ? '#000' : '#94a3b8',
            fontSize:'0.65rem', fontFamily:"'Courier New', monospace",
            letterSpacing:'0.08em', textTransform:'uppercase', cursor:'pointer',
            fontWeight: sortBy === s ? '700' : '400',
          }}>{label}</button>
        ))}
        <button onClick={() => setShowGuide(v => !v)} style={{
          marginLeft:'auto', padding:'6px 12px', borderRadius:'8px',
          border:'1px solid rgba(56,189,248,0.25)',
          background: showGuide ? 'rgba(56,189,248,0.15)' : 'rgba(56,189,248,0.05)',
          color:'#38bdf8', fontSize:'0.65rem', fontFamily:"'Courier New', monospace",
          letterSpacing:'0.08em', textTransform:'uppercase', cursor:'pointer',
        }}>
          {showGuide ? '✕ Guide' : '? Guide'}
        </button>
      </div>

      {showGuide && <ReadingGuide onClose={() => setShowGuide(false)} />}

      {displayList.map((stock, i) => (
        <StockRowWithRank
          key={stock.ticker}
          ticker={stock.ticker}
          name={stock.name}
          sector={stock.sector}
          rank={i + 1}
          isTop={sortBy === 'rank' && i === 0}
          onComposite={handleComposite}
        />
      ))}
    </div>
  );
}
