import { test } from "node:test";
import assert from "node:assert/strict";
import { jacobiEigen, analyseXRay } from "../src/quant/xray.js";
import { rng, normalSampler } from "../src/quant/stats.js";

test("Jacobi eigen-decomposition recovers a known spectrum", () => {
  const M = [[2, 1, 0], [1, 2, 0], [0, 0, 5]];
  const { values, vectors } = jacobiEigen(M);
  assert.ok(Math.abs(values[0] - 5) < 1e-9 && Math.abs(values[1] - 3) < 1e-9 && Math.abs(values[2] - 1) < 1e-9);
  assert.ok(Math.abs(Math.abs(vectors[0][2]) - 1) < 1e-9);
  assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 9) < 1e-9);
});

function book(groups, per, len = 500, seed = 8) {
  const z = normalSampler(rng(seed));
  const factors = groups.map(() => Array.from({ length: len }, () => 0.01 * z()));
  const out = [];
  groups.forEach((g, gi) => {
    for (let k = 0; k < per; k++) out.push({ symbol: `${g}${k}`, weight: 1, returns: factors[gi].map((f) => f + 0.003 * z()) });
  });
  return out;
}

test("X-ray finds the planted groups, and the effective number of bets is about the number of groups", () => {
  const r = analyseXRay(book(["BANK", "IT", "OIL"], 3));
  assert.equal(r.clusters.k, 3);
  const sets = r.clusters.groups.map((g) => g.members.map((m) => m.symbol.replace(/\d/, "")).sort().join(","));
  for (const s of sets) assert.ok(/^(BANK,BANK,BANK|IT,IT,IT|OIL,OIL,OIL)$/.test(s), s);
  assert.ok(r.effectiveBets > 2.4 && r.effectiveBets < 4.2, String(r.effectiveBets));
  assert.ok(Math.abs(r.clusters.groups.reduce((s, g) => s + g.riskShare, 0) - 1) < 1e-9);
});

test("Stocks that all move together count as about one bet and risk shares add to 100%", () => {
  const r = analyseXRay(book(["ALL"], 5));
  assert.ok(r.effectiveBets < 1.6, String(r.effectiveBets));
  assert.equal(r.grade, "Concentrated");
  assert.ok(Math.abs(r.holdings.reduce((s, h) => s + h.riskShare, 0) - 1) < 1e-9);
  assert.ok(r.trims.every((t) => t.riskCut > -0.05));
});

test("Too few stocks gives a clear error", () => {
  assert.throws(() => analyseXRay(book(["A"], 2)), /at least 3/);
});
