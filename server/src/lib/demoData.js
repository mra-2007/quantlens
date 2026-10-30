// Deterministic synthetic OHLCV data, used when DATA_MODE=demo (offline development,
// tests, or when you don't want to hit a market-data API). Every symbol gets its own
// seeded geometric Brownian motion, plus a shared market factor so correlations and
// betas look realistic. The UI labels this data as simulated.
import { rng, normalSampler } from "../quant/stats.js";

export const DEMO_UNIVERSE = [
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", start: 150, mu: 0.0006, sigma: 0.017, beta: 1.1 },
  { symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", start: 280, mu: 0.0007, sigma: 0.016, beta: 1.0 },
  { symbol: "GOOGL", name: "Alphabet Inc.", exchange: "NASDAQ", start: 110, mu: 0.0006, sigma: 0.019, beta: 1.1 },
  { symbol: "AMZN", name: "Amazon.com, Inc.", exchange: "NASDAQ", start: 120, mu: 0.0006, sigma: 0.021, beta: 1.2 },
  { symbol: "TSLA", name: "Tesla, Inc.", exchange: "NASDAQ", start: 200, mu: 0.0007, sigma: 0.035, beta: 1.8 },
  { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", start: 40, mu: 0.0018, sigma: 0.03, beta: 1.7 },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", exchange: "NYSE", start: 140, mu: 0.0004, sigma: 0.015, beta: 1.0 },
  { symbol: "KO", name: "The Coca-Cola Company", exchange: "NYSE", start: 58, mu: 0.0002, sigma: 0.009, beta: 0.5 },
  { symbol: "XOM", name: "Exxon Mobil Corporation", exchange: "NYSE", start: 95, mu: 0.0003, sigma: 0.017, beta: 0.7 },
  { symbol: "RELIANCE.NS", name: "Reliance Industries Ltd", exchange: "NSE", start: 2300, mu: 0.0004, sigma: 0.015, beta: 0.9 },
  { symbol: "TCS.NS", name: "Tata Consultancy Services", exchange: "NSE", start: 3300, mu: 0.0003, sigma: 0.013, beta: 0.7 },
  { symbol: "INFY.NS", name: "Infosys Ltd", exchange: "NSE", start: 1450, mu: 0.0003, sigma: 0.016, beta: 0.8 },
  { symbol: "HDFCBANK.NS", name: "HDFC Bank Ltd", exchange: "NSE", start: 1550, mu: 0.0002, sigma: 0.013, beta: 0.9 },
  { symbol: "^GSPC", name: "S&P 500", exchange: "INDEX", start: 4000, mu: 0.0004, sigma: 0.011, beta: 1.0 },
  { symbol: "^NSEI", name: "NIFTY 50", exchange: "INDEX", start: 18000, mu: 0.0004, sigma: 0.01, beta: 1.0 },
  { symbol: "USDINR=X", name: "US Dollar / Indian Rupee", exchange: "FX", start: 82, mu: 0.0001, sigma: 0.003, beta: 0 },
];

const hash = (s) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 2166136261);

function tradingDays(count, end = new Date()) {
  const days = [];
  const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (days.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return days.reverse();
}

/** Shared market factor shocks, so every demo symbol co-moves with the "market". */
function marketShocks(count) {
  const z = normalSampler(rng(12345));
  return Array.from({ length: count }, () => z() * 0.01);
}

/**
 * Market-wide volatility regimes (calm / normal / stormy) from a sticky seeded Markov chain,
 * so demo prices show the volatility clustering real markets have.
 */
function volatilityRegimes(count) {
  const u = rng(777);
  const stay = [0.985, 0.98, 0.95];
  const mult = [0.65, 1, 2.1];
  let state = 1;
  return Array.from({ length: count }, () => {
    if (u() > stay[state]) state = state === 1 ? (u() < 0.7 ? 0 : 2) : 1;
    return mult[state];
  });
}

export function syntheticCandles(symbol, count = 1260, end) {
  const meta = DEMO_UNIVERSE.find((u) => u.symbol === symbol) ?? { start: 50 + (hash(symbol) % 400), mu: 0.0004, sigma: 0.02, beta: 1 };
  const dates = tradingDays(count, end);
  const market = marketShocks(count);
  const vol = volatilityRegimes(count);
  const z = normalSampler(rng(hash(symbol)));
  const idio = Math.sqrt(Math.max(meta.sigma ** 2 - (meta.beta * 0.01) ** 2, 0.00002));
  let price = meta.start;
  return dates.map((time, i) => {
    const ret = meta.mu + vol[i] * (meta.beta * market[i] + idio * z());
    const open = price * (1 + z() * meta.sigma * 0.25);
    const close = price * Math.exp(ret);
    const high = Math.max(open, close) * (1 + Math.abs(z()) * meta.sigma * 0.4);
    const low = Math.min(open, close) * (1 - Math.abs(z()) * meta.sigma * 0.4);
    price = close;
    const r4 = (x) => Math.round(x * 10000) / 10000;
    return { time, open: r4(open), high: r4(high), low: r4(low), close: r4(close), volume: Math.round(1e6 * (1 + Math.abs(z()))) };
  });
}

export function demoSearch(q) {
  const s = q.trim().toLowerCase();
  return DEMO_UNIVERSE.filter((u) => u.symbol.toLowerCase().includes(s) || u.name.toLowerCase().includes(s)).map(({ symbol, name, exchange }) => ({ symbol, name, exchange, type: exchange === "INDEX" ? "INDEX" : "EQUITY" }));
}
