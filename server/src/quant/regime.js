// Market regime detection with a Gaussian Hidden Markov Model, written from scratch.
//
// Idea: a stock does not behave the same way all the time. We assume a hidden state
// S_t ∈ {Calm, Choppy, Stress} that we never observe, only its effect on daily returns:
//
//   S_t | S_{t-1}=i  ~  Categorical(A_i·)        (transition matrix A, rows sum to 1)
//   r_t | S_t=k      ~  Normal(μ_k, σ_k²)         (each regime has its own mean and volatility)
//
// The model learns A, μ_k, σ_k from the price history alone (unsupervised):
//   • Baum–Welch (EM) with the scaled forward–backward algorithm fits the parameters,
//   • the forward pass gives P(S_T | r_1..r_T), "which regime are we in today?",
//     using only past data, so there is no look-ahead,
//   • Viterbi gives the single most likely regime for every past day (the chart band),
//   • the regime-switching Monte Carlo starts from today's regime probabilities and lets
//     volatility change as the simulated regime changes.
import { mean, std, rng, normalSampler } from "./stats.js";
import { logReturns } from "./risk.js";
import { monteCarlo, summarisePaths } from "./forecast.js";

export const REGIME_NAMES = ["Calm", "Choppy", "Stress"];
const K = 3;
const SQRT_2PI = Math.sqrt(2 * Math.PI);
const TRADING_DAYS = 252;

const pdf = (x, mu, sigma) => {
  const z = (x - mu) / sigma;
  return Math.max(Math.exp(-0.5 * z * z) / (sigma * SQRT_2PI), 1e-300);
};

/** B[t*K + k] = N(x_t; μ_k, σ_k²) */
function emissions(x, { mu, sigma }) {
  const T = x.length;
  const B = new Float64Array(T * K);
  for (let t = 0; t < T; t++) for (let k = 0; k < K; k++) B[t * K + k] = pdf(x[t], mu[k], sigma[k]);
  return B;
}

/** Scaled forward–backward. Scaling keeps probabilities from underflowing on long series. */
function forwardBackward(x, params) {
  const T = x.length;
  const { A, pi } = params;
  const B = emissions(x, params);
  const alpha = new Float64Array(T * K);
  const beta = new Float64Array(T * K);
  const c = new Float64Array(T);

  let s = 0;
  for (let k = 0; k < K; k++) { alpha[k] = pi[k] * B[k]; s += alpha[k]; }
  c[0] = s;
  for (let k = 0; k < K; k++) alpha[k] /= s;
  for (let t = 1; t < T; t++) {
    s = 0;
    for (let j = 0; j < K; j++) {
      let a = 0;
      for (let i = 0; i < K; i++) a += alpha[(t - 1) * K + i] * A[i][j];
      alpha[t * K + j] = a * B[t * K + j];
      s += alpha[t * K + j];
    }
    c[t] = s;
    for (let j = 0; j < K; j++) alpha[t * K + j] /= s;
  }

  for (let k = 0; k < K; k++) beta[(T - 1) * K + k] = 1;
  for (let t = T - 2; t >= 0; t--) {
    for (let i = 0; i < K; i++) {
      let b = 0;
      for (let j = 0; j < K; j++) b += A[i][j] * B[(t + 1) * K + j] * beta[(t + 1) * K + j];
      beta[t * K + i] = b / c[t + 1];
    }
  }

  let loglik = 0;
  for (let t = 0; t < T; t++) loglik += Math.log(c[t]);
  return { alpha, beta, c, B, loglik };
}

