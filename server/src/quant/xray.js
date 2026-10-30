// Portfolio X-Ray: unsupervised learning on the user's own holdings.
//
// Question answered: "How many truly different bets do I own, and where is my risk hiding?"
//
// 1. PCA. Eigen-decomposition of the correlation matrix (Jacobi rotations) splits the portfolio's
//    movements into independent drivers. The "effective number of bets" is exp(entropy) of the
//    eigenvalue shares (Meucci, 2009): 8 stocks that all move together count as about 1 to 2 bets.
// 2. Clustering. Average-linkage hierarchical clustering on distance sqrt(0.5·(1 − ρ)); the number
//    of groups is chosen automatically by the silhouette score. Nobody tells the AI the sectors.
// 3. Risk attribution. Euler decomposition w_i·(Σw)_i / σ²_p says what share of the portfolio's
//    risk each stock (and each cluster) really carries, compared with its share of the money.
// 4. What-if. How much total risk falls if each stock is trimmed by a quarter.
import { covariance, TRADING_DAYS } from "./stats.js";

/** Eigenvalues and eigenvectors of a symmetric matrix by cyclic Jacobi rotations. Sorted high to low. */
export function jacobiEigen(M, sweeps = 60) {
  const n = M.length;
  const A = M.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let s = 0; s < sweeps; s++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s2 = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s2 * akq;
          A[k][q] = s2 * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s2 * aqk;
          A[q][k] = s2 * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s2 * vkq;
          V[k][q] = s2 * vkp + c * vkq;
        }
      }
    }
  }
  const order = A.map((_, i) => i).sort((a, b) => A[b][b] - A[a][a]);
  return { values: order.map((i) => A[i][i]), vectors: order.map((i) => V.map((row) => row[i])) };
}

/** Average-linkage agglomerative clustering. Returns the merge history. */
function linkage(D) {
  const n = D.length;
  let clusters = Array.from({ length: n }, (_, i) => [i]);
  const merges = [];
  const dist = (a, b) => {
    let s = 0;
    for (const i of a) for (const j of b) s += D[i][j];
    return s / (a.length * b.length);
  };
  while (clusters.length > 1) {
    let best = [0, 1, Infinity];
    for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
      const d = dist(clusters[a], clusters[b]);
      if (d < best[2]) best = [a, b, d];
    }
    const [a, b, d] = best;
    const merged = [...clusters[a], ...clusters[b]];
    clusters = clusters.filter((_, i) => i !== a && i !== b);
    clusters.push(merged);
    merges.push({ distance: d, groups: clusters.map((c) => c.slice().sort((x, y) => x - y)) });
  }
  return merges;
}

function silhouette(D, groups) {
  const n = D.length;
  const of = new Array(n);
  groups.forEach((g, k) => g.forEach((i) => { of[i] = k; }));
  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = groups[of[i]];
    if (own.length === 1) continue; // silhouette of a singleton is 0
    const a = own.filter((j) => j !== i).reduce((s, j) => s + D[i][j], 0) / (own.length - 1);
    let b = Infinity;
    groups.forEach((g, k) => { if (k !== of[i]) b = Math.min(b, g.reduce((s, j) => s + D[i][j], 0) / g.length); });
    total += (b - a) / Math.max(a, b);
  }
  return total / n;
}

/**
 * @param {{symbol:string, weight:number, returns:number[]}[]} stocks aligned daily returns and money weights
 */
