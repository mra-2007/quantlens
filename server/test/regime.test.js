import { test } from "node:test";
import assert from "node:assert/strict";
import { fitHmm, regimeMonteCarlo, stationary, analyseRegimes } from "../src/quant/regime.js";
import { rng, normalSampler } from "../src/quant/stats.js";
import { syntheticCandles } from "../src/lib/demoData.js";

// Returns from a known 3-regime process, so we can check the model finds the truth.
const TRUE = {
  mu: [0.0008, 0.0, -0.002],
  sigma: [0.006, 0.014, 0.035],
  A: [[0.97, 0.025, 0.005], [0.03, 0.95, 0.02], [0.02, 0.08, 0.9]],
};
function simulate(T, seed = 5) {
  const u = rng(seed);
  const z = normalSampler(u);
  const x = [];
  const states = [];
  let s = 0;
  for (let t = 0; t < T; t++) {
    const r = u();
    const row = TRUE.A[s];
    s = r < row[0] ? 0 : r < row[0] + row[1] ? 1 : 2;
    states.push(s);
    x.push(TRUE.mu[s] + TRUE.sigma[s] * z());
  }
  return { x, states };
}

test("HMM recovers the volatility of each hidden regime and most of the regime labels", () => {
  const { x, states } = simulate(1500);
  const fit = fitHmm(x);
  fit.params.sigma.forEach((s, k) => assert.ok(Math.abs(s - TRUE.sigma[k]) / TRUE.sigma[k] < 0.25, `σ${k}=${s}`));
  assert.ok(fit.params.sigma[0] < fit.params.sigma[1] && fit.params.sigma[1] < fit.params.sigma[2]);
  const hit = states.filter((s, t) => s === fit.path[t]).length / states.length;
  assert.ok(hit > 0.7, `Viterbi accuracy ${hit}`);
  assert.ok(fit.deltaBic > 0, "3 regimes should beat a single bell curve on regime data");
});

test("Baum–Welch raises the likelihood to convergence and the probabilities are valid", () => {
  const { x } = simulate(800, 9);
  const fit = fitHmm(x);
  // The +1 transition pseudo-count makes this regularised EM, so allow a wobble of <0.01 near convergence.
  const h = fit.logLikHistory;
  for (let i = 1; i < h.length; i++) assert.ok(h[i] >= h[i - 1] - 0.01, `drop at ${i}`);
  assert.ok(h[h.length - 1] > h[0] + 10, "likelihood should improve a lot from the starting guess");
  for (const row of fit.params.A) assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(fit.filteredNow.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const st = stationary(fit.params.A);
  assert.ok(Math.abs(st.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("Regime-switching Monte Carlo is wider when it starts in Stress than in Calm, and is reproducible", () => {
  const params = { mu: TRUE.mu, sigma: TRUE.sigma, A: TRUE.A };
  const opts = { days: 21, paths: 2000, seed: 3 };
  const calm = regimeMonteCarlo(params, 100, [1, 0, 0], opts);
  const stress = regimeMonteCarlo(params, 100, [0, 0, 1], opts);
  assert.ok(stress.terminal.p95 - stress.terminal.p5 > 1.5 * (calm.terminal.p95 - calm.terminal.p5));
  assert.ok(Math.abs(stress.regimeMix.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(stress.probStress > calm.probStress);
  assert.equal(regimeMonteCarlo(params, 100, [1, 0, 0], opts).terminal.p50, calm.terminal.p50);
});

test("analyseRegimes returns a complete, consistent report", () => {
  const candles = syntheticCandles("TCS.NS", 1250);
  const r = analyseRegimes(candles, { days: 63, paths: 500 });
  assert.equal(r.path.length, candles.length - 1);
  assert.equal(r.regimes.length, 3);
  assert.ok(Math.abs(r.regimes.reduce((a, g) => a + g.share, 0) - 1) < 1e-9);
  assert.ok(Math.abs(r.now.probs.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(r.forecast.bands.length, 64);
  assert.equal(r.forecast.samplePaths.length, 12);
  assert.ok(r.regimes[0].annualVol < r.regimes[2].annualVol);
});
