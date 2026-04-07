import { useState, useEffect, useMemo } from "react";
import Gauge from "./Gauge.jsx";

const COIN_META = {
  bitcoin:     { symbol: "BTC",  color: "#f7931a", emoji: "₿" },
  ethereum:    { symbol: "ETH",  color: "#627eea", emoji: "Ξ" },
  solana:      { symbol: "SOL",  color: "#9945ff", emoji: "◎" },
  sui:         { symbol: "SUI",  color: "#4da2ff", emoji: "◈" },
  binancecoin: { symbol: "BNB",  color: "#f3ba2f", emoji: "⬡" },
  fartcoin:    { symbol: "FART", color: "#7cfc00", emoji: "💨" },
};

function calcEMA(prices, period) {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const emas = [ema];
  for (let i = period; i < prices.length; i++) { ema = prices[i] * k + ema * (1 - k); emas.push(ema); }
  return emas;
}
function calcSMA(prices, period) {
  if (prices.length < period) return [];
  const smas = [];
  for (let i = period - 1; i < prices.length; i++) smas.push(prices.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period);
  return smas;
}
function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) { const d = prices[i]-prices[i-1]; if (d>=0) gains+=d; else losses-=d; }
  let ag = gains/period, al = losses/period;
  for (let i = period+1; i < prices.length; i++) { const d = prices[i]-prices[i-1]; ag=(ag*(period-1)+Math.max(0,d))/period; al=(al*(period-1)+Math.max(0,-d))/period; }
  if (al===0) return 100;
  return 100 - 100/(1+ag/al);
}
function calcMACD(prices) {
  const ema12=calcEMA(prices,12), ema26=calcEMA(prices,26);
  if (!ema12.length||!ema26.length) return null;
  const macdLine=ema26.map((v,i)=>ema12[i+14]-v);
  const signal=calcEMA(macdLine,9);
  if (!signal.length) return null;
  const aligned=macdLine.slice(macdLine.length-signal.length);
  const hist=signal.map((s,i)=>aligned[i]-s);
  return { histogram:hist[hist.length-1], histPrev:hist.length>1?hist[hist.length-2]:null };
}
function calcBollinger(prices, period=20, mult=2) {
  if (prices.length<period) return null;
  const smas=calcSMA(prices,period);
  const results=[];
  for (let i=period-1;i<prices.length;i++) {
    const slice=prices.slice(i-period+1,i+1), mean=smas[i-(period-1)];
    const std=Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/period);
    results.push({upper:mean+mult*std,middle:mean,lower:mean-mult*std});
  }
  const latest=results[results.length-1], price=prices[prices.length-1];
  const bandwidth=(latest.upper-latest.lower)/latest.middle;
  const percentB=(price-latest.lower)/(latest.upper-latest.lower||1);
  const recentBWs=results.slice(-20).map(r=>(r.upper-r.lower)/r.middle);
  const bwMin=Math.min(...recentBWs),bwMax=Math.max(...recentBWs);
  const bwPct=bwMax>bwMin?(bandwidth-bwMin)/(bwMax-bwMin):0.5;
  return {...latest,bandwidth,percentB,squeeze:bwPct<0.2,bwPct};
}
function calcATR(prices, period=14) {
  if (prices.length<period+1) return null;
  const trs=[];
  for (let i=1;i<prices.length;i++) trs.push(Math.abs(prices[i]-prices[i-1]));
  let atr=trs.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for (let i=period;i<trs.length;i++) atr=(atr*(period-1)+trs[i])/period;
  return (atr/prices[prices.length-1])*100;
}
function calcRSISeries(prices, period=14) {
  if (prices.length<period+1) return [];
  const series=[];
  for (let end=period+1;end<=prices.length;end++) series.push(calcRSI(prices.slice(0,end),period)??50);
  return series;
}
function detectDivergence(prices, rsiValues) {
  if (prices.length<10||rsiValues.length<10) return null;
  const n=Math.min(prices.length,rsiValues.length);
  const p=prices.slice(-n), r=rsiValues.slice(-n);
  const lows=[],highs=[];
  for (let i=1;i<p.length-1;i++) { if(p[i]<p[i-1]&&p[i]<p[i+1]) lows.push(i); if(p[i]>p[i-1]&&p[i]>p[i+1]) highs.push(i); }
  if (lows.length>=2) { const [i1,i2]=[lows[lows.length-2],lows[lows.length-1]]; if(p[i2]<p[i1]&&r[i2]>r[i1]+2) return {type:'bullish'}; }
  if (highs.length>=2) { const [i1,i2]=[highs[highs.length-2],highs[highs.length-1]]; if(p[i2]>p[i1]&&r[i2]<r[i1]-2) return {type:'bearish'}; }
  return null;
}
function calcCompositeScore(prices) {
  if (prices.length<15) return {composite:0,breakdown:[],bb:null,atr:null,divergence:null};
  const scores=[];
  const rsi=calcRSI(prices,14);
  if (rsi!==null) scores.push({name:'RSI',value:rsi,score:Math.max(-1,Math.min(1,(rsi-50)/50))});
  const macd=calcMACD(prices);
  if (macd) { const s=Math.max(-1,Math.min(1,(macd.histogram/prices[prices.length-1])*500)); const accel=macd.histPrev!==null?(macd.histogram>macd.histPrev?0.1:-0.1):0; scores.push({name:'MACD',value:macd.histogram,score:Math.max(-1,Math.min(1,s+accel))}); }
  const e9=calcEMA(prices,9),e21=calcEMA(prices,21);
  if (e9.length&&e21.length) { const spread=(e9[e9.length-1]-e21[e21.length-1])/e21[e21.length-1]; scores.push({name:'EMA 9/21',value:{e9:e9[e9.length-1],e21:e21[e21.length-1]},score:Math.max(-1,Math.min(1,spread*20))}); }
  const e50=calcEMA(prices,50);
  if (e50.length) { const pct=(prices[prices.length-1]-e50[e50.length-1])/e50[e50.length-1]; scores.push({name:'vs EMA50',value:{price:prices[prices.length-1],e50:e50[e50.length-1]},score:Math.max(-1,Math.min(1,pct*10))}); }
  const bb=calcBollinger(prices);
  if (bb) scores.push({name:'Bollinger %B',value:bb.percentB,score:Math.max(-1,Math.min(1,(bb.percentB-0.5)*2))});
  const composite=scores.length?scores.reduce((sum,s)=>sum+s.score,0)/scores.length:0;
  const rsiSeries=calcRSISeries(prices);
  return {composite,breakdown:scores,bb,atr:calcATR(prices),divergence:detectDivergence(prices,rsiSeries)};
}
function calc14dMomentum(prices) {
  if (prices.length<14) return 0;
  const recent=prices.slice(-14);
  return Math.max(-1,Math.min(1,((recent[recent.length-1]-recent[0])/recent[0])*6));
}

