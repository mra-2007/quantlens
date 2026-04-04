export async function getStockPrice(symbol) {
  if (!symbol) return null;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${import.meta.env.VITE_FINNHUB_API_KEY}`
    );

    if (!res.ok) {
      console.error("Stock API status:", res.status);
      return null;
    }

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

// 🔑 SYMBOL MAP
export function getSymbol(name) {
  if (!name) return null;

  const map = {
    tesla: "TSLA",
    apple: "AAPL",
    amazon: "AMZN",
    google: "GOOGL",
    microsoft: "MSFT",
    reliance: "RELIANCE.NS",
    tcs: "TCS.NS",
    infosys: "INFY",
  };

  return map[name.toLowerCase()] || null;
}