// Anomaly Radar: an Isolation Forest, written from scratch.
//
// Idea (Liu, Ting & Zhou, 2008): unusual points are few and different, so they are easy to
// separate from the rest. Build many random trees; each split picks a random feature and a random
// cut point. A normal day sits deep inside the crowd and needs many cuts to be isolated, while an
// unusual day is cut off after only a few. The average path length h(x) over all trees becomes
//
//   score(x) = 2 ^ ( − E[h(x)] / c(ψ) )        (near 1 = very unusual, near 0.5 = ordinary)
//
// where c(ψ) is the average path length of an unsuccessful binary-search-tree lookup. Nothing is
// labelled in advance: the model learns what "normal" looks like for this stock on its own.
import { mean, std, rng, percentileSorted } from "./stats.js";

const EULER = 0.5772156649;

/** Average path length of an unsuccessful BST search among n points: the normalising constant. */
export function c(n) {
  if (n > 2) return 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n;
  return n === 2 ? 1 : 0;
}

function buildTree(rows, idx, depth, maxDepth, u) {
  if (idx.length <= 1 || depth >= maxDepth) return { size: idx.length };
  const dims = rows[0].length;
  // Try a few random features until one actually varies in this node.
  for (let attempt = 0; attempt < dims; attempt++) {
    const f = Math.floor(u() * dims);
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of idx) { const v = rows[i][f]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi > lo) {
      const cut = lo + u() * (hi - lo);
      const left = idx.filter((i) => rows[i][f] < cut);
      const right = idx.filter((i) => rows[i][f] >= cut);
      return { f, cut, left: buildTree(rows, left, depth + 1, maxDepth, u), right: buildTree(rows, right, depth + 1, maxDepth, u) };
    }
  }
  return { size: idx.length };
}

function pathLength(x, node, depth = 0) {
  if (node.size !== undefined) return depth + c(node.size);
  return pathLength(x, x[node.f] < node.cut ? node.left : node.right, depth + 1);
}

/** Trains a forest on `rows` (array of feature vectors) and returns a scoring function. */
export function isolationForest(rows, { trees = 150, subsample = 256, seed = 11 } = {}) {
  const u = rng(seed);
  const psi = Math.min(subsample, rows.length);
  const maxDepth = Math.ceil(Math.log2(psi));
  const forest = [];
  for (let t = 0; t < trees; t++) {
    // Sample ψ rows without replacement (partial Fisher–Yates).
    const order = Array.from({ length: rows.length }, (_, i) => i);
    for (let i = 0; i < psi; i++) { const j = i + Math.floor(u() * (rows.length - i)); [order[i], order[j]] = [order[j], order[i]]; }
    forest.push(buildTree(rows, order.slice(0, psi), 0, maxDepth, u));
  }
  const norm = c(psi);
  return { psi, trees, score: (x) => 2 ** (-(forest.reduce((s, tr) => s + pathLength(x, tr), 0) / forest.length) / norm) };
}

// ---------- features from daily candles ----------
export const FEATURES = ["ret", "gap", "range", "volume", "ret5", "shock"];

function median(a) {
  const s = Float64Array.from(a).sort();
  return percentileSorted(s, 0.5);
}

/** One row per day from day 21 on: how big the move, gap, range, volume and shock were. */
function buildFeatures(candles) {
  const n = candles.length;
  const r = candles.map((c, i) => (i ? c.close / candles[i - 1].close - 1 : 0));
  const rows = [];
  const days = [];
  for (let t = 21; t < n; t++) {
    const k = candles[t];
    const prev = candles[t - 1].close;
    const avgVol = mean(candles.slice(t - 20, t).map((x) => x.volume ?? 0));
    const sd = std(r.slice(t - 20, t)) || 1e-9;
    rows.push([
      r[t],
      k.open / prev - 1,
      (k.high - k.low) / k.close,
      Math.log(((k.volume ?? 0) + 1) / (avgVol + 1)),
      k.close / candles[t - 5].close - 1,
      r[t] / sd,
    ]);
    days.push(t);
  }
  return { rows, days };
}

/** Robust z-score of every feature (median and MAD), used only to explain why a day was flagged. */
function robustStats(rows) {
  return FEATURES.map((_, f) => {
    const col = rows.map((x) => x[f]);
    const m = median(col);
    const mad = median(col.map((v) => Math.abs(v - m))) * 1.4826 || 1e-9;
    return { m, mad };
  });
}

const forwardStats = (vals) => {
  if (!vals.length) return { n: 0, mean: null, median: null, probUp: null };
  const s = Float64Array.from(vals).sort();
  return { n: vals.length, mean: mean(vals), median: percentileSorted(s, 0.5), probUp: vals.filter((v) => v > 0).length / vals.length };
};

/**
 * @param {any[]} candles daily OHLCV, oldest first
 * @param {object} o
 * @param {number} o.flagTop share of days flagged as anomalies (default top 2%)
 */
export function analyseAnomalies(candles, { flagTop = 0.02, trees = 150, seed = 11 } = {}) {
  if (candles.length < 200) throw Object.assign(new Error("Need at least about 9 months of prices to learn what is normal"), { status: 422 });
  const { rows, days } = buildFeatures(candles);
  const forest = isolationForest(rows, { trees, seed });
  const scores = rows.map((x) => forest.score(x));
  const sorted = Float64Array.from(scores).sort();
  const threshold = percentileSorted(sorted, 1 - flagTop);
  const rz = robustStats(rows);

  const reasonsFor = (i) => rows[i]
    .map((v, f) => ({ key: FEATURES[f], value: FEATURES[f] === "volume" ? Math.exp(v) : v, z: (v - rz[f].m) / rz[f].mad }))
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, 3);

  const n = candles.length;
  const fwd = (t, h) => (t + h < n ? candles[t + h].close / candles[t].close - 1 : null);
  const flaggedIdx = scores.map((s, i) => (s >= threshold ? i : -1)).filter((i) => i >= 0);

  const aftermath = {};
  for (const h of [5, 20]) {
    const all = days.map((t) => fwd(t, h)).filter((v) => v != null);
    const fl = flaggedIdx.map((i) => fwd(days[i], h)).filter((v) => v != null);
    aftermath[`h${h}`] = { flagged: forwardStats(fl), all: forwardStats(all) };
  }

  // The most unusual days, skipping near neighbours of the same event.
  const ranked = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const top = [];
  for (const { s, i } of ranked) {
    if (top.length >= 10) break;
    if (top.some((x) => Math.abs(days[x.i] - days[i]) < 5)) continue;
    top.push({ s, i });
  }

  const last = scores.length - 1;
  const today = {
    score: scores[last],
    percentile: scores.filter((s) => s < scores[last]).length / scores.length,
    flagged: scores[last] >= threshold,
    reasons: reasonsFor(last),
    time: candles[days[last]].time,
  };

  return {
    params: { trees: forest.trees, subsample: forest.psi, flagTop, threshold, features: FEATURES, days: scores.length },
    series: scores.map((s, i) => ({ time: candles[days[i]].time, close: candles[days[i]].close, score: s, flagged: s >= threshold })),
    today,
    anomalies: top.map(({ s, i }) => ({
      time: candles[days[i]].time,
      score: s,
      close: candles[days[i]].close,
      move: rows[i][0],
      reasons: reasonsFor(i),
      next5: fwd(days[i], 5),
      next20: fwd(days[i], 20),
    })),
    flaggedCount: flaggedIdx.length,
    aftermath,
  };
}
