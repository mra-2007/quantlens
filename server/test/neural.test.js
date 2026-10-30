import { test } from "node:test";
import assert from "node:assert/strict";
import { trainNet, analyseNeural } from "../src/quant/neural.js";
import { rng, normalSampler } from "../src/quant/stats.js";
import { syntheticCandles } from "../src/lib/demoData.js";

test("The network learns a nonlinear rule (XOR-like) that a straight line cannot", () => {
  const z = normalSampler(rng(3));
  const X = Array.from({ length: 400 }, () => Float64Array.from([z(), z()]));
  const y = X.map((x) => (x[0] * x[1] > 0 ? 1 : 0));
  const net = trainNet(X, y, { hidden: 8, epochs: 400, lr: 0.05, l2: 1e-4, seed: 2 });
  const acc = X.filter((x, i) => (net.predict(x) > 0.5) === (y[i] === 1)).length / X.length;
  assert.ok(acc > 0.9, `accuracy ${acc}`);
});

function planted(seed) {
  const z = normalSampler(rng(seed));
  let drift = 0;
  let p = 100;
  return Array.from({ length: 1300 }, (_, i) => {
    drift = 0.97 * drift + 0.0006 * z();
    const o = p;
    p *= 1 + drift + 0.008 * z();
    return { time: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), open: o, high: Math.max(o, p), low: Math.min(o, p), close: p, volume: 1e6 * (1 + 0.2 * z()) };
  });
}

test("Walk-forward test finds a real, planted trending signal and is reproducible", () => {
  const edges = [1, 2, 4, 5].map((s) => { const r = analyseNeural(planted(s)); return r.card.accuracy - r.card.naive; });
  assert.ok(edges.filter((e) => e > 0.02).length >= 3, edges.join(","));
  const a = analyseNeural(planted(1));
  const b = analyseNeural(planted(1));
  assert.equal(a.today.probUp, b.today.probUp);
});

test("On pure random prices the report card never claims a signal", () => {
  for (const s of ["RELIANCE.NS", "AAPL", "TCS.NS"]) {
    const r = analyseNeural(syntheticCandles(s, 1260));
    assert.notEqual(r.verdict.label, "Some predictive signal", s);
    assert.ok(r.today.probUp > 0 && r.today.probUp < 1);
    assert.equal(r.params.folds, r.params.folds | 0);
    assert.ok(r.importance.length === 10 && r.calibration.reduce((t, c) => t + c.n, 0) === r.card.n);
  }
});
