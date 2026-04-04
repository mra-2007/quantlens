export async function getStockPrice(symbol) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${import.meta.env.VITE_FINNHUB_API_KEY}`
    );

    const data = await res.json();

    return {
      current: data.c,
      high: data.h,
      low: data.l,
      open: data.o,
    };
  } catch (err) {
    console.error("Stock API Error:", err);
    return null;
  }
}
export function getSymbol(name) {
  const map = {
    apple: "AAPL",
    tesla: "TSLA",
    google: "GOOGL",
    amazon: "AMZN",
    microsoft: "MSFT",
    infosys: "INFY",
    tcs: "TCS.NS",
    reliance: "RELIANCE.NS",
  };

  return map[name.toLowerCase()] || null;
}