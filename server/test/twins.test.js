import { test } from "node:test";
import assert from "node:assert/strict";
import { dtw, wilson, findTwins } from "../src/quant/twins.js";
import { rng, normalSampler } from "../src/quant/stats.js";
import { syntheticCandles } from "../src/lib/demoData.js";

const euclid = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

test("DTW is zero for identical shapes, symmetric, and forgives small speed differences", () => {
  const a = Float64Array.from({ length: 40 }, (_, i) => Math.sin(i / 5));
  const b = Float64Array.from({ length: 40 }, (_, i) => Math.sin((i - 3) / 5)); // same wave, shifted
  assert.equal(dtw(a, a), 0);
  assert.ok(Math.abs(dtw(a, b) - dtw(b, a)) < 1e-9);
  assert.ok(dtw(a, b, 5) < euclid(a, b), "warping should match a shifted wave better than point-by-point");
});

test("Wilson interval contains the observed proportion and stays inside [0, 1]", () => {
  const [lo, hi] = wilson(14, 20);
  assert.ok(lo < 0.7 && hi > 0.7 && lo >= 0 && hi <= 1);
  assert.deepEqual(wilson(0, 0), [0, 1]);
});

test("Pattern search finds a planted twin, reports its aftermath, and spaces its matches", () => {
  const u = rng(1);
  const z = normalSampler(u);
  const walk = (n, start = 100) => { const out = [start]; for (let i = 1; i < n; i++) out.push(out[i - 1] * Math.exp(0.0003 + 0.012 * z())); return out; };
  const toCandles = (closes) => closes.map((c, i) => ({ time: `2020-01-${String(i).padStart(4, "0")}`, open: c, high: c, low: c, close: c, volume: 1 }));

  const main = walk(700);
  const query = main.slice(-40);
  // Peer: a different random walk with a scaled, shifted copy of the query shape planted in it, then a +20% jump.
  const peer = walk(700, 50);
  const at = 300;
  const scale = peer[at] / query[0];
  for (let i = 0; i < 40; i++) peer[at + i] = query[i] * scale * 1.0;
  const endPlanted = at + 39;
  for (let h = 1; h <= 21; h++) peer[endPlanted + h] = peer[endPlanted] * (1 + 0.2 * (h / 21));
  for (let i = endPlanted + 22; i < 700; i++) peer[i] = peer[i - 1] * Math.exp(0.012 * z());

  const r = findTwins([{ symbol: "MAIN", candles: toCandles(main) }, { symbol: "PEER", candles: toCandles(peer) }], { target: "MAIN", length: 40, horizon: 21, k: 10 });
  const top = r.matches[0];
  assert.equal(top.symbol, "PEER");
  assert.ok(top.end === toCandles(peer)[endPlanted].time);
  assert.ok(Math.abs(top.forwardReturn - 0.2) < 1e-6);
  assert.ok(top.distance < 0.05);
  for (const sym of ["MAIN", "PEER"]) {
    const ends = r.matches.filter((m) => m.symbol === sym).map((m) => m.end).sort();
    for (let i = 1; i < ends.length; i++) assert.ok(ends[i] > ends[i - 1]);
  }
});

test("Real-looking data gives a complete report with an honest base rate", () => {
  const universe = ["TCS.NS", "INFY.NS", "RELIANCE.NS"].map((s) => ({ symbol: s, candles: syntheticCandles(s, 1260) }));
  const r = findTwins(universe, { target: "TCS.NS" });
  assert.equal(r.matches.length, 20);
  assert.equal(r.matches[0].shape.length, 40);
  assert.equal(r.matches[0].forward.length, 21);
  assert.ok(r.baseline.probUp > 0 && r.baseline.probUp < 1);
  assert.ok(r.summary.ci[0] <= r.summary.probUp && r.summary.probUp <= r.summary.ci[1]);
  assert.ok(["Leans up", "Leans down", "No clear edge"].includes(r.verdict.label));
});