/** A starting point from how far each return is from the median: small / medium / large moves. */
function initialParams(x, cuts) {
  const T = x.length;
  const sorted = Float64Array.from(x).sort();
  const med = sorted[Math.floor(T / 2)];
  const dev = Array.from(x, (v) => Math.abs(v - med));
  const devSorted = Float64Array.from(dev).sort();
  const lo = devSorted[Math.floor(T * cuts[0])];
  const hi = devSorted[Math.floor(T * cuts[1])];
  const groups = [[], [], []];
  x.forEach((v, t) => groups[dev[t] <= lo ? 0 : dev[t] <= hi ? 1 : 2].push(v));
  const total = std(x) || 1e-4;
  return {
    mu: groups.map((g) => (g.length ? mean(g) : 0)),
    sigma: groups.map((g) => Math.max(g.length > 1 ? std(g) : total, total * 0.2)),
    A: [[0.94, 0.04, 0.02], [0.04, 0.92, 0.04], [0.02, 0.06, 0.92]],
    pi: [1 / 3, 1 / 3, 1 / 3],
  };
}

/** Baum–Welch: repeat E-step (forward–backward) and M-step (re-estimate) until the likelihood stops improving. */
function baumWelch(x, start, { maxIter = 250, tol = 1e-7 } = {}) {
  const T = x.length;
  const sigmaFloor = (std(x) || 1e-4) * 0.2; // stops a state collapsing onto a single day
  let params = start;
  const history = [];
  let prev = -Infinity;
  let iterations = 0;

  for (let it = 0; it < maxIter; it++) {
    const { alpha, beta, c, B, loglik } = forwardBackward(x, params);
    history.push(loglik);
    iterations = it + 1;
    if (loglik - prev < tol * Math.abs(loglik) && it > 0) break;
    prev = loglik;

    const gamma = new Float64Array(T * K);
    for (let t = 0; t < T; t++) {
      let s = 0;
      for (let k = 0; k < K; k++) { gamma[t * K + k] = alpha[t * K + k] * beta[t * K + k]; s += gamma[t * K + k]; }
      for (let k = 0; k < K; k++) gamma[t * K + k] /= s;
    }

    // Expected transition counts (+1 pseudo-count so no transition is ever impossible).
    const xi = Array.from({ length: K }, () => new Array(K).fill(1));
    for (let t = 0; t < T - 1; t++) {
      for (let i = 0; i < K; i++) {
        for (let j = 0; j < K; j++) {
          xi[i][j] += (alpha[t * K + i] * params.A[i][j] * B[(t + 1) * K + j] * beta[(t + 1) * K + j]) / c[t + 1];
        }
      }
    }
    const A = xi.map((row) => { const s = row.reduce((a, b) => a + b, 0); return row.map((v) => v / s); });

    const mu = new Array(K);
    const sigma = new Array(K);
    for (let k = 0; k < K; k++) {
      let w = 0;
      let m = 0;
      for (let t = 0; t < T; t++) { w += gamma[t * K + k]; m += gamma[t * K + k] * x[t]; }
      mu[k] = m / w;
      let v = 0;
      for (let t = 0; t < T; t++) v += gamma[t * K + k] * (x[t] - mu[k]) ** 2;
      sigma[k] = Math.max(Math.sqrt(v / w), sigmaFloor);
    }
    const pi = [0, 1, 2].map((k) => gamma[k]);
    params = { mu, sigma, A, pi };
  }
  const final = forwardBackward(x, params);
  return { params, loglik: final.loglik, history, iterations, fb: final };
}

/** Viterbi: the single most probable regime sequence, computed in log space. */
function viterbi(x, params, B) {
  const T = x.length;
  const logA = params.A.map((r) => r.map(Math.log));
  const delta = new Float64Array(T * K);
  const back = new Int8Array(T * K);
  for (let k = 0; k < K; k++) delta[k] = Math.log(params.pi[k]) + Math.log(B[k]);
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < K; j++) {
      let best = -Infinity;
      let arg = 0;
      for (let i = 0; i < K; i++) {
        const v = delta[(t - 1) * K + i] + logA[i][j];
        if (v > best) { best = v; arg = i; }
      }
      delta[t * K + j] = best + Math.log(B[t * K + j]);
      back[t * K + j] = arg;
    }
  }
  const path = new Int8Array(T);
  let best = -Infinity;
  for (let k = 0; k < K; k++) if (delta[(T - 1) * K + k] > best) { best = delta[(T - 1) * K + k]; path[T - 1] = k; }
  for (let t = T - 2; t >= 0; t--) path[t] = back[(t + 1) * K + path[t + 1]];
  return path;
}

