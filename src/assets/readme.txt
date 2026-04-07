make files for the gage and the app
extra :
import { useState, useEffect, useMemo } from "react";
import { generateTrend } from "./testDataGenerators.js/index.js";
import Gauge from "./Gauge.js";
import { yourMomentumFunction } from "./momentum";

function GaugeContainer() {
  const [mode, setMode] = useState("test");
  const [dayIndex, setDayIndex] = useState(1);

  // ✅ Generate data ONCE
  const data = useMemo(() => {
    if (mode === "test") {
      return generateTrend({ type: "up", length: 90 });
    }
    return liveDataFromSystem;
  }, [mode]);

  // ✅ Replay simulation
  useEffect(() => {
    if (mode !== "test") return;

    setDayIndex(1);

    const interval = setInterval(() => {
      setDayIndex(i => Math.min(i + 1, data.length));
    }, 150);

    return () => clearInterval(interval);
  }, [mode, data]);

  const visibleData = data.slice(0, dayIndex);
  const momentumValue = yourMomentumFunction(visibleData);

  return (
    <>
      <button onClick={() => setMode("test")}>Test</button>
      <button onClick={() => setMode("live")}>Live</button>

      <Gauge value={momentumValue} />
    </>
  );
}