// Heavy computations that run off the request path, in the job worker.
import { getHistory } from "../lib/market.js";
import { monteCarlo } from "../quant/forecast.js";
import { runBacktest } from "../quant/backtest.js";
import { efficientFrontier, correlationMatrix } from "../quant/portfolio.js";
import { simpleReturns, alignCloses } from "../quant/risk.js";
import { config } from "../config.js";
import { analyzeMyPortfolio } from "../quant/myportfolio.js";
import { holdingReport } from "../quant/stockreport.js";
import { analyseRegimes } from "../quant/regime.js";
import { evolveStrategies } from "../quant/evolve.js";
import { findTwins } from "../quant/twins.js";
import { analyseAnomalies } from "../quant/anomaly.js";
import { analyseNeural } from "../quant/neural.js";
import { analyseXRay } from "../quant/xray.js";

export const handlers = {
  async montecarlo({ symbol, range = "2y", days = 126, paths = 1000, seed }) {
    const h = await getHistory(symbol, range);
    const closes = h.candles.map((c) => c.close);
    const res = monteCarlo(closes, { days, paths, seed: seed ?? 42 });
    return { symbol: h.symbol, currency: h.currency, simulated: !!h.simulated, lastDate: h.candles.at(-1).time, ...res };
  },

  async backtest({ symbol, range = "5y", strategy, initialCapital = 10000 }) {
    const h = await getHistory(symbol, range);
    const res = runBacktest(h.candles, strategy, { initialCapital, riskFree: config.riskFreeRate });
    return { symbol: h.symbol, currency: h.currency, simulated: !!h.simulated, strategy, ...res };
  },

  async frontier({ symbols, range = "2y", samples = 4000 }) {
    const histories = await Promise.all(symbols.map((s) => getHistory(s, range)));
    const { dates, closes } = alignCloses(Object.fromEntries(histories.map((h) => [h.symbol, h.candles])));
    const returns = Object.fromEntries(Object.entries(closes).map(([s, c]) => [s, simpleReturns(c)]));
    const ef = efficientFrontier(returns, { samples, riskFree: config.riskFreeRate });
    return { ...ef, correlation: correlationMatrix(returns), observations: dates.length, simulated: histories.some((h) => h.simulated) };
  },
};

/** Analysis of the user's own holdings, plus the optional "what if I add money" simulation. */
handlers.myportfolio = async ({ holdings, add = null, range = "1y", days = 126 }) => {
  const symbols = [...new Set([...holdings.map((h) => h.symbol), ...(add ? [add.symbol] : [])])];
  const fetched = await Promise.all(symbols.map((s) => getHistory(s, range)));
  const histories = Object.fromEntries(fetched.map((h) => [h.symbol, h]));
  const currencies = [...new Set(fetched.map((h) => h.currency))];
  const base = currencies.length === 1 ? currencies[0] : "INR";
  const fx = currencies.length > 1 ? await getHistory("USDINR=X", range) : null;
  const index = await getHistory(base === "INR" ? "^NSEI" : config.defaultIndex, range).catch(() => null);
  const result = analyzeMyPortfolio({
    holdings,
    histories,
    base,
    fxCandles: fx?.candles ?? null,
    indexCandles: index?.candles ?? null,
    add,
    days,
    riskFree: config.riskFreeRate,
  });
  return { ...result, index: index?.symbol ?? null, simulated: fetched.some((h) => h.simulated) };
};

/** Hidden Markov Model regimes for one stock (trained on up to 5 years), plus the regime-aware forecast. */
handlers.regime = async ({ symbol, days = 126, paths = 1000, seed }) => {
  const h = await getHistory(symbol, "5y");
  const res = analyseRegimes(h.candles, { days, paths, seed: seed ?? 42 });
  return { symbol: h.symbol, currency: h.currency, simulated: !!h.simulated, lastDate: h.candles.at(-1).time, ...res };
};

/** Genetic algorithm that breeds trading strategies on the early years and tests the champion on later, unseen years. */
handlers.evolve = async ({ symbol, population = 40, generations = 25, seed }) => {
  const h = await getHistory(symbol, "5y");
  const res = evolveStrategies(h.candles, { population, generations, seed: seed ?? 7 });
  return { symbol: h.symbol, currency: h.currency, simulated: !!h.simulated, ...res };
};

