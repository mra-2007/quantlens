import { test } from "node:test";
import assert from "node:assert/strict";
import { c, isolationForest, analyseAnomalies } from "../src/quant/anomaly.js";
import { rng, normalSampler } from "../src/quant/stats.js";
import { syntheticCandles } from "../src/lib/demoData.js";

test("Average path length constant matches its definition", () => {
  assert.equal(c(1), 0);
  assert.equal(c(2), 1);
  assert.ok(Math.abs(c(256) - 10.24) < 0.01);
});

test("Isolation Forest scores planted outliers above a Gaussian crowd, reproducibly", () => {
  const z = normalSampler(rng(4));
  const crowd = Array.from({ length: 400 }, () => [z(), z(), z()]);
  const outliers = [[8, 8, 8], [-9, 7, -8], [10, -9, 9]];
  const rows = [...crowd, ...outliers];
  const f = isolationForest(rows, { seed: 2 });
  const scores = rows.map((x) => f.score(x));
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.i).sort();
  assert.deepEqual(order, [400, 401, 402]);
  assert.ok(scores.every((s) => s > 0 && s < 1));
  assert.ok(scores[400] > 0.65 && scores.slice(0, 400).sort((a, b) => a - b)[200] < 0.5);
  assert.equal(isolationForest(rows, { seed: 2 }).score(rows[0]), f.score(rows[0]));
});

test("A planted crash on huge volume is the top anomaly and the reasons say why", () => {
  const candles = syntheticCandles("TCS.NS", 900).map((k) => ({ ...k }));
  const i = 700;
  const prev = candles[i - 1].close;
  candles[i] = { ...candles[i], open: prev * 0.97, close: prev * 0.88, low: prev * 0.86, high: prev * 0.98, volume: candles[i].volume * 8 };
  for (let j = i + 1; j < candles.length; j++) candles[j] = { ...candles[j], close: candles[j].close * 0.88 / (candles[i].close / prev), open: candles[j].open * 0.88 / (candles[i].close / prev), high: candles[j].high * 0.88 / (candles[i].close / prev), low: candles[j].low * 0.88 / (candles[i].close / prev) };
  const r = analyseAnomalies(candles);
  assert.equal(r.anomalies[0].time, candles[i].time);
  assert.ok(r.anomalies[0].move < -0.1);
  const keys = r.anomalies[0].reasons.map((x) => x.key);
  assert.ok(keys.includes("volume") || keys.includes("ret") || keys.includes("shock"));
  assert.ok(Math.abs(r.flaggedCount / r.params.days - 0.02) < 0.01);
  assert.ok(r.series.length === r.params.days && r.today.percentile >= 0 && r.today.percentile <= 1);
});
