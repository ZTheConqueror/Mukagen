function Gauge({ value = 0, label = "Momentum" }) {
  const clamped = Math.max(-1, Math.min(1, isNaN(Number(value)) ? 0 : Number(value)));

  // SVG rotate() is clockwise-positive.
  // +1 → needle RIGHT → green ✓   -1 → needle LEFT → red ✓
  const needleRotation = clamped * 135;

  const cx = 120, cy = 118;
  const outerR = 95, innerR = 55;

  const degToRad = (d) => (d * Math.PI) / 180;
  const pt = (r, mathDeg) => ({
    x: cx + r * Math.cos(degToRad(mathDeg)),
    y: cy - r * Math.sin(degToRad(mathDeg)),
  });

  // 225° = upper-left (RED end), 90° = top (ZERO), -45°/315° = upper-right (GREEN end)
  const lo = pt(outerR, 225), li = pt(innerR, 225);
  const ro = pt(outerR, -45), ri = pt(innerR, -45);
  const to = pt(outerR,  90), ti = pt(innerR,  90);

  const pct = Math.round(clamped * 100);
  const pctLabel = pct > 0 ? `+${pct}%` : `${pct}%`;
  const valueColor = clamped > 0.08 ? '#4ade80' : clamped < -0.08 ? '#f87171' : '#94a3b8';

  // Unique prefix per gauge so gradient IDs don't clash when multiple render
  const uid = (label || 'g').replace(/[^a-z0-9]/gi, '');

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:'100%' }}>
      <svg viewBox="0 0 240 185" style={{ width:'100%', maxWidth:'220px', height:'auto', display:'block' }}>
        <defs>
          <filter id={`gl-${uid}`}>
            <feGaussianBlur stdDeviation="2.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id={`red-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#dc2626"/>
            <stop offset="100%" stopColor="#f97316"/>
          </linearGradient>
          <linearGradient id={`grn-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#16a34a"/>
            <stop offset="100%" stopColor="#4ade80"/>
          </linearGradient>
        </defs>

        {/* Background track — full arc left→right over the top */}
        <path
          d={`M ${lo.x} ${lo.y} A ${outerR} ${outerR} 0 1 1 ${ro.x} ${ro.y}
              L ${ri.x} ${ri.y} A ${innerR} ${innerR} 0 1 0 ${li.x} ${li.y} Z`}
          fill="#12152a" stroke="#1e2340" strokeWidth="1"
        />

        {/* RED segment: upper-left → top (left half), sweep clockwise */}
        <path
          d={`M ${lo.x} ${lo.y} A ${outerR} ${outerR} 0 0 1 ${to.x} ${to.y}
              L ${ti.x} ${ti.y} A ${innerR} ${innerR} 0 0 0 ${li.x} ${li.y} Z`}
          fill={`url(#red-${uid})`} opacity="0.9"
        />

        {/* GREEN segment: top → upper-right (right half), sweep clockwise */}
        <path
          d={`M ${to.x} ${to.y} A ${outerR} ${outerR} 0 0 1 ${ro.x} ${ro.y}
              L ${ri.x} ${ri.y} A ${innerR} ${innerR} 0 0 0 ${ti.x} ${ti.y} Z`}
          fill={`url(#grn-${uid})`} opacity="0.9"
        />

        {/* Tick marks */}
        {[-135,-90,-45,0,45,90,135].map((offset, i) => {
          const o2 = pt(outerR - 1,  90 + offset);
          const t2 = pt(outerR - 13, 90 + offset);
          return <line key={i} x1={o2.x} y1={o2.y} x2={t2.x} y2={t2.y}
            stroke={i===3 ? '#ffffff55' : '#ffffff22'} strokeWidth={i===3 ? 2.5 : 1.5}/>;
        })}

        {/* Zero center divider */}
        <line x1={ti.x} y1={ti.y} x2={to.x} y2={to.y}
          stroke="#ffffff55" strokeWidth="2" strokeLinecap="round"/>

        {/* Needle: tip points UP in local frame; positive rotation = clockwise = RIGHT = GREEN */}
        <g transform={`rotate(${needleRotation} ${cx} ${cy})`} filter={`url(#gl-${uid})`}>
          <polygon
            points={`${cx},${cy-outerR+10} ${cx-5},${cy+8} ${cx+5},${cy+8}`}
            fill="#e2e8f0" stroke="#475569" strokeWidth="1"
          />
        </g>

        {/* Pivot */}
        <circle cx={cx} cy={cy} r="11" fill="#0b0e1a" stroke="#334155" strokeWidth="2"/>
        <circle cx={cx} cy={cy} r="5"  fill="#38bdf8"/>

        {/* Value — below pivot */}
        <text x={cx} y={cy+46} textAnchor="middle" fontSize="22" fontWeight="700"
          fill={valueColor} fontFamily="'Courier New', monospace">{pctLabel}</text>

        {/* Label — below value, inside viewBox, never overlaps */}
        <text x={cx} y={cy+67} textAnchor="middle" fontSize="9.5" fontWeight="600"
          fill="#64748b" fontFamily="'Courier New', monospace" letterSpacing="1.8">
          {label ? label.toUpperCase() : ''}
        </text>
      </svg>
    </div>
  );
}

export default Gauge;