export function analyseXRay(stocks) {
  const n = stocks.length;
  if (n < 3) throw Object.assign(new Error("Add at least 3 stocks to your portfolio to see how your risk is grouped"), { status: 422 });
  const len = Math.min(...stocks.map((s) => s.returns.length));
  if (len < 60) throw Object.assign(new Error("Not enough shared price history across your stocks"), { status: 422 });
  const R = stocks.map((s) => s.returns.slice(-len));
  const wsum = stocks.reduce((s, x) => s + x.weight, 0);
  const w = stocks.map((s) => s.weight / wsum);

  const cov = R.map((a) => R.map((b) => covariance(a, b) * TRADING_DAYS));
  const vol = cov.map((row, i) => Math.sqrt(row[i]));
  const corr = cov.map((row, i) => row.map((v, j) => v / (vol[i] * vol[j] || 1)));

  // ---- PCA on correlations ----
  const eig = jacobiEigen(corr);
  const total = eig.values.reduce((s, v) => s + Math.max(v, 0), 0);
  const share = eig.values.map((v) => Math.max(v, 0) / total);
  const effectiveBets = Math.exp(-share.reduce((s, p) => s + (p > 1e-12 ? p * Math.log(p) : 0), 0));
  const components = share.slice(0, 3).map((s, k) => ({
    share: s,
    loadings: stocks.map((st, i) => ({ symbol: st.symbol, value: eig.vectors[k][i] * (k === 0 && eig.vectors[0].reduce((a, b) => a + b, 0) < 0 ? -1 : 1) })),
  }));

  // ---- clustering with the silhouette score choosing how many groups ----
  const D = corr.map((row) => row.map((rho) => Math.sqrt(Math.max(0, 0.5 * (1 - rho)))));
  const merges = linkage(D);
  let best = { k: 1, groups: [stocks.map((_, i) => i)], score: 0 };
  for (const m of merges) {
    const k = m.groups.length;
    if (k < 2 || k > Math.min(5, n - 1)) continue;
    const score = silhouette(D, m.groups);
    if (score > best.score + 1e-9) best = { k, groups: m.groups, score };
  }

  // ---- risk attribution ----
  const Sw = cov.map((row) => row.reduce((s, v, j) => s + v * w[j], 0));
  const variance = w.reduce((s, wi, i) => s + wi * Sw[i], 0);
  const risk = Math.sqrt(variance);
  const riskShare = w.map((wi, i) => (wi * Sw[i]) / variance);
  const avgVol = w.reduce((s, wi, i) => s + wi * vol[i], 0);
  const diversificationRatio = avgVol / risk;

  const clusters = best.groups
    .map((g) => ({
      members: g.map((i) => ({ symbol: stocks[i].symbol, weight: w[i], riskShare: riskShare[i], vol: vol[i] })).sort((a, b) => b.weight - a.weight),
      weight: g.reduce((s, i) => s + w[i], 0),
      riskShare: g.reduce((s, i) => s + riskShare[i], 0),
      avgCorrelation: g.length > 1 ? g.flatMap((i) => g.filter((j) => j > i).map((j) => corr[i][j])).reduce((a, b) => a + b, 0) / ((g.length * (g.length - 1)) / 2) : null,
    }))
    .sort((a, b) => b.riskShare - a.riskShare);

  // ---- what if I trim each stock by 25% (money moves proportionally into the rest)? ----
  const volOf = (ww) => Math.sqrt(ww.reduce((s, wi, i) => s + wi * cov[i].reduce((t, v, j) => t + v * ww[j], 0), 0));
  const trims = stocks.map((st, i) => {
    const moved = w[i] * 0.25;
    const rest = 1 - w[i];
    const ww = w.map((wj, j) => (j === i ? wj - moved : wj + (rest > 0 ? (moved * wj) / rest : 0)));
    const after = volOf(ww);
    return { symbol: st.symbol, weight: w[i], riskShare: riskShare[i], riskCut: 1 - after / risk };
  }).sort((a, b) => b.riskCut - a.riskCut);

  // The stock whose risk share most exceeds its money share.
  const holdings = stocks.map((st, i) => ({ symbol: st.symbol, weight: w[i], riskShare: riskShare[i], vol: vol[i], excess: riskShare[i] - w[i] })).sort((a, b) => b.riskShare - a.riskShare);
  const danger = [...holdings].sort((a, b) => b.excess - a.excess)[0];

  const top = clusters[0];
  const grade = effectiveBets / n >= 0.7 ? "Well spread" : effectiveBets / n >= 0.45 ? "Partly concentrated" : "Concentrated";
  const plain = `You hold ${n} stocks but the maths sees only about ${effectiveBets.toFixed(1)} independent bets. ${best.k > 1 && best.score < 0.1 ? `The groups are weak (your stocks mostly move on their own), but the most risk sits in ${top.members.map((m) => m.symbol.replace(/\.(NS|BO)$/, "")).join(", ")}: ${(top.riskShare * 100).toFixed(0)}% of risk on ${(top.weight * 100).toFixed(0)}% of your money.` : best.k > 1 ? `The AI grouped them into ${best.k} clusters; the biggest risk sits in ${top.members.map((m) => m.symbol.replace(/\.(NS|BO)$/, "")).join(", ")}, which carries ${(top.riskShare * 100).toFixed(0)}% of your risk on ${(top.weight * 100).toFixed(0)}% of your money.` : "They move so much alike that they form one group."}`;

  return {
    n,
    observations: len,
    effectiveBets,
    grade,
    risk: { annualVol: risk, averageStockVol: avgVol, diversificationRatio },
    components,
    pc1Share: share[0],
    clusters: { k: best.k, silhouette: best.score, groups: clusters },
    holdings,
    danger: danger.excess > 0.02 ? danger : null,
    trims,
    correlation: { symbols: stocks.map((s) => s.symbol), matrix: corr },
    plain,
  };
}
