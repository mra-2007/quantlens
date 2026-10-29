import { mean, std, covariance, percentileSorted, TRADING_DAYS } from "./stats.js";

/** Simple daily returns r_t = P_t / P_{t-1} − 1. */
export function simpleReturns(closes) {
  const out = new Array(Math.max(closes.length - 1, 0));
  for (let i = 1; i < closes.length; i++) out[i - 1] = closes[i] / closes[i - 1] - 1;
  return out;
}

/** Log returns ln(P_t / P_{t-1}). */
export function logReturns(closes) {
  const out = new Array(Math.max(closes.length - 1, 0));
  for (let i = 1; i < closes.length; i++) out[i - 1] = Math.log(closes[i] / closes[i - 1]);
  return out;
}

/** Daily and annualised volatility (σ of daily returns, × √252). */
export function volatility(returns) {
  const daily = std(returns);
  return { daily, annual: daily * Math.sqrt(TRADING_DAYS) };
}

/** Annualised Sharpe ratio: (μ·252 − r_f) / (σ·√252). */
export function sharpeRatio(returns, riskFreeAnnual = 0.04) {
  const sd = std(returns);
  if (sd === 0) return 0;
  return (mean(returns) * TRADING_DAYS - riskFreeAnnual) / (sd * Math.sqrt(TRADING_DAYS));
}

/** Sortino ratio: like Sharpe but only penalises downside deviation. */
export function sortinoRatio(returns, riskFreeAnnual = 0.04) {
  const downside = returns.filter((r) => r < 0);
  if (downside.length < 2) return null;
  const dd = Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length);
  return dd === 0 ? null : (mean(returns) * TRADING_DAYS - riskFreeAnnual) / (dd * Math.sqrt(TRADING_DAYS));
}

/** Maximum drawdown with the peak/trough indexes and the full underwater series. */
export function maxDrawdown(values) {
  let peak = values[0];
  let peakIdx = 0;
  let maxDd = 0;
  let from = 0;
  let to = 0;
  const series = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
      peakIdx = i;
    }
    const dd = values[i] / peak - 1;
    series[i] = dd;
    if (dd < maxDd) {
      maxDd = dd;
      from = peakIdx;
      to = i;
    }
  }
  return { maxDrawdown: maxDd, peakIndex: from, troughIndex: to, series };
}

const Z = { 0.9: 1.2816, 0.95: 1.6449, 0.975: 1.96, 0.99: 2.3263 };

/** One-day Value at Risk and Expected Shortfall, reported as positive loss fractions.
 *  historical = empirical quantile; parametric = μ − z·σ under normality. */
export function valueAtRisk(returns, confidence = 0.95) {
  const sorted = [...returns].sort((a, b) => a - b);
  const q = percentileSorted(sorted, 1 - confidence);
  const tail = sorted.filter((r) => r <= q);
  const z = Z[confidence] ?? 1.6449;
  return {
    confidence,
    historical: -q,
    parametric: -(mean(returns) - z * std(returns)),
    expectedShortfall: tail.length ? -mean(tail) : -q,
  };
}

/** Beta and alpha vs an index from aligned return series (CAPM regression). */
export function betaVsIndex(assetReturns, indexReturns, riskFreeAnnual = 0.04) {
  const n = Math.min(assetReturns.length, indexReturns.length);
  const a = assetReturns.slice(-n);
  const m = indexReturns.slice(-n);
  const varM = covariance(m, m);
  const beta = varM === 0 ? 0 : covariance(a, m) / varM;
  const rfDaily = riskFreeAnnual / TRADING_DAYS;
  const alphaDaily = mean(a) - rfDaily - beta * (mean(m) - rfDaily);
  return { beta, alphaAnnual: alphaDaily * TRADING_DAYS, observations: n };
}

/** Compound annual growth rate from first/last value and number of trading days. */
export function cagr(first, last, days) {
  if (first <= 0 || days <= 0) return 0;
  return (last / first) ** (TRADING_DAYS / days) - 1;
}

/** Aligns several candle series on common dates; returns dates and close matrix. */
export function alignCloses(seriesMap) {
  const symbols = Object.keys(seriesMap);
  const maps = symbols.map((s) => new Map(seriesMap[s].map((c) => [c.time, c.close])));
  const dates = seriesMap[symbols[0]]
    .map((c) => c.time)
    .filter((t) => maps.every((m) => m.has(t)));
  const closes = Object.fromEntries(symbols.map((s, j) => [s, dates.map((t) => maps[j].get(t))]));
  return { dates, closes };
}
