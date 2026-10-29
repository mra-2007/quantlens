import { sma, ema, macd, bollinger, rsi, stochastic } from "./indicators.js";
import { simpleReturns, volatility, sharpeRatio, sortinoRatio, maxDrawdown, valueAtRisk, betaVsIndex, cagr, alignCloses } from "./risk.js";
import { regressionTrend } from "./forecast.js";
import { round } from "./stats.js";

const r = (arr, d = 4) => arr.map((v) => (v == null ? null : round(v, d)));

/** Full single-stock analysis: overlays, oscillators, risk metrics and trend. */
export function analyzeStock(candles, { indexCandles = null, riskFree = 0.04, plan = "free" } = {}) {
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const returns = simpleReturns(close);
  const m = macd(close);
  const bb = bollinger(close, 20, 2);
  const st = stochastic(high, low, close, 14, 3, 3);
  const dd = maxDrawdown(close);
  const vol = volatility(returns);
  const trend = regressionTrend(close, 30);

  let beta = null;
  if (indexCandles?.length) {
    const { closes } = alignCloses({ asset: candles, index: indexCandles });
    beta = betaVsIndex(simpleReturns(closes.asset), simpleReturns(closes.index), riskFree);
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;

  return {
    plan,
    quote: {
      price: last.close,
      change: last.close - prev.close,
      changePct: last.close / prev.close - 1,
      high52: Math.max(...high.slice(-252)),
      low52: Math.min(...low.slice(-252)),
      asOf: last.time,
    },
    overlays: {
      sma20: r(sma(close, 20)),
      sma50: r(sma(close, 50)),
      sma200: r(sma(close, 200)),
      ema12: r(ema(close, 12)),
      ema26: r(ema(close, 26)),
      bbUpper: r(bb.upper),
      bbMiddle: r(bb.middle),
      bbLower: r(bb.lower),
      trend: r(trend.line),
    },
    oscillators: {
      rsi: r(rsi(close, 14), 2),
      macd: r(m.macd),
      macdSignal: r(m.signal),
      macdHist: r(m.histogram),
      stochK: r(st.k, 2),
      stochD: r(st.d, 2),
    },
    risk: {
      dailyVol: vol.daily,
      annualVol: vol.annual,
      sharpe: sharpeRatio(returns, riskFree),
      sortino: sortinoRatio(returns, riskFree),
      maxDrawdown: dd.maxDrawdown,
      drawdownFrom: candles[dd.peakIndex]?.time,
      drawdownTo: candles[dd.troughIndex]?.time,
      drawdownSeries: r(dd.series),
      var95: valueAtRisk(returns, 0.95),
      var99: valueAtRisk(returns, 0.99),
      cagr: cagr(close[0], close[close.length - 1], close.length - 1),
      totalReturn: close[close.length - 1] / close[0] - 1,
      beta,
      riskFree,
    },
    trend: {
      slopePerDay: trend.slope,
      r2: trend.r2,
      residualSd: trend.residualSd,
      projection: trend.projection,
    },
    signals: summariseSignals(close, m, rsi(close, 14), st, bb),
  };
}

/** Plain-language read of the latest values. Purely rule-based, not advice. */
function summariseSignals(close, m, rsiSeries, st, bb) {
  const i = close.length - 1;
  const out = [];
  const rv = rsiSeries[i];
  if (rv != null) out.push({ name: "RSI(14)", value: rv, state: rv > 70 ? "overbought" : rv < 30 ? "oversold" : "neutral" });
  if (m.macd[i] != null && m.signal[i] != null) {
    out.push({ name: "MACD vs signal", value: m.macd[i] - m.signal[i], state: m.macd[i] > m.signal[i] ? "bullish" : "bearish" });
  }
  if (st.k[i] != null) out.push({ name: "Stochastic %K", value: st.k[i], state: st.k[i] > 80 ? "overbought" : st.k[i] < 20 ? "oversold" : "neutral" });
  if (bb.upper[i] != null) {
    const pctB = (close[i] - bb.lower[i]) / (bb.upper[i] - bb.lower[i]);
    out.push({ name: "Bollinger %B", value: pctB, state: pctB > 1 ? "above upper band" : pctB < 0 ? "below lower band" : "inside bands" });
  }
  return out;
}
