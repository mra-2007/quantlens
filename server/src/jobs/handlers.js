// Heavy computations that run off the request path, in the job worker.
import { getHistory } from "../lib/market.js";
import { monteCarlo } from "../quant/forecast.js";
import { runBacktest } from "../quant/backtest.js";
import { efficientFrontier, correlationMatrix } from "../quant/portfolio.js";
import { simpleReturns, alignCloses } from "../quant/risk.js";
import { config } from "../config.js";

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

export const JOB_TYPES = Object.keys(handlers);