/** Re-labels states so index 0 is the calmest (lowest σ) and 2 the most volatile. */
function sortByVolatility(p) {
  const order = [0, 1, 2].sort((a, b) => p.sigma[a] - p.sigma[b]);
  return {
    order,
    params: {
      mu: order.map((i) => p.mu[i]),
      sigma: order.map((i) => p.sigma[i]),
      pi: order.map((i) => p.pi[i]),
      A: order.map((i) => order.map((j) => p.A[i][j])),
    },
  };
}

/**
 * Fit a 3-state Gaussian HMM to a return series.
 * Several starting points are tried and the one with the best likelihood is kept.
 */
export function fitHmm(x) {
  if (x.length < 120) throw Object.assign(new Error("Not enough price history to detect regimes"), { status: 422 });
  const starts = [[1 / 3, 2 / 3], [0.5, 0.85], [0.6, 0.95]];
  let best = null;
  for (const cuts of starts) {
    const fit = baumWelch(x, initialParams(x, cuts));
    if (!best || fit.loglik > best.loglik) best = fit;
  }
  const { order, params } = sortByVolatility(best.params);
  const T = x.length;

  // Re-run forward–backward in the sorted labelling so every output uses the same state order.
  const fb = forwardBackward(x, params);
  const path = viterbi(x, params, fb.B);
  const filtered = (t) => [0, 1, 2].map((k) => fb.alpha[t * K + k]);

  const oneStateLogLik = (() => {
    const m = mean(x);
    const s = std(x);
    let ll = 0;
    for (let t = 0; t < T; t++) ll += Math.log(pdf(x[t], m, s));
    return ll;
  })();
  const nParams = (K - 1) + K * (K - 1) + 2 * K;
  const bic3 = -2 * fb.loglik + nParams * Math.log(T);
  const bic1 = -2 * oneStateLogLik + 2 * Math.log(T);

  return {
    params,
    path,
    filtered,
    filteredNow: filtered(T - 1),
    loglik: fb.loglik,
    logLikHistory: best.history,
    iterations: best.iterations,
    deltaBic: bic1 - bic3, // > 0 means the 3-regime model explains the data better than one bell curve
    restartsTried: starts.length,
    order,
  };
}

/** Long-run share of time in each regime: the stationary distribution of A (power iteration). */
export function stationary(A) {
  let p = [1 / K, 1 / K, 1 / K];
  for (let n = 0; n < 2000; n++) {
    const q = [0, 0, 0];
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) q[j] += p[i] * A[i][j];
    p = q;
  }
  return p;
}

const draw = (probs, u) => {
  let acc = 0;
  for (let k = 0; k < probs.length - 1; k++) { acc += probs[k]; if (u < acc) return k; }
  return probs.length - 1;
};

/**
 * Regime-switching Monte Carlo. Each path starts in a regime drawn from today's filtered
 * probabilities, then every day: move to a new regime using A, then draw that day's log
 * return from the new regime's Normal(μ_k, σ_k²). Volatility therefore changes with the regime.
 */
export function regimeMonteCarlo(params, s0, startProbs, { days = 126, paths = 1000, seed = 42, samplePaths = 12 } = {}) {
  const uniform = rng(seed);
  const nextNormal = normalSampler(uniform);
  const columns = Array.from({ length: days }, () => new Float64Array(paths));
  const samples = [];
  const timeIn = [0, 0, 0];
  let touchedStress = 0;

  for (let p = 0; p < paths; p++) {
    let state = draw(startProbs, uniform());
    let logS = Math.log(s0);
    const keep = p < samplePaths ? [s0] : null;
    let stress = false;
    for (let t = 0; t < days; t++) {
      state = draw(params.A[state], uniform());
      logS += params.mu[state] + params.sigma[state] * nextNormal();
      const price = Math.exp(logS);
      columns[t][p] = price;
      timeIn[state]++;
      if (state === K - 1) stress = true;
      if (keep) keep.push(price);
    }
    if (stress) touchedStress++;
    if (keep) samples.push(keep);
  }
  const total = days * paths;
  return {
    s0,
    days,
    paths,
    samplePaths: samples,
    regimeMix: timeIn.map((n) => n / total), // average share of the horizon spent in each regime
    probStress: touchedStress / paths, // chance a path visits the Stress regime at least once
    ...summarisePaths(columns, s0, days, paths),
  };
}

