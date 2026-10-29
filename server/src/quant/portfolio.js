import { mean, covariance, correlation, rng, TRADING_DAYS } from "./stats.js";

/** Pairwise Pearson correlation matrix of return series. */
export function correlationMatrix(returnsBySymbol) {
  const symbols = Object.keys(returnsBySymbol);
  const matrix = symbols.map((a) => symbols.map((b) => (a === b ? 1 : correlation(returnsBySymbol[a], returnsBySymbol[b]))));
  return { symbols, matrix };
}

/** Annualised mean returns vector and covariance matrix. */
export function annualisedMoments(returnsBySymbol) {
  const symbols = Object.keys(returnsBySymbol);
  const mu = symbols.map((s) => mean(returnsBySymbol[s]) * TRADING_DAYS);
  const cov = symbols.map((a) => symbols.map((b) => covariance(returnsBySymbol[a], returnsBySymbol[b]) * TRADING_DAYS));
  return { symbols, mu, cov };
}

export function portfolioStats(weights, mu, cov, riskFree = 0.04) {
  let ret = 0;
  let variance = 0;
  for (let i = 0; i < weights.length; i++) {
    ret += weights[i] * mu[i];
    for (let j = 0; j < weights.length; j++) variance += weights[i] * weights[j] * cov[i][j];
  }
  const vol = Math.sqrt(Math.max(variance, 0));
  return { ret, vol, sharpe: vol === 0 ? 0 : (ret - riskFree) / vol };
}

/** Random long-only weights from a flat Dirichlet (normalised exponentials). */
function randomWeights(n, uniform) {
  const w = new Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    w[i] = -Math.log(1 - uniform());
    s += w[i];
  }
  for (let i = 0; i < n; i++) w[i] /= s;
  return w;
}

/**
 * Markowitz efficient frontier (long-only) by Monte Carlo sampling of the weight
 * simplex. The frontier is the upper envelope of sampled (σ, μ) points: points are
 * bucketed by volatility, the best return per bucket is kept and the curve is made
 * monotonic above the minimum-variance point.
 */
export function efficientFrontier(returnsBySymbol, { samples = 4000, riskFree = 0.04, seed = 7, buckets = 40 } = {}) {
  const { symbols, mu, cov } = annualisedMoments(returnsBySymbol);
  const uniform = rng(seed);
  const n = symbols.length;
  const points = [];

  // Include the single-asset corners so the cloud spans the whole region.
  for (let i = 0; i < n; i++) {
    const w = symbols.map((_, j) => (j === i ? 1 : 0));
    points.push({ weights: w, ...portfolioStats(w, mu, cov, riskFree) });
  }
  for (let k = 0; k < samples; k++) {
    const w = randomWeights(n, uniform);
    points.push({ weights: w, ...portfolioStats(w, mu, cov, riskFree) });
  }

  let maxSharpe = points[0];
  let minVol = points[0];
  for (const p of points) {
    if (p.sharpe > maxSharpe.sharpe) maxSharpe = p;
    if (p.vol < minVol.vol) minVol = p;
  }

  const vols = points.map((p) => p.vol);
  const lo = Math.min(...vols);
  const hi = Math.max(...vols);
  const width = (hi - lo) / buckets || 1;
  const best = new Array(buckets + 1).fill(null);
  for (const p of points) {
    const b = Math.min(buckets, Math.floor((p.vol - lo) / width));
    if (!best[b] || p.ret > best[b].ret) best[b] = p;
  }
  const frontier = [];
  let runningMax = -Infinity;
  for (const p of best) {
    if (!p || p.ret < minVol.ret) continue;
    if (p.ret > runningMax) {
      frontier.push(p);
      runningMax = p.ret;
    }
  }

  // Thin the cloud for transport; the frontier and the two optima keep full precision.
  const step = Math.max(1, Math.floor(points.length / 1500));
  const cloud = points.filter((_, i) => i % step === 0).map(({ ret, vol, sharpe }) => ({ ret, vol, sharpe }));
  const assets = symbols.map((s, i) => ({ symbol: s, ret: mu[i], vol: Math.sqrt(cov[i][i]) }));

  return { symbols, assets, cloud, frontier, maxSharpe, minVol, riskFree };
}
