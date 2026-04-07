// testDataGenerators.js
export function generateTrend({
  type = "flat",
  length = 90,
  start = 100,
  volatility = 1,
  drift = 0.2
}) {
  const data = [];
  let value = start;

  for (let i = 0; i < length; i++) {
    let change = 0;

    switch (type) {
      case "up":
        change = drift + Math.random() * volatility;
        break;

      case "down":
        change = -drift - Math.random() * volatility;
        break;

      case "volatile":
        change = (Math.random() - 0.5) * volatility * 5;
        break;

      case "crash":
        change = i === Math.floor(length * 0.7)
          ? -volatility * 20
          : (Math.random() - 0.5) * volatility;
        break;

      case "spike":
        change = i === Math.floor(length * 0.7)
          ? volatility * 20
          : (Math.random() - 0.5) * volatility;
        break;

      default:
        change = (Math.random() - 0.5) * volatility;
    }

    value += change;
    data.push(value);
  }

  return data;
}