const pickTerminal = (mc) => ({
  p5: mc.terminal.p5,
  p50: mc.terminal.p50,
  p95: mc.terminal.p95,
  probAbove: mc.terminal.probAbove,
  probLoss10: mc.terminal.probLoss10,
});

/** Everything the app shows: fitted regimes, today's state, per-day band, and both forecasts. */
export function analyseRegimes(candles, { days = 126, paths = 1000, seed = 42 } = {}) {
  const closes = candles.map((c) => c.close);
  const x = logReturns(closes);
  const fit = fitHmm(x);
  const { params, path } = fit;
  const T = x.length;

  const counts = [0, 0, 0];
  for (const s of path) counts[s]++;
  // Average length of the uninterrupted runs Viterbi found, per regime.
  const runs = [[], [], []];
  let runStart = 0;
  for (let t = 1; t <= T; t++) {
    if (t === T || path[t] !== path[runStart]) { runs[path[runStart]].push(t - runStart); runStart = t; }
  }
  const lastState = path[T - 1];
  let runDays = 1;
  while (runDays < T && path[T - 1 - runDays] === lastState) runDays++;

  const longRun = stationary(params.A);
  const regimes = REGIME_NAMES.map((name, k) => ({
    name,
    share: counts[k] / T,
    longRunShare: longRun[k],
    dailyMean: params.mu[k],
    dailyVol: params.sigma[k],
    annualVol: params.sigma[k] * Math.sqrt(TRADING_DAYS),
    annualDrift: params.mu[k] * TRADING_DAYS,
    expectedDuration: 1 / (1 - params.A[k][k]),
    avgRun: runs[k].length ? mean(runs[k]) : 0,
  }));

  const probs = fit.filteredNow;
  const top = probs.indexOf(Math.max(...probs));
  const next = [0, 1, 2].map((j) => probs.reduce((s, p, i) => s + p * params.A[i][j], 0));
  const s0 = closes[closes.length - 1];

  // Same drift in every regime (the stock's overall mean, exactly as the plain GBM uses), so the
  // only thing that differs between the two forecasts is volatility following the regime.
  // Per-regime means are noisy estimates and are shown for information, not used to forecast.
  const simParams = { ...params, mu: params.mu.map(() => mean(x)) };
  const regimeMc = regimeMonteCarlo(simParams, s0, probs, { days, paths, seed });
  const plain = monteCarlo(closes, { days, paths, seed, lookback: closes.length, samplePaths: 0 });

  return {
    model: {
      names: REGIME_NAMES,
      A: params.A,
      observations: T,
      logLik: fit.loglik,
      iterations: fit.iterations,
      restarts: fit.restartsTried,
      deltaBic: fit.deltaBic,
      meaningful: fit.deltaBic > 10, // BIC difference above 10 = very strong evidence for 3 regimes over 1
      logLikHistory: fit.logLikHistory,
    },
    regimes,
    now: { state: top, name: REGIME_NAMES[top], prob: probs[top], probs, next, runDays, asOf: candles[candles.length - 1].time },
    path: Array.from(path, (s, i) => ({ time: candles[i + 1].time, state: s })),
    forecast: {
      ...regimeMc,
      history: candles.slice(-60).map((c) => ({ close: c.close })),
    },
    plain: { ...pickTerminal(plain), sigma: plain.sigma, drift: plain.drift },
    regimeTerminal: pickTerminal(regimeMc),
  };
}