function BollingerMiniChart({prices,coinId}) {
  if (prices.length<20) return null;
  const last30=prices.slice(-30), period=20;
  const bbPoints=[];
  for (let i=period-1;i<last30.length;i++) {
    const slice=last30.slice(i-period+1,i+1), mean=slice.reduce((a,b)=>a+b,0)/period;
    const std=Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/period);
    bbPoints.push({upper:mean+2*std,middle:mean,lower:mean-2*std,price:last30[i]});
  }
  if (bbPoints.length<2) return null;
  const allVals=bbPoints.flatMap(p=>[p.upper,p.lower]);
  const minV=Math.min(...allVals),maxV=Math.max(...allVals);
  const norm=v=>42-((v-minV)/(maxV-minV||1))*38;
  const x=i=>(i/(bbPoints.length-1))*200;
  const upperD=bbPoints.map((p,i)=>`${i===0?'M':'L'} ${x(i)} ${norm(p.upper)}`).join(' ');
  const midD=bbPoints.map((p,i)=>`${i===0?'M':'L'} ${x(i)} ${norm(p.middle)}`).join(' ');
  const lowerD=bbPoints.map((p,i)=>`${i===0?'M':'L'} ${x(i)} ${norm(p.lower)}`).join(' ');
  const priceD=bbPoints.map((p,i)=>`${i===0?'M':'L'} ${x(i)} ${norm(p.price)}`).join(' ');
  const fillD=upperD+' '+bbPoints.map((p,i)=>`L ${x(bbPoints.length-1-i)} ${norm(bbPoints[bbPoints.length-1-i].lower)}`).join(' ')+' Z';
  const priceColor=bbPoints[bbPoints.length-1].price>=bbPoints[bbPoints.length-1].middle?'#4ade80':'#f87171';
  const bws=bbPoints.map(p=>(p.upper-p.lower)/p.middle), bw=bws[bws.length-1], mn=Math.min(...bws), mx=Math.max(...bws);
  const squeeze=mx>mn?(bw-mn)/(mx-mn)<0.2:false;
  return (
    <div style={{marginBottom:'10px'}}>
      <div style={{color:'#475569',fontSize:'0.6rem',fontFamily:"'Courier New',monospace",letterSpacing:'0.1em',marginBottom:'4px',display:'flex',justifyContent:'space-between'}}>
        <span>BOLLINGER BANDS (20,2σ) · 30d</span>
        {squeeze&&<span style={{color:'#f59e0b',fontWeight:'700'}}>⚡ SQUEEZE</span>}
      </div>
      <svg viewBox="0 0 200 46" width="100%" height="46" preserveAspectRatio="none">
        <defs><linearGradient id={`bb-${coinId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.08"/><stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02"/></linearGradient></defs>
        <path d={fillD} fill={`url(#bb-${coinId})`}/>
        <path d={upperD} fill="none" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.5" strokeDasharray="3,2"/>
        <path d={lowerD} fill="none" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.5" strokeDasharray="3,2"/>
        <path d={midD} fill="none" stroke="#38bdf8" strokeWidth="0.6" strokeOpacity="0.3"/>
        <path d={priceD} fill="none" stroke={priceColor} strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

function ATRMeter({atr}) {
  if (atr===null) return null;
  const level=atr<1?0:atr<3?1:atr<6?2:3;
  const labels=['Low','Normal','High','Extreme'], colors=['#4ade80','#94a3b8','#f59e0b','#f87171'];
  return (
    <div style={{marginBottom:'10px'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}>
        <span style={{color:'#475569',fontSize:'0.6rem',fontFamily:"'Courier New',monospace",letterSpacing:'0.1em'}}>VOLATILITY (ATR 14)</span>
        <span style={{color:colors[level],fontSize:'0.6rem',fontFamily:"'Courier New',monospace",fontWeight:'700'}}>{atr.toFixed(1)}% · {labels[level]}</span>
      </div>
      <div style={{height:'4px',background:'rgba(255,255,255,0.06)',borderRadius:'2px',overflow:'hidden'}}>
        <div style={{height:'100%',width:`${Math.min(100,(atr/8)*100)}%`,background:colors[level],borderRadius:'2px',transition:'width 0.5s ease'}}/>
      </div>
    </div>
  );
}

// fetchIndex = position in list (0,1,2…). Each coin is staggered by 7s to avoid CoinGecko rate limiting.
export default function CryptoGauge({coinId="bitcoin", fetchIndex=0, rank=null, isTop=false, onComposite}) {
  const [priceData,setPriceData]=useState([]);
  const [currentPrice,setCurrentPrice]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  const [showBreakdown,setShowBreakdown]=useState(false);
  const [waited,setWaited]=useState(fetchIndex===0);

  const meta=COIN_META[coinId]||{symbol:coinId.toUpperCase(),color:"#888",emoji:"?"};

  useEffect(()=>{
    if (fetchIndex===0) return;
    const t=setTimeout(()=>setWaited(true),fetchIndex*7000);
    return ()=>clearTimeout(t);
  },[fetchIndex]);

  useEffect(()=>{
    let cancelled=false;
    const doFetch=async()=>{
      if (!cancelled){setLoading(true);setError(null);}
      try {
        const url=`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=90&interval=daily`;
        const res=await fetch(url);
        if (res.status===429) {
          // Rate limited — wait 20s and retry
          if (!cancelled) setTimeout(doFetch,20000);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data=await res.json();
        if (!data.prices?.length) throw new Error('No price data');
        const prices=data.prices.map(([,p])=>p);
        if (!cancelled){setPriceData(prices);setCurrentPrice(prices[prices.length-1]);}
      } catch(err) {
        if (!cancelled){
          setError("Live data unavailable");
          const seed=coinId.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
          const base=50+(seed%300);
          const mock=Array.from({length:90},(_,i)=>base+Math.sin(i*0.18+seed*0.05)*base*0.28+Math.sin(i*0.45+seed*0.12)*base*0.12+i*(base*0.004));
          setPriceData(mock);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    // Stagger: wait fetchIndex * 7000ms before first request
    const timer=setTimeout(doFetch,fetchIndex*7000);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[coinId,fetchIndex]);

  const {composite,breakdown,bb,atr,divergence}=useMemo(()=>calcCompositeScore(priceData),[priceData]);
  const momentum14d=useMemo(()=>calc14dMomentum(priceData),[priceData]);

  useEffect(()=>{
    if (priceData.length>0&&onComposite) onComposite(coinId,composite);
  },[composite,coinId,priceData.length,onComposite]);

  const formatPrice=p=>{
    if (!p&&p!==0) return "--";
    if (p>=10000) return `$${p.toLocaleString("en-US",{maximumFractionDigits:0})}`;
    if (p>=1) return `$${p.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    return `$${p.toFixed(4)}`;
  };

  const pctChange14d=priceData.length>=14?((priceData[priceData.length-1]-priceData[priceData.length-14])/priceData[priceData.length-14]*100):null;
  const scoreColor=s=>s>0.1?'#4ade80':s<-0.1?'#f87171':'#94a3b8';
  const bullCount=breakdown.filter(s=>s.score>0.15).length;
  const bearCount=breakdown.filter(s=>s.score<-0.15).length;
  const rankPalette=['#f59e0b','#94a3b8','#cd7c3f'];
  const rankColor=rank!==null&&rank<=3?rankPalette[rank-1]:'#334155';

  return (
    <div style={{background:isTop?'rgba(245,158,11,0.07)':'rgba(255,255,255,0.03)',borderRadius:'20px',border:isTop?'2px solid rgba(245,158,11,0.5)':`1px solid ${meta.color}30`,padding:'18px 14px',marginBottom:'14px',transition:'border-color 0.4s'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'14px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
          {rank!==null&&(
            <div style={{width:'28px',height:'28px',borderRadius:'50%',flexShrink:0,background:`${rankColor}22`,border:`1.5px solid ${rankColor}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:isTop?'0.9rem':'0.58rem',fontWeight:'700',color:rankColor,fontFamily:"'Courier New',monospace"}}>
              {isTop?'👑':`#${rank}`}
            </div>
          )}
          <div style={{width:'34px',height:'34px',borderRadius:'50%',background:`${meta.color}20`,border:`2px solid ${meta.color}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.95rem',color:meta.color,fontWeight:'bold'}}>{meta.emoji}</div>
          <div>
            <div style={{color:'#fff',fontWeight:'700',fontSize:'0.95rem',fontFamily:"'Courier New',monospace"}}>{meta.symbol}</div>
            <div style={{color:'#64748b',fontSize:'0.65rem',textTransform:'uppercase',letterSpacing:'0.1em'}}>{coinId}</div>
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{color:'#e2e8f0',fontWeight:'700',fontSize:'1rem',fontFamily:"'Courier New',monospace"}}>
            {loading?(waited?'…':`~${fetchIndex*7}s`):formatPrice(currentPrice)}
          </div>
          {pctChange14d!==null&&(<div style={{fontSize:'0.72rem',fontWeight:'600',color:pctChange14d>=0?'#4ade80':'#f87171'}}>{pctChange14d>=0?'▲':'▼'} {Math.abs(pctChange14d).toFixed(1)}% 14d</div>)}
          {breakdown.length>0&&(<div style={{fontSize:'0.58rem',fontFamily:"'Courier New',monospace",marginTop:'3px',color:'#475569'}}><span style={{color:'#4ade80'}}>↑{bullCount}</span>{' / '}<span style={{color:'#f87171'}}>↓{bearCount}</span>{' signals'}</div>)}
        </div>
      </div>

      {/* Sparkline */}
      {priceData.length>1?(
        <div style={{marginBottom:'10px'}}>
          <svg viewBox="0 0 200 38" width="100%" height="38" preserveAspectRatio="none">
            {(()=>{
              const min=Math.min(...priceData),max=Math.max(...priceData);
              const norm=priceData.map((p,i)=>({x:(i/(priceData.length-1))*200,y:34-((p-min)/(max-min||1))*30}));
              const d=norm.map((p,i)=>`${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');
              const clr=priceData[priceData.length-1]>priceData[0]?'#4ade80':'#f87171';
              return(<><defs><linearGradient id={`spark-${coinId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={clr} stopOpacity="0.25"/><stop offset="100%" stopColor={clr} stopOpacity="0.01"/></linearGradient></defs><path d={`${d} L 200 38 L 0 38 Z`} fill={`url(#spark-${coinId})`}/><path d={d} fill="none" stroke={clr} strokeWidth="1.5" strokeLinecap="round"/></>);
            })()}
          </svg>
          {error&&<div style={{color:'#f59e0b',fontSize:'0.62rem',textAlign:'center',marginTop:'2px'}}>⚠ {error} — demo data</div>}
        </div>
      ):(
        <div style={{height:'38px',background:'rgba(255,255,255,0.03)',borderRadius:'6px',marginBottom:'10px',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <span style={{color:'#334155',fontSize:'0.62rem',fontFamily:"'Courier New',monospace"}}>{waited?'fetching…':`queued — ~${fetchIndex*7}s`}</span>
        </div>
      )}

      {/* Divergence */}
      {divergence&&(
        <div style={{display:'inline-flex',alignItems:'center',gap:'5px',padding:'4px 8px',borderRadius:'6px',marginBottom:'10px',background:divergence.type==='bullish'?'rgba(74,222,128,0.1)':'rgba(248,113,113,0.1)',border:`1px solid ${divergence.type==='bullish'?'rgba(74,222,128,0.3)':'rgba(248,113,113,0.3)'}`}}>
          <span style={{fontSize:'0.7rem'}}>{divergence.type==='bullish'?'↗':'↘'}</span>
          <span style={{color:divergence.type==='bullish'?'#4ade80':'#f87171',fontSize:'0.62rem',fontFamily:"'Courier New',monospace",fontWeight:'700',letterSpacing:'0.05em'}}>RSI {divergence.type==='bullish'?'BULLISH':'BEARISH'} DIVERGENCE</span>
        </div>
      )}

      {/* Gauges */}
      <div style={{display:'flex',justifyContent:'space-around',gap:'6px',marginBottom:'12px'}}>
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center'}}><Gauge value={momentum14d} label="14d Momentum"/></div>
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center'}}><Gauge value={composite} label="Trend Score"/></div>
      </div>

      {/* Expand */}
      <button onClick={()=>setShowBreakdown(v=>!v)} style={{width:'100%',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:'10px',color:'#94a3b8',fontSize:'0.68rem',fontFamily:"'Courier New',monospace",letterSpacing:'0.1em',textTransform:'uppercase',padding:'8px',cursor:'pointer'}}>
        {showBreakdown?'▲ Hide':'▼ Full Analysis'} — RSI · MACD · EMA · Bollinger · ATR
      </button>

      {showBreakdown&&(
        <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'10px'}}>
          <BollingerMiniChart prices={priceData} coinId={coinId}/>
          <ATRMeter atr={atr}/>
          {bb&&(
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
              <div style={{padding:'5px 10px',borderRadius:'6px',fontSize:'0.62rem',fontFamily:"'Courier New',monospace",fontWeight:'600',background:bb.squeeze?'rgba(245,158,11,0.15)':'rgba(255,255,255,0.04)',color:bb.squeeze?'#f59e0b':'#475569',border:`1px solid ${bb.squeeze?'rgba(245,158,11,0.3)':'rgba(255,255,255,0.06)'}`}}>{bb.squeeze?'⚡ Squeeze — breakout pending':'Bands normal width'}</div>
              <div style={{padding:'5px 10px',borderRadius:'6px',fontSize:'0.62rem',fontFamily:"'Courier New',monospace",background:'rgba(255,255,255,0.04)',color:bb.percentB>0.8?'#f87171':bb.percentB<0.2?'#4ade80':'#94a3b8',border:'1px solid rgba(255,255,255,0.06)'}}>%B {(bb.percentB*100).toFixed(0)}%{bb.percentB>0.8?' — near upper band':bb.percentB<0.2?' — near lower band':' — mid-bands'}</div>
            </div>
          )}
          <div style={{display:'flex',flexDirection:'column',gap:'7px'}}>
            {breakdown.map(({name,value,score})=>{
              const hint=(()=>{
                if(name==='RSI'){const r=value.toFixed(1);return value>70?`${r} overbought`:value<30?`${r} oversold`:`${r} neutral`;}
                if(name==='MACD') return value>0?'+bullish':'−bearish';
                if(name==='EMA 9/21') return value.e9>value.e21?'9 > 21 ↑':'9 < 21 ↓';
                if(name==='vs EMA50'){const p=(((value.price-value.e50)/value.e50)*100).toFixed(1);return `${p>0?'+':''}${p}% vs 50d`;}
                if(name==='Bollinger %B'){const p=(value*100).toFixed(0);return value>0.8?`${p}% — upper zone`:value<0.2?`${p}% — lower zone`:`${p}% — middle`;}
                return '';
              })();
              return(
                <div key={name}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:'3px'}}>
                    <span style={{color:'#cbd5e1',fontSize:'0.65rem',fontFamily:"'Courier New',monospace",fontWeight:'600'}}>{name}</span>
                    <span style={{color:scoreColor(score),fontSize:'0.65rem',fontFamily:"'Courier New',monospace"}}>{hint}</span>
                  </div>
                  <div style={{height:'5px',background:'rgba(255,255,255,0.06)',borderRadius:'3px',overflow:'hidden',position:'relative'}}>
                    <div style={{position:'absolute',left:score>=0?'50%':`${((score+1)/2)*100}%`,width:`${Math.abs(score)*50}%`,height:'100%',background:scoreColor(score),borderRadius:'3px'}}/>
                    <div style={{position:'absolute',left:'50%',top:0,width:'1px',height:'100%',background:'rgba(255,255,255,0.2)'}}/>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{color:'#334155',fontSize:'0.58rem',fontFamily:"'Courier New',monospace",textAlign:'center',marginTop:'2px',lineHeight:1.5}}>
            90-day daily closes · 5 indicators · Not financial advice
          </div>
        </div>
      )}
    </div>
  );
}
