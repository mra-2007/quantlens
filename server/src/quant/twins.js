// Pattern Twins: k-nearest-neighbour search over chart shapes, using dynamic time warping.
//
// "Learning from history": take the shape of the last L days, search every past L-day window
// of the stock (and of several peer stocks) for the K most similar shapes, then look at what
// actually happened in the H days after each of them. There is no model and no formula, just
// remembered examples, which is why this is called instance-based (lazy) learning.
//
// Similarity: both windows are converted to log prices and z-normalised (mean 0, sd 1), so only
// the SHAPE matters, not the price level or the size of the move. Dynamic time warping then
// matches shapes even when one version is slightly faster or slower than the other. A
// Sakoe–Chiba band keeps the warping small and the search fast.
//
// Honesty: a result is compared with the base rate (how often ANY window was followed by a rise)
// and given a 95% Wilson interval, because 20 examples can never prove much on their own.
import { mean, std, percentileSorted } from "./stats.js";

/** Squared-distance DTW with a Sakoe–Chiba band. Returns the total cost along the best path. */
export function dtw(a, b, band = 5) {
  const n = a.length;
  const INF = 1e18;
  let prev = new Float64Array(n + 1).fill(INF);
  let cur = new Float64Array(n + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(INF);
    const lo = Math.max(1, i - band);
    const hi = Math.min(n, i + band);
    for (let j = lo; j <= hi; j++) {
      const d = (a[i - 1] - b[j - 1]) ** 2;
      cur[j] = d + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Log prices of a window, shifted and scaled to mean 0 and standard deviation 1. */
function shapeOf(logs, from, length) {
  const w = new Float64Array(length);
  let m = 0;
  for (let i = 0; i < length; i++) { w[i] = logs[from + i]; m += w[i]; }
  m /= length;
  let v = 0;
  for (let i = 0; i < length; i++) v += (w[i] - m) ** 2;
  const sd = Math.sqrt(v / length) || 1e-9;
  for (let i = 0; i < length; i++) w[i] = (w[i] - m) / sd;
  return w;
}

/** 95% Wilson score interval for a proportion k/n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

/**
 * @param {{symbol:string, candles:any[]}[]} universe  the target stock plus peers
 * @param {object} o
 * @param {string} o.target     symbol whose latest shape is the query
 * @param {number} o.length     pattern length in trading days
 * @param {number} o.horizon    how many days ahead to look after each twin
 */
export function findTwins(universe, { target, length = 40, horizon = 21, k = 20, band = 5, minGap = 15 } = {}) {
  const main = universe.find((u) => u.symbol === target);
  if (!main) throw Object.assign(new Error("Target stock missing from the search universe"), { status: 400 });
  const nMain = main.candles.length;
  if (nMain < length + horizon + 60) throw Object.assign(new Error("Not enough price history to search for patterns"), { status: 422 });

  const prepared = universe.map((u) => ({
    symbol: u.symbol,
    candles: u.candles,
    close: u.candles.map((c) => c.close),
    logs: Float64Array.from(u.candles, (c) => Math.log(c.close)),
  }));
  const mainP = prepared.find((p) => p.symbol === target);
  const query = shapeOf(mainP.logs, nMain - length, length);

  // Scan every past window that has `horizon` days of known aftermath.
  const cands = [];
  let upCount = 0;
  let total = 0;
  const allForward = [];
  for (const p of prepared) {
    const n = p.close.length;
    // For the target itself, windows may not overlap the query window.
    const lastEnd = p === mainP ? Math.min(n - 1 - horizon, n - length - 1) : n - 1 - horizon;
    for (let e = length - 1; e <= lastEnd; e++) {
      const fwd = p.close[e + horizon] / p.close[e] - 1;
      total++;
      if (fwd > 0) upCount++;
      allForward.push(fwd);
      const d = dtw(query, shapeOf(p.logs, e - length + 1, length), band);
      cands.push({ p, e, dist: Math.sqrt(d / length) });
    }
  }
  if (cands.length < k) throw Object.assign(new Error("Not enough history to find similar patterns"), { status: 422 });
  cands.sort((a, b) => a.dist - b.dist);

  // Greedy top-K, skipping near-duplicates (consecutive days of the same episode).
  const chosen = [];
  for (let rank = 0; rank < cands.length && chosen.length < k; rank++) {
    const c = cands[rank];
    if (chosen.some((m) => m.p === c.p && Math.abs(m.e - c.e) < minGap)) continue;
    chosen.push({ ...c, rank });
  }

  const matches = chosen.map((m) => {
    const base = m.p.close[m.e];
    const path = [];
    for (let h = 1; h <= horizon; h++) path.push(m.p.close[m.e + h] / base - 1);
    return {
      symbol: m.p.symbol,
      start: m.p.candles[m.e - length + 1].time,
      end: m.p.candles[m.e].time,
      distance: m.dist,
      rank: m.rank + 1, // position among all scanned windows, 1 = the most similar of all
      shape: Array.from(shapeOf(m.p.logs, m.e - length + 1, length)),
      forward: path,
      forwardReturn: path[path.length - 1],
      worstPoint: Math.min(0, ...path),
    };
  });

  const fwdSorted = Float64Array.from(matches.map((m) => m.forwardReturn)).sort();
  const up = matches.filter((m) => m.forwardReturn > 0).length;
  const baseRate = upCount / total;
  const pUp = up / matches.length;
  const [lo, hi] = wilson(up, matches.length);
  const z = (pUp - baseRate) / Math.sqrt((baseRate * (1 - baseRate)) / matches.length || 1e-9);
  const allSorted = Float64Array.from(allForward).sort();

  let label = "No clear edge";
  if (z >= 1.64) label = "Leans up";
  else if (z <= -1.64) label = "Leans down";

  return {
    params: { length, horizon, k: matches.length, band },
    scanned: { windows: total, symbols: prepared.length, years: nMain / 252 },
    query: { shape: Array.from(query), start: main.candles[nMain - length].time, end: main.candles[nMain - 1].time },
    matches,
    summary: {
      probUp: pUp,
      up,
      ci: [lo, hi],
      median: percentileSorted(fwdSorted, 0.5),
      mean: mean(fwdSorted),
      p10: percentileSorted(fwdSorted, 0.1),
      p90: percentileSorted(fwdSorted, 0.9),
      worst: fwdSorted[0],
      best: fwdSorted[fwdSorted.length - 1],
      spread: std(fwdSorted),
    },
    baseline: { probUp: baseRate, median: percentileSorted(allSorted, 0.5) },
    verdict: { label, z, edge: pUp - baseRate },
  };
}
