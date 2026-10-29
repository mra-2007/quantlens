// Market data access. All price history goes through the cache so repeated
// analyses, backtests and simulations never hit the provider's rate limits.
import YahooFinance from "yahoo-finance2";
import { config } from "../config.js";
import { cache } from "./cache.js";
import { syntheticCandles, demoSearch } from "./demoData.js";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"], queue: { concurrency: 2 } });

export const RANGES = { "6mo": 126, "1y": 252, "2y": 504, "5y": 1260 };

export class MarketError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function normaliseSymbol(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!/^[\^A-Z0-9.\-=]{1,20}$/.test(s)) throw new MarketError("Invalid symbol", 400);
  return s;
}

function rangeStart(range) {
  const d = new Date();
  const years = { "6mo": 0.5, "1y": 1, "2y": 2, "5y": 5 }[range] ?? 1;
  d.setUTCDate(d.getUTCDate() - Math.round(years * 365.25) - 10);
  return d;
}

async function fetchYahoo(symbol, range) {
  let res;
  try {
    res = await yf.chart(symbol, { period1: rangeStart(range), interval: "1d", return: "array" });
  } catch (e) {
    throw new MarketError(`No price data for ${symbol} (${e.message.split("\n")[0]})`, 404);
  }
  const candles = (res?.quotes ?? [])
    .filter((q) => q.open != null && q.close != null && q.high != null && q.low != null)
    .map((q) => ({
      time: new Date(q.date).toISOString().slice(0, 10),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.adjclose ?? q.close,
      volume: q.volume ?? 0,
    }));
  return { candles, currency: res?.meta?.currency ?? "USD", name: res?.meta?.longName ?? res?.meta?.shortName ?? symbol, exchange: res?.meta?.exchangeName };
}

async function fetchAlphaVantage(symbol, range) {
  if (!config.alphaVantageKey) throw new MarketError("ALPHAVANTAGE_KEY is not set", 500);
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&outputsize=full&symbol=${encodeURIComponent(symbol)}&apikey=${config.alphaVantageKey}`;
  const json = await (await fetch(url)).json();
  const series = json["Time Series (Daily)"];
  if (!series) throw new MarketError(json.Note || json.Information || json["Error Message"] || `No data for ${symbol}`, 502);
  const cutoff = rangeStart(range).toISOString().slice(0, 10);
  const candles = Object.entries(series)
    .filter(([t]) => t >= cutoff)
    .map(([time, v]) => ({ time, open: +v["1. open"], high: +v["2. high"], low: +v["3. low"], close: +v["4. close"], volume: +v["5. volume"] }))
    .sort((a, b) => (a.time < b.time ? -1 : 1));
  return { candles, currency: "USD", name: symbol };
}

function fetchDemo(symbol, range) {
  const meta = demoSearch(symbol).find((m) => m.symbol === symbol);
  // One 5-year series per symbol, sliced, so every range agrees on today's price.
  return { candles: syntheticCandles(symbol, RANGES["5y"]).slice(-(RANGES[range] ?? 252)), currency: symbol.endsWith(".NS") || symbol === "^NSEI" ? "INR" : "USD", name: meta?.name ?? symbol, simulated: true };
}

/** Daily OHLCV history for a symbol, cached per provider/symbol/range. */
export async function getHistory(rawSymbol, range = "1y") {
  const symbol = normaliseSymbol(rawSymbol);
  if (!RANGES[range]) throw new MarketError(`range must be one of ${Object.keys(RANGES).join(", ")}`, 400);
  const provider = config.dataProvider;
  const key = `px:${provider}:${symbol}:${range}`;
  const { value, cached } = await cache.wrap(key, config.cacheTtl.history, async () => {
    const data = provider === "demo" ? fetchDemo(symbol, range) : provider === "alphavantage" ? await fetchAlphaVantage(symbol, range) : await fetchYahoo(symbol, range);
    if (data.candles.length < 30) throw new MarketError(`Not enough price history for ${symbol}`, 404);
    return { symbol, provider, ...data };
  });
  return { ...value, cached };
}

export async function search(q) {
  const query = String(q ?? "").trim();
  if (query.length < 1) return [];
  if (config.dataProvider === "demo") return demoSearch(query);
  const { value } = await cache.wrap(`search:${query.toLowerCase()}`, config.cacheTtl.search, async () => {
    try {
      const res = await yf.search(query, { quotesCount: 8, newsCount: 0 });
      return (res.quotes ?? [])
        .filter((q) => q.symbol && ["EQUITY", "ETF", "INDEX"].includes(q.quoteType))
        .map((q) => ({ symbol: q.symbol, name: q.longname ?? q.shortname ?? q.symbol, exchange: q.exchDisp ?? q.exchange, type: q.quoteType }));
    } catch {
      return [];
    }
  });
  return value;
}

/** Latest price, used by the alert checker. Short TTL. */
export async function getLatestPrice(symbol) {
  if (config.dataProvider !== "yahoo") {
    const h = await getHistory(symbol, "6mo");
    return h.candles.at(-1).close;
  }
  const { value } = await cache.wrap(`quote:${symbol}`, config.cacheTtl.quote, async () => {
    const q = await yf.quote(symbol);
    return q?.regularMarketPrice ?? null;
  });
  return value;
}
