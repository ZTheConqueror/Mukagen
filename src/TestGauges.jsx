// TestGauges.jsx
import { useState, useEffect, useMemo } from "react";
import { generateTrend } from "./testDataGenerators.js";
import Gauge from "./Gauge.jsx";
// import { yourMomentumFunction } from "./momentum";  // fix when ready

export default function TestGauges() {
  const data = useMemo(() => generateTrend({ type: "up", length: 90 }), []);
  const [dayIndex, setDayIndex] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setDayIndex(i => Math.min(i + 1, data.length));
    }, 150);
    return () => clearInterval(id);

  }, [data]);

  const visible = data.slice(0, dayIndex);
  const value = visible.length > 0 ? visible[visible.length-1] / 100 - 1 : 0; // dummy

  return (
    <div>
      <h2>Test Gauge</h2>
      <Gauge value={value} label="Test Momentum" />
      <p>Day: {dayIndex} / {data.length}</p>
    </div>
  );
}