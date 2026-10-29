import { mean, std, rng, normalSampler, percentileSorted } from "./stats.js";
import { logReturns } from "./risk.js";
import { linearRegression } from "./indicators.js";

/**
 * Monte Carlo price simulation using geometric Brownian motion calibrated on
 * historical log returns: ln S_{t+1} = ln S_t + μ + σ·Z, Z ~ N(0,1).
 * Returns percentile bands for a fan chart, a handful of sample paths and the
 * distribution of terminal prices.
 */
export function monteCarlo(closes, { days = 126, paths = 1000, seed = 42, samplePaths = 24, lookback = 504 } = {}) {
  const hist = closes.slice(-lookback - 1);
  const lr = logReturns(hist);
  const mu = mean(lr);
  const sigma = std(lr);
  const s0 = closes[closes.length - 1];
  const nextNormal = normalSampler(rng(seed));

  // columns[t] holds every path's price at step t (Float64Array for memory/speed).
  const columns = Array.from({ length: days }, () => new Float64Array(paths));
  const samples = [];
  for (let p = 0; p < paths; p++) {
    let logS = Math.log(s0);
    const keep = p < samplePaths ? [s0] : null;
    for (let t = 0; t < days; t++) {
      logS += mu + sigma * nextNormal();
      const s = Math.exp(logS);
      columns[t][p] = s;
      if (keep) keep.push(s);
    }
    if (keep) samples.push(keep);
  }

  const qs = [0.05, 0.25, 0.5, 0.75, 0.95];
  const bands = [{ step: 0, p5: s0, p25: s0, p50: s0, p75: s0, p95: s0, mean: s0 }];
  for (let t = 0; t < days; t++) {
    const sorted = Float64Array.from(columns[t]).sort();
    const [p5, p25, p50, p75, p95] = qs.map((q) => percentileSorted(sorted, q));
    bands.push({ step: t + 1, p5, p25, p50, p75, p95, mean: mean(sorted) });
  }

  const terminal = Float64Array.from(columns[days - 1]).sort();
  const histogram = buildHistogram(terminal, 30);
  const above = terminal.filter((v) => v > s0).length / paths;
  const loss10 = terminal.filter((v) => v < s0 * 0.9).length / paths;

  return {
    s0,
    days,
    paths,
    drift: mu,
    sigma,
    bands,
    samplePaths: samples,
    terminal: {
      p5: percentileSorted(terminal, 0.05),
      p50: percentileSorted(terminal, 0.5),
      p95: percentileSorted(terminal, 0.95),
      mean: mean(terminal),
      probAbove: above,
      probLoss10: loss10,
      histogram,
    },
  };
}

function buildHistogram(sorted, bins) {
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const width = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of sorted) counts[Math.min(bins - 1, Math.floor((v - lo) / width))]++;
  return counts.map((count, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count }));
}

/** Linear-regression trend on closes, projected `ahead` bars with a ±2σ residual channel. */
export function regressionTrend(closes, ahead = 30) {
  const fit = linearRegression(closes);
  const projection = [];
  for (let k = 1; k <= ahead; k++) {
    const x = closes.length - 1 + k;
    const y = fit.predict(x);
    projection.push({ step: k, value: y, upper: y + 2 * fit.residualSd, lower: y - 2 * fit.residualSd });
  }
  return {
    slope: fit.slope,
    intercept: fit.intercept,
    r2: fit.r2,
    residualSd: fit.residualSd,
    line: fit.line,
    projection,
    std: std(closes),
  };
}
