import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import Gauge from './Gauge.jsx';
import CryptoGauges from './CryptoGauges.jsx';
import StockWatchlist from './StockWatchlist.jsx';
import PolyWeather from './PolyWeather.jsx';

const SCREEN_LABELS = ["習慣", "計器", "暗号", "株式", "天気"];
const SCREEN_TITLES = ["Habits", "Performance", "Crypto", "Stocks", "Weather"];
const TOTAL = 5;

function App() {
  const [currentScreen, setCurrentScreen] = useState(0);
  const [habits, setHabits] = useState([]);
  const [newHabit, setNewHabit] = useState('');

  const startXRef    = useRef(null);
  const startYRef    = useRef(null);
  const isDraggingRef = useRef(false);

  const goTo = useCallback((idx) => {
    setCurrentScreen(Math.max(0, Math.min(TOTAL - 1, idx)));
  }, []);

  const handlePointerDown = useCallback((e) => {
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    isDraggingRef.current = false;
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (startXRef.current === null) return;
    const dx = Math.abs(e.clientX - startXRef.current);
    const dy = Math.abs(e.clientY - startYRef.current);
    if (dx > 10 && dx > dy) isDraggingRef.current = true;
  }, []);

  const handlePointerUp = useCallback((e) => {
    if (startXRef.current === null) return;
    const diff = startXRef.current - e.clientX;
    const dy   = Math.abs(e.clientY - (startYRef.current || 0));
    if (isDraggingRef.current && Math.abs(diff) > 50 && dy < 80) {
      goTo(currentScreen + (diff > 0 ? 1 : -1));
    }
    startXRef.current  = null;
    startYRef.current  = null;
    isDraggingRef.current = false;
  }, [currentScreen, goTo]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') goTo(currentScreen + 1);
      if (e.key === 'ArrowLeft')  goTo(currentScreen - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentScreen, goTo]);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('mukagen-habits') || '[]');
    setHabits(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem('mukagen-habits', JSON.stringify(habits));
  }, [habits]);

  const addHabit = () => {
    if (!newHabit.trim()) return;
    setHabits(prev => [...prev, {
      id: Date.now(), name: newHabit.trim(),
      done: false, streak: 0, history: [], lastDone: null,
    }]);
    setNewHabit('');
  };

  const deleteHabit = (id) => setHabits(prev => prev.filter(h => h.id !== id));

  const toggleHabit = (id) => {
    const today = new Date().toISOString().split('T')[0];
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      if (!h.done) {
        const yest = new Date(); yest.setDate(yest.getDate() - 1);
        const yestStr  = yest.toISOString().split('T')[0];
        const newStreak = h.lastDone === yestStr ? h.streak + 1 : 1;
        const newHistory = [
          ...(h.history || []).filter(e => e.date !== today),
          { date: today, completed: true },
        ].slice(-30);
        return { ...h, done: true, streak: newStreak, lastDone: today, history: newHistory };
      } else {
        const newHistory = (h.history || []).filter(e => e.date !== today);
        return { ...h, done: false, streak: Math.max(0, h.streak - 1), lastDone: null, history: newHistory };
      }
    }));
  };

  const completionRate  = habits.length > 0 ? habits.filter(h => h.done).length / habits.length : 0;
  const completionGauge = completionRate * 2 - 1;
  const avgStreak       = habits.length > 0 ? habits.reduce((s, h) => s + h.streak, 0) / habits.length : 0;
  const streakGauge     = Math.min(1, avgStreak / 14) * 2 - 1;

  const getMomentum7d = (h) => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i);
      return d.toISOString().split('T')[0];
    });
    const completed = days.filter(d => (h.history || []).some(e => e.date === d && e.completed)).length;
    return (completed / 7) * 2 - 1;
  };

  const overallMomentum = habits.length > 0
    ? habits.reduce((s, h) => s + getMomentum7d(h), 0) / habits.length : 0;

  const getStreakColor = (streak) =>
    streak >= 7 ? '#4ade80' : streak >= 3 ? '#fbbf24' : streak >= 1 ? '#fb923c' : '#475569';

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <span className="header-title">無下限</span>
          <span className="header-sub">Mukagen</span>
        </div>
        <div className="screen-tabs">
          {SCREEN_LABELS.map((lbl, i) => (
            <button
              key={i}
              className={`tab-btn ${currentScreen === i ? 'active' : ''}`}
              onClick={() => goTo(i)}
            >{lbl}</button>
          ))}
        </div>
      </header>

      <div
        className="swipe-wrapper"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { startXRef.current = null; }}
      >
        {/* 5 screens: track = 500% wide, each screen = 20% */}
        <div
          className="screens-track"
          style={{ width: '500%', transform: `translateX(-${currentScreen * 20}%)` }}
        >
          {/* ── SCREEN 1: Habits ── */}
          <section className="screen" style={{ flex: '0 0 20%', maxWidth: '20%' }}>
            <h2 className="screen-heading">{SCREEN_TITLES[0]}</h2>
            <div className="add-row">
              <input
                type="text" placeholder="New habit…" value={newHabit}
                onChange={e => setNewHabit(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addHabit()}
              />
              <button onClick={addHabit} className="add-btn">+</button>
            </div>
            {habits.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🌱</div>
                <p>No habits yet.<br />Add one to get started.</p>
              </div>
            ) : (
              <div className="habits-list">
                {habits.map(habit => {
                  const color = getStreakColor(habit.streak);
                  const weekDone = (habit.history || []).filter(e =>
                    (new Date() - new Date(e.date)) / 86400000 <= 7
                  ).length;
                  return (
                    <div key={habit.id} className={`habit-card ${habit.done ? 'done' : ''}`}
                      style={{ borderLeftColor: color }}>
                      <div className="habit-top">
                        <div className="habit-name">{habit.name}</div>
                        <div className="habit-actions">
                          <button className={`check-btn ${habit.done ? 'checked' : ''}`}
                            onClick={() => toggleHabit(habit.id)} style={{ '--c': color }}>
                            {habit.done ? '✓' : '○'}
                          </button>
                          <button className="del-btn" onClick={() => deleteHabit(habit.id)}>×</button>
                        </div>
                      </div>
                      <div className="habit-streak" style={{ color }}>
                        {'🔥'.repeat(Math.min(habit.streak, 5))}{' '}
                        {habit.streak} day{habit.streak !== 1 ? 's' : ''}
                      </div>
                      <div className="week-dots">
                        {Array.from({ length: 7 }, (_, i) => {
                          const d = new Date(); d.setDate(d.getDate() - (6 - i));
                          const ds  = d.toISOString().split('T')[0];
                          const did = (habit.history || []).some(e => e.date === ds && e.completed);
                          return <div key={i} className={`week-dot ${did ? 'filled' : ''}`}
                            style={{ '--c': color }} title={ds} />;
                        })}
                      </div>
                      <div className="habit-progress-bar">
                        <div className="habit-progress-fill"
                          style={{ width: `${(weekDone/7)*100}%`, background: color }} />
                      </div>
                      <div className="habit-meta">{weekDone}/7 this week</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── SCREEN 2: Habit Gauges ── */}
          <section className="screen" style={{ flex: '0 0 20%', maxWidth: '20%' }}>
            <h2 className="screen-heading">{SCREEN_TITLES[1]}</h2>
            <p className="screen-sub">Derived from your habits</p>
            {habits.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <p>Add habits on the first screen<br />to see your performance gauges.</p>
              </div>
            ) : (
              <div className="gauges-grid">
                <div className="gauge-cell">
                  <Gauge value={completionGauge} label="Completion" />
                  <div className="gauge-caption">{habits.filter(h=>h.done).length}/{habits.length} done today</div>
                </div>
                <div className="gauge-cell">
                  <Gauge value={streakGauge} label="Streak Power" />
                  <div className="gauge-caption">avg {avgStreak.toFixed(1)}d streak</div>
                </div>
                <div className="gauge-cell" style={{ gridColumn:'1 / -1' }}>
                  <Gauge value={overallMomentum} label="7d Momentum" />
                  <div className="gauge-caption">overall habit momentum this week</div>
                </div>
              </div>
            )}
          </section>

          {/* ── SCREEN 3: Crypto ── */}
          <section className="screen" style={{ flex: '0 0 20%', maxWidth: '20%' }}>
            <h2 className="screen-heading">{SCREEN_TITLES[2]}</h2>
            <p className="screen-sub">Live 90-day indicators · Tap ▼ for full analysis</p>
            <div style={{ paddingBottom:'20px' }}>
              <CryptoGauges coinId="bitcoin" />
              <CryptoGauges coinId="ethereum" />
              <CryptoGauges coinId="solana" />
              <CryptoGauges coinId="sui" />
              <CryptoGauges coinId="ripple" />
              <CryptoGauges coinId="binancecoin" />
              <CryptoGauges coinId="fartcoin" />
            </div>
          </section>

          {/* ── SCREEN 4: Stocks ── */}
          <section className="screen" style={{ flex: '0 0 20%', maxWidth: '20%' }}>
            <h2 className="screen-heading">{SCREEN_TITLES[3]}</h2>
            <p className="screen-sub">Tap any row to expand indicators</p>
            <StockWatchlist />
          </section>

          {/* ── SCREEN 5: Weather / Polymarket ── */}
          <section className="screen" style={{ flex: '0 0 20%', maxWidth: '20%' }}>
            <h2 className="screen-heading">{SCREEN_TITLES[4]}</h2>
            <p className="screen-sub">Polymarket odds vs NOAA forecast</p>
            <PolyWeather />
          </section>
        </div>
      </div>

      <nav className="nav-dots">
        {Array.from({ length: TOTAL }, (_, i) => (
          <button
            key={i}
            className={`dot ${currentScreen === i ? 'active' : ''}`}
            onClick={() => goTo(i)}
            aria-label={SCREEN_TITLES[i]}
          />
        ))}
      </nav>
    </div>
  );
}

export default App;