/** Isolation Forest: flags the unusual trading days of one stock and explains why. */
handlers.anomaly = async ({ symbol }) => {
  const h = await getHistory(symbol, "5y");
  return { symbol: h.symbol, currency: h.currency, simulated: !!h.simulated, ...analyseAnomalies(h.candles) };
};

const PEERS_IN = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "ITC.NS", "LT.NS", "BHARTIARTL.NS", "KOTAKBANK.NS", "AXISBANK.NS", "HINDUNILVR.NS"];
const PEERS_US = ["AAPL", "MSFT", "GOOGL", "AMZN", "JPM", "KO", "XOM", "NVDA", "TSLA"];

/** Finds the past chart shapes (this stock and peers) most similar to today's, and what happened next. */
handlers.twins = async ({ symbol, length = 40, horizon = 21 }) => {
  const peers = (/\.(NS|BO)$/i.test(symbol) ? PEERS_IN : PEERS_US).filter((s) => s !== symbol);
  const [target, ...rest] = await Promise.allSettled([getHistory(symbol, "5y"), ...peers.map((s) => getHistory(s, "5y"))]);
  if (target.status !== "fulfilled") throw target.reason;
  const histories = [target.value, ...rest.filter((r) => r.status === "fulfilled").map((r) => r.value)];
  const res = findTwins(histories.map((h) => ({ symbol: h.symbol, candles: h.candles })), { target: target.value.symbol, length, horizon });
  return { symbol: target.value.symbol, currency: target.value.currency, simulated: histories.some((h) => h.simulated), ...res };
};

/** One analysis + forecast per holding, each on its own two-year history. */
handlers.holdingsreport = async ({ holdings, days = 126 }) => {
  const isIndian = (s) => /\.(NS|BO)$/i.test(s);
  const needIndex = { in: holdings.some((h) => isIndian(h.symbol)), other: holdings.some((h) => !isIndian(h.symbol)) };
  const [nsei, other] = await Promise.all([
    needIndex.in ? getHistory("^NSEI", "2y").catch(() => null) : null,
    needIndex.other ? getHistory(config.defaultIndex, "2y").catch(() => null) : null,
  ]);
  let simulated = false;
  const stocks = await Promise.all(holdings.map(async (h, i) => {
    try {
      const hist = await getHistory(h.symbol, "2y");
      simulated ||= !!hist.simulated;
      const index = isIndian(h.symbol) ? nsei : other;
      const rep = holdingReport(hist.candles, { holding: h, indexCandles: index?.candles ?? null, days, seed: 21 + i, riskFree: config.riskFreeRate });
      const cost = h.quantity * h.avgPrice;
      const value = h.quantity * rep.price;
      return {
        symbol: hist.symbol,
        name: hist.name ?? hist.symbol,
        currency: hist.currency,
        quantity: h.quantity,
        avgPrice: h.avgPrice,
        value,
        pnl: value - cost,
        pnlPct: cost > 0 ? value / cost - 1 : null,
        index: index?.symbol ?? null,
        ...rep,
      };
    } catch (e) {
      return { symbol: h.symbol, error: e.message ?? "Could not analyse this stock" };
    }
  }));
  return { days, stocks, simulated };
};

/** Neural network trained walk-forward on one stock, with an honest report card on unseen days. */
handlers.neural = async ({ symbol }) => {
  const h = await getHistory(symbol, "5y");
  return { symbol: h.symbol, currency: h.currency, simulated: !!h.simulated, ...analyseNeural(h.candles) };
};

/** Unsupervised X-ray of the user's holdings: effective bets, clusters, where the risk really sits. */
handlers.xray = async ({ holdings }) => {
  const fetched = await Promise.all(holdings.map((x) => getHistory(x.symbol, "2y")));
  const currencies = [...new Set(fetched.map((h) => h.currency))];
  const fx = currencies.length > 1 ? await getHistory("USDINR=X", "2y").catch(() => null) : null;
  const rate = fx?.candles.at(-1)?.close ?? 83;
  const { closes } = alignCloses(Object.fromEntries(fetched.map((h) => [h.symbol, h.candles])));
  const stocks = holdings.map((x, i) => {
    const h = fetched[i];
    const value = x.quantity * h.candles.at(-1).close * (currencies.length > 1 && h.currency === "USD" ? rate : 1);
    return { symbol: h.symbol, weight: value, returns: simpleReturns(closes[h.symbol]) };
  });
  return { simulated: fetched.some((h) => h.simulated), ...analyseXRay(stocks) };
};

export const JOB_TYPES = Object.keys(handlers);
