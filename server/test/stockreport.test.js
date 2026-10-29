import { test } from "node:test";
import assert from "node:assert/strict";
import { holdingReport } from "../src/quant/stockreport.js";
import { syntheticCandles } from "../src/lib/demoData.js";

const candles = syntheticCandles("TCS.NS", 504);
const holding = { quantity: 12, avgPrice: 3000 };

test("Per-stock report: position forecast is quantity × simulated price", () => {
  const r = holdingReport(candles, { holding, days: 21 });
  assert.equal(r.price, candles.at(-1).close);
  assert.ok(Math.abs(r.forecast.position.now - 12 * r.price) < 1e-6);
  assert.ok(Math.abs(r.forecast.position.median - 12 * r.forecast.median) < 1e-6);
  assert.ok(r.forecast.p5 <= r.forecast.median && r.forecast.median <= r.forecast.p95);
  assert.ok(r.forecast.probUp >= 0 && r.forecast.probUp <= 1);
  assert.equal(r.forecast.bands.length, 22);
});

test("Per-stock report: signal votes add up and the run is reproducible", () => {
  const a = holdingReport(candles, { holding, days: 21 });
  const b = holdingReport(candles, { holding, days: 21 });
  const { bullish, bearish, neutral } = a.verdict;
  assert.equal(bullish + bearish + neutral, a.signals.length);
  assert.ok(a.signals.length >= 7);
  assert.equal(a.forecast.median, b.forecast.median);
});
