import { test } from "node:test";
import assert from "node:assert/strict";
import { sma, ema, rsi, macd, bollinger, stochastic, rollingExtrema, linearRegression } from "../src/quant/indicators.js";
import { simpleReturns, maxDrawdown, valueAtRisk, betaVsIndex, sharpeRatio, volatility } from "../src/quant/risk.js";
import { correlationMatrix, efficientFrontier } from "../src/quant/portfolio.js";
import { monteCarlo } from "../src/quant/forecast.js";
import { runBacktest, PRESETS, validateStrategy } from "../src/quant/backtest.js";
import { std } from "../src/quant/stats.js";
import { syntheticCandles } from "../src/lib/demoData.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// Naive reference implementations to check the O(n) versions against.
const naiveSma = (xs, p) => xs.map((_, i) => (i < p - 1 ? null : xs.slice(i - p + 1, i + 1).reduce((s, x) => s + x, 0) / p));

test("SMA matches the naive window average", () => {
  const xs = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.1);
  const a = sma(xs, 20);
  const b = naiveSma(xs, 20);
  a.forEach((v, i) => (v == null ? assert.equal(b[i], null) : close(v, b[i])));
});

test("EMA seeds with SMA and follows the recurrence", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  const e = ema(xs, 3);
  assert.deepEqual(e.slice(0, 2), [null, null]);
  close(e[2], 2);
  close(e[3], 4 * 0.5 + 2 * 0.5);
});

test("RSI is 100 on a monotonically rising series and in [0,100] generally", () => {
  const up = Array.from({ length: 40 }, (_, i) => i + 1);
  assert.equal(rsi(up, 14)[39], 100);
  const xs = syntheticCandles("TEST", 400).map((c) => c.close);
  for (const v of rsi(xs, 14)) if (v != null) assert.ok(v >= 0 && v <= 100);
});

test("Bollinger middle equals SMA and width equals 2·population σ", () => {
  const xs = syntheticCandles("BB", 200).map((c) => c.close);
  const bb = bollinger(xs, 20, 2);
  const s = sma(xs, 20);
  const win = xs.slice(100 - 19, 101);
  const m = win.reduce((a, b) => a + b, 0) / 20;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
  close(bb.middle[100], s[100], 1e-6);
  close(bb.upper[100] - bb.middle[100], 2 * sd, 1e-6);
});

test("MACD histogram = line − signal", () => {
  const xs = syntheticCandles("M", 300).map((c) => c.close);
  const m = macd(xs);
  for (let i = 0; i < xs.length; i++) if (m.histogram[i] != null) close(m.histogram[i], m.macd[i] - m.signal[i]);
  assert.equal(m.signal[32], null);
  assert.notEqual(m.signal[33], null);
});

test("Rolling extrema (deque) match brute force; stochastic in range", () => {
  const xs = syntheticCandles("X", 250).map((c) => c.close);
  const { max, min } = rollingExtrema(xs, 14);
  for (let i = 13; i < xs.length; i++) {
    const w = xs.slice(i - 13, i + 1);
    assert.equal(max[i], Math.max(...w));
    assert.equal(min[i], Math.min(...w));
  }
  const c = syntheticCandles("S", 250);
  const st = stochastic(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close));
  for (const v of st.k) if (v != null) assert.ok(v >= 0 && v <= 100);
});

test("Linear regression recovers an exact line", () => {
  const fit = linearRegression([3, 5, 7, 9, 11]);
  close(fit.slope, 2);
  close(fit.intercept, 3);
  close(fit.r2, 1);
});

test("Max drawdown finds the deepest peak-to-trough fall", () => {
  const dd = maxDrawdown([100, 120, 90, 130, 65, 140]);
  close(dd.maxDrawdown, 65 / 130 - 1);
  assert.equal(dd.peakIndex, 3);
  assert.equal(dd.troughIndex, 4);
});

test("Historical VaR picks the 5th percentile loss", () => {
  const returns = Array.from({ length: 101 }, (_, i) => (i - 50) / 1000); // −5% … +5%
  const v = valueAtRisk(returns, 0.95);
  close(v.historical, 0.045, 1e-12);
  assert.ok(v.expectedShortfall >= v.historical);
});

test("Beta of a 2× levered copy is 2; Sharpe and vol behave", () => {
  const idx = simpleReturns(syntheticCandles("IDX", 300).map((c) => c.close));
  const asset = idx.map((r) => 2 * r);
  close(betaVsIndex(asset, idx).beta, 2, 1e-9);
  close(volatility(idx).annual, std(idx) * Math.sqrt(252));
  assert.ok(Number.isFinite(sharpeRatio(idx)));
});

test("Correlation matrix is symmetric with unit diagonal", () => {
  const a = simpleReturns(syntheticCandles("A", 200).map((c) => c.close));
  const b = simpleReturns(syntheticCandles("B", 200).map((c) => c.close));
  const { matrix } = correlationMatrix({ A: a, B: b, NEG: a.map((x) => -x) });
  close(matrix[0][0], 1);
  close(matrix[0][1], matrix[1][0]);
  close(matrix[0][2], -1, 1e-9);
});

test("Efficient frontier: weights sum to 1, max-Sharpe beats every sample", () => {
  const rets = Object.fromEntries(["A", "B", "C"].map((s) => [s, simpleReturns(syntheticCandles(s, 300).map((c) => c.close))]));
  const ef = efficientFrontier(rets, { samples: 2000 });
  close(ef.maxSharpe.weights.reduce((s, w) => s + w, 0), 1, 1e-9);
  for (const p of ef.cloud) assert.ok(p.sharpe <= ef.maxSharpe.sharpe + 1e-12);
  for (let i = 1; i < ef.frontier.length; i++) assert.ok(ef.frontier[i].ret > ef.frontier[i - 1].ret);
});

test("Monte Carlo: 1000 paths, ordered bands, reproducible by seed", () => {
  const xs = syntheticCandles("MC", 400).map((c) => c.close);
  const a = monteCarlo(xs, { days: 60, paths: 1000, seed: 1 });
  const b = monteCarlo(xs, { days: 60, paths: 1000, seed: 1 });
  assert.equal(a.bands.length, 61);
  for (const band of a.bands) assert.ok(band.p5 <= band.p25 && band.p25 <= band.p50 && band.p50 <= band.p75 && band.p75 <= band.p95);
  assert.equal(a.terminal.p50, b.terminal.p50);
  assert.equal(a.terminal.histogram.reduce((s, h) => s + h.count, 0), 1000);
});

test("Backtest: golden cross trades, no look-ahead, buy & hold baseline is exact", () => {
  const candles = syntheticCandles("BT", 900);
  const res = runBacktest(candles, PRESETS.goldenCross);
  const bh = res.stats.buyHold.totalReturn;
  close(bh, candles.at(-1).close / candles[0].close - 1, 1e-9);
  for (const t of res.trades) assert.ok(t.exitTime > t.entryTime);
  // entries are filled at the bar after the signal, never the signal bar itself
  const idx = new Map(candles.map((c, i) => [c.time, i]));
  for (const t of res.trades) assert.equal(t.entryPrice, candles[idx.get(t.entryTime)].open);
  assert.equal(res.curve.length, candles.length);
});

test("Strategy validation rejects bad input", () => {
  assert.ok(validateStrategy({ entry: [], exit: [] }).length > 0);
  assert.ok(validateStrategy({ entry: [{ left: { ind: "nope" }, op: ">", right: 1 }], exit: [{ left: { ind: "rsi" }, op: "<", right: 1 }] }).length > 0);
  assert.equal(validateStrategy(PRESETS.rsiReversion).length, 0);
});
