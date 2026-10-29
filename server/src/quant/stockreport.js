// Per-holding report: the same single-stock maths as the Analyze page, condensed
// into one row per stock, plus that stock's own Monte Carlo forecast and what it
// means for the user's position (quantity × simulated price).
import { sma, macd, bollinger, rsi, stochastic } from "./indicators.js";
import { simpleReturns, volatility, sharpeRatio, maxDrawdown, valueAtRisk, betaVsIndex, cagr, alignCloses } from "./risk.js";
import { monteCarlo, regressionTrend } from "./forecast.js";

const lastOf = (arr) => arr[arr.length - 1];

/**
 * @param {any[]} candles             daily candles (oldest first), ideally 2 years
 * @param {object} o
 * @param {{quantity:number, avgPrice:number}} o.holding
 * @param {any[]|null} o.indexCandles benchmark for beta
 * @param {number} o.days             forecast horizon in trading days
 */
export function holdingReport(candles, { holding, indexCandles = null, days = 126, paths = 1000, seed = 21, riskFree = 0.04 }) {
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const n = close.length;
  const price = close[n - 1];
  const prev = close[n - 2] ?? price;
  const returns = simpleReturns(close);

  // ---------- trend ----------
  const sma50 = lastOf(sma(close, 50));
  const sma200 = lastOf(sma(close, 200));
  const year = close.slice(-252);
  const reg = regressionTrend(year, 30);
  const regSlopePctYear = reg.slope && year.length ? (reg.slope * 252) / (year.reduce((s, v) => s + v, 0) / year.length) : null;

  // ---------- momentum ----------
  const rsiNow = lastOf(rsi(close, 14));
  const m = macd(close);
  const macdNow = lastOf(m.macd);
  const sigNow = lastOf(m.signal);
  const st = stochastic(high, low, close, 14, 3, 3);
  const kNow = lastOf(st.k);
  const bb = bollinger(close, 20, 2);
  const up = lastOf(bb.upper);
  const lo = lastOf(bb.lower);
  const pctB = up != null && lo != null && up !== lo ? (price - lo) / (up - lo) : null;

  // Each rule votes +1 (bullish), −1 (bearish) or 0. Purely mechanical, not advice.
  const signals = [];
  const push = (name, value, vote, state, formula) => signals.push({ name, value, vote, state, formula });
  if (sma50 != null) push("Price vs SMA 50", price / sma50 - 1, price > sma50 ? 1 : -1, price > sma50 ? "above" : "below", "P / SMA₅₀ − 1");
  if (sma200 != null) push("Price vs SMA 200", price / sma200 - 1, price > sma200 ? 1 : -1, price > sma200 ? "above" : "below", "P / SMA₂₀₀ − 1");
  if (sma50 != null && sma200 != null) push("SMA 50 vs SMA 200", sma50 / sma200 - 1, sma50 > sma200 ? 1 : -1, sma50 > sma200 ? "golden cross" : "death cross", "SMA₅₀ / SMA₂₀₀ − 1");
  if (macdNow != null && sigNow != null) push("MACD vs signal", macdNow - sigNow, macdNow > sigNow ? 1 : -1, macdNow > sigNow ? "bullish" : "bearish", "EMA₁₂ − EMA₂₆ vs EMA₉");
  if (rsiNow != null) push("RSI 14", rsiNow, rsiNow < 30 ? 1 : rsiNow > 70 ? -1 : 0, rsiNow > 70 ? "overbought" : rsiNow < 30 ? "oversold" : "neutral", "100 − 100 / (1 + RS)");
  if (kNow != null) push("Stochastic %K", kNow, kNow < 20 ? 1 : kNow > 80 ? -1 : 0, kNow > 80 ? "overbought" : kNow < 20 ? "oversold" : "neutral", "(C − L₁₄) / (H₁₄ − L₁₄)");
  if (pctB != null) push("Bollinger %B", pctB, pctB < 0 ? 1 : pctB > 1 ? -1 : 0, pctB > 1 ? "above upper band" : pctB < 0 ? "below lower band" : "inside bands", "(P − lower) / (upper − lower)");
  if (regSlopePctYear != null) push("1-year regression slope", regSlopePctYear, reg.r2 > 0.3 ? Math.sign(regSlopePctYear) : 0, regSlopePctYear > 0 ? "rising" : "falling", "OLS slope × 252 / mean price");
  const bullish = signals.filter((s) => s.vote > 0).length;
  const bearish = signals.filter((s) => s.vote < 0).length;
  const score = signals.length ? (bullish - bearish) / signals.length : 0;
  const stance = score >= 0.35 ? "Mostly bullish" : score <= -0.35 ? "Mostly bearish" : "Mixed";

  // ---------- risk ----------
  const vol = volatility(returns);
  const dd = maxDrawdown(close);
  let beta = null;
  if (indexCandles?.length) {
    const { closes } = alignCloses({ asset: candles, index: indexCandles });
    if (closes.asset.length > 30) beta = betaVsIndex(simpleReturns(closes.asset), simpleReturns(closes.index), riskFree).beta;
  }
  const yearAgo = close[Math.max(0, n - 253)];

  // ---------- forecast ----------
  const mc = monteCarlo(close, { days, paths, seed, samplePaths: 12 });
  const t = mc.terminal;
  const q = holding.quantity;

  return {
    price,
    change: price - prev,
    changePct: prev ? price / prev - 1 : 0,
    asOf: candles[n - 1].time,
    high52: Math.max(...high.slice(-252)),
    low52: Math.min(...low.slice(-252)),
    trend: { sma50, sma200, regSlopePctYear, r2: reg.r2, projection30: lastOf(reg.projection)?.value ?? null },
    momentum: { rsi: rsiNow, macd: macdNow, macdSignal: sigNow, stochK: kNow, pctB },
    signals,
    verdict: { bullish, bearish, neutral: signals.length - bullish - bearish, score, stance },
    risk: {
      annualVol: vol.annual,
      sharpe: sharpeRatio(returns, riskFree),
      maxDrawdown: dd.maxDrawdown,
      var95: valueAtRisk(returns, 0.95).historical,
      beta,
      return1y: yearAgo ? price / yearAgo - 1 : null,
      cagr: cagr(close[0], price, n - 1),
    },
    forecast: {
      days,
      paths,
      drift: mc.drift,
      sigma: mc.sigma,
      start: price,
      median: t.p50,
      p5: t.p5,
      p95: t.p95,
      mean: t.mean,
      expectedReturn: t.p50 / price - 1,
      probUp: t.probAbove,
      probLoss10: t.probLoss10,
      bands: mc.bands,
      samplePaths: mc.samplePaths,
      history: candles.slice(-60).map((c) => ({ close: c.close })),
      position: { now: q * price, median: q * t.p50, p5: q * t.p5, p95: q * t.p95 },
    },
  };
}
