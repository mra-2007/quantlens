// Neural Forecaster: a small neural network, written from scratch, with an honest report card.
//
// What it learns: from ten facts about a stock on day t (recent returns, volatility, RSI, distance
// from the 50-day average, volume surge, position in the 20-day range) it outputs the probability
// that the price is higher 5 trading days later. One hidden layer of tanh units, a logistic
// output, binary cross-entropy loss, L2 weight decay and the Adam optimiser. Three nets with
// different random starts are averaged (a tiny ensemble) because single small nets are jumpy.
//
// The important part is the test. Walk-forward validation: the model is trained ONLY on days
// before a cut-off, predicts the next 63 days it has never seen, then the window slides forward
// and it is retrained. Every prediction scored here was made without knowing the future. The
// result is compared with the best "dumb" guess (always say the commoner direction), with a
// Brier score, a calibration table and a simple follow-the-model strategy versus buy and hold.
// If the network is no better than guessing, the report card says so.
import { mean, std, rng, normalSampler } from "./stats.js";
import { wilson } from "./twins.js";

export const FEATURES = [
  { key: "ret1", label: "Yesterday’s move" },
  { key: "ret5", label: "5-day move" },
  { key: "ret10", label: "10-day move" },
  { key: "ret21", label: "1-month move" },
  { key: "vol10", label: "Short-term volatility" },
  { key: "vol21", label: "1-month volatility" },
  { key: "rsi", label: "RSI (overbought / oversold)" },
  { key: "ma50", label: "Distance from 50-day average" },
  { key: "volume", label: "Volume surge" },
  { key: "range", label: "Position in 20-day range" },
];
const WARMUP = 50;

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// ---------- the network ----------
/** Trains a 1-hidden-layer net with full-batch Adam. X: array of Float64Array rows, y: 0/1. */
export function trainNet(X, y, { hidden = 8, epochs = 100, lr = 0.02, l2 = 1e-3, seed = 1 } = {}) {
  const d = X[0].length;
  const n = X.length;
  const z = normalSampler(rng(seed));
  const W1 = Float64Array.from({ length: hidden * d }, () => z() * Math.sqrt(1 / d));
  const b1 = new Float64Array(hidden);
  const W2 = Float64Array.from({ length: hidden }, () => z() * Math.sqrt(1 / hidden));
  let b2 = 0;

  const params = [W1, b1, W2];
  const m = params.map((p) => new Float64Array(p.length));
  const v = params.map((p) => new Float64Array(p.length));
  let mb = 0;
  let vb = 0;
  const g = params.map((p) => new Float64Array(p.length));
  const H = new Float64Array(hidden);

  for (let ep = 1; ep <= epochs; ep++) {
    g.forEach((a) => a.fill(0));
    let gb2 = 0;
    for (let s = 0; s < n; s++) {
      const x = X[s];
      let out = b2;
      for (let j = 0; j < hidden; j++) {
        let a = b1[j];
        for (let k = 0; k < d; k++) a += W1[j * d + k] * x[k];
        H[j] = Math.tanh(a);
        out += W2[j] * H[j];
      }
      const dOut = sigmoid(out) - y[s]; // d(BCE)/d(logit)
      gb2 += dOut;
      for (let j = 0; j < hidden; j++) {
        g[2][j] += dOut * H[j];
        const dA = dOut * W2[j] * (1 - H[j] * H[j]);
        g[1][j] += dA;
        for (let k = 0; k < d; k++) g[0][j * d + k] += dA * x[k];
      }
    }
    const b1c = 1 - 0.9 ** ep;
    const b2c = 1 - 0.999 ** ep;
    params.forEach((p, i) => {
      for (let q = 0; q < p.length; q++) {
        const grad = g[i][q] / n + (i === 1 ? 0 : l2 * p[q]);
        m[i][q] = 0.9 * m[i][q] + 0.1 * grad;
        v[i][q] = 0.999 * v[i][q] + 0.001 * grad * grad;
        p[q] -= (lr * (m[i][q] / b1c)) / (Math.sqrt(v[i][q] / b2c) + 1e-8);
      }
    });
    const gb = gb2 / n;
    mb = 0.9 * mb + 0.1 * gb;
    vb = 0.999 * vb + 0.001 * gb * gb;
    b2 -= (lr * (mb / b1c)) / (Math.sqrt(vb / b2c) + 1e-8);
  }
  return {
    predict(x) {
      let out = b2;
      for (let j = 0; j < hidden; j++) {
        let a = b1[j];
        for (let k = 0; k < d; k++) a += W1[j * d + k] * x[k];
        out += W2[j] * Math.tanh(a);
      }
      return sigmoid(out);
    },
  };
}

function fitEnsemble(rows, labels, { nets = 3, seed = 1, ...opt } = {}) {
  const mu = FEATURES.map((_, f) => mean(rows.map((r) => r[f])));
  const sd = FEATURES.map((_, f) => std(rows.map((r) => r[f])) || 1);
  const scale = (r) => Float64Array.from(r, (v, f) => Math.max(-4, Math.min(4, (v - mu[f]) / sd[f])));
  const X = rows.map(scale);
  const members = Array.from({ length: nets }, (_, k) => trainNet(X, labels, { ...opt, seed: seed * 101 + k * 17 + 3 }));
  return { predict: (r) => { const x = scale(r); return members.reduce((s, net) => s + net.predict(x), 0) / members.length; } };
}

// ---------- features ----------
function buildDataset(candles, horizon) {
  const n = candles.length;
  const close = candles.map((c) => c.close);
  const r = close.map((c, i) => (i ? c / close[i - 1] - 1 : 0));
  const rows = [];
  const day = [];
  const label = [];
  for (let t = WARMUP; t < n; t++) {
    let gain = 0;
    let loss = 0;
    for (let i = t - 13; i <= t; i++) { if (r[i] > 0) gain += r[i]; else loss -= r[i]; }
    const rsi = gain + loss === 0 ? 0.5 : gain / (gain + loss);
    const ma50 = mean(close.slice(t - 49, t + 1));
    const win = close.slice(t - 19, t + 1);
    const lo = Math.min(...win);
    const hi = Math.max(...win);
    const avgVol = mean(candles.slice(t - 20, t).map((c) => c.volume ?? 0));
    rows.push([
      r[t],
      close[t] / close[t - 5] - 1,
      close[t] / close[t - 10] - 1,
      close[t] / close[t - 21] - 1,
      std(r.slice(t - 9, t + 1)),
      std(r.slice(t - 20, t + 1)),
      rsi - 0.5,
      close[t] / ma50 - 1,
      Math.log(((candles[t].volume ?? 0) + 1) / (avgVol + 1)),
      hi > lo ? (close[t] - lo) / (hi - lo) - 0.5 : 0,
    ]);
    day.push(t);
    label.push(t + horizon < n ? (close[t + horizon] > close[t] ? 1 : 0) : null);
  }
  return { rows, day, label, r };
}

const maxDrawdown = (curve) => {
  let peak = -Infinity;
  let dd = 0;
  for (const v of curve) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
  return dd;
};
const sharpe = (rets) => (std(rets) > 0 ? (mean(rets) / std(rets)) * Math.sqrt(252) : 0);

/**
 * @param {any[]} candles daily OHLCV, oldest first
 * @param {object} o
 * @param {number} o.horizon days ahead being predicted (default 5)
 * @param {number} o.step    days per walk-forward test window (default 63, one quarter)
 */
export function analyseNeural(candles, { horizon = 5, step = 63, nets = 3, epochs = 40, l2 = 0.03, seed = 5, feeBps = 10 } = {}) {
  if (candles.length < 600) throw Object.assign(new Error("Need about 2.5 years of prices to train and fairly test a neural network"), { status: 422 });
  const { rows, day, label, r } = buildDataset(candles, horizon);
  const N = rows.length;
  const first = Math.max(250, Math.floor(N * 0.45));

  // ---- walk-forward: train on the past only, predict the next window ----
  const preds = new Array(N).fill(null);
  const folds = [];
  for (let start = first; start < N; start += step) {
    const end = Math.min(N, start + step);
    const trainIdx = [];
    for (let i = 0; i < start - horizon; i++) if (label[i] != null) trainIdx.push(i); // gap = no peeking at the labels' future
    const model = fitEnsemble(trainIdx.map((i) => rows[i]), trainIdx.map((i) => label[i]), { nets, epochs, l2, seed: seed + folds.length });
    for (let i = start; i < end; i++) preds[i] = model.predict(rows[i]);
    folds.push({ start, end, model });
  }

  // ---- scoring (only days whose outcome is already known) ----
  const scored = [];
  for (let i = first; i < N; i++) if (label[i] != null) scored.push(i);
  const n = scored.length;
  const hits = scored.filter((i) => (preds[i] > 0.5) === (label[i] === 1)).length;
  const accuracy = hits / n;
  const upShare = scored.filter((i) => label[i] === 1).length / n;
  const naive = Math.max(upShare, 1 - upShare);
  const effN = Math.max(1, n / horizon); // 5-day outcomes overlap, so there are really ~n/5 independent tests
  const z = (accuracy - naive) / Math.sqrt((naive * (1 - naive)) / effN || 1e-9);
  const [lo, hi] = wilson(Math.round(accuracy * effN), Math.round(effN));
  const brier = mean(scored.map((i) => (preds[i] - label[i]) ** 2));
  const brierNaive = upShare * (1 - upShare);
  const skill = 1 - brier / brierNaive;

  // ---- calibration: when it said X%, how often did the stock really rise? ----
  const edges = [0, 0.4, 0.45, 0.5, 0.55, 0.6, 1.0001];
  const calibration = edges.slice(0, -1).map((a, b) => {
    const idx = scored.filter((i) => preds[i] >= a && preds[i] < edges[b + 1]);
    return { from: a, to: Math.min(1, edges[b + 1]), n: idx.length, predicted: idx.length ? mean(idx.map((i) => preds[i])) : null, actual: idx.length ? mean(idx.map((i) => label[i])) : null };
  });

  // ---- follow-the-model strategy vs buy and hold on the same unseen days ----
  const model = [];
  const hold = [];
  const times = [];
  let eq = 1;
  let bh = 1;
  let prevPos = 0;
  let exposure = 0;
  const modelCurve = [{ time: candles[day[first]].time, model: 1, hold: 1 }];
  for (let i = first; i < N - 1; i++) {
    const t1 = day[i] + 1; // the position set at the close of day i earns day i+1
    const pos = preds[i] > 0.5 ? 1 : 0;
    const cost = pos !== prevPos ? feeBps / 1e4 : 0;
    const ret = pos * r[t1] - cost;
    model.push(ret);
    hold.push(r[t1]);
    exposure += pos;
    prevPos = pos;
    eq *= 1 + ret;
    bh *= 1 + r[t1];
    modelCurve.push({ time: candles[t1].time, model: eq, hold: bh });
    times.push(candles[t1].time);
  }
  const strategy = {
    days: model.length,
    model: { total: eq - 1, sharpe: sharpe(model), maxDD: maxDrawdown(modelCurve.map((p) => p.model)) },
    hold: { total: bh - 1, sharpe: sharpe(hold), maxDD: maxDrawdown(modelCurve.map((p) => p.hold)) },
    exposure: exposure / model.length,
    feeBps,
  };
  const step2 = Math.max(1, Math.floor(modelCurve.length / 220));
  const curve = modelCurve.filter((_, i) => i % step2 === 0 || i === modelCurve.length - 1);

  // ---- which inputs mattered: shuffle one input on the unseen days and see how much accuracy drops ----
  const u = rng(seed + 99);
  const importance = FEATURES.map((f, fi) => {
    let hitsPerm = 0;
    let count = 0;
    for (const fold of folds) {
      const idx = scored.filter((i) => i >= fold.start && i < fold.end);
      const col = idx.map((i) => rows[i][fi]);
      for (let k = col.length - 1; k > 0; k--) { const j = Math.floor(u() * (k + 1)); [col[k], col[j]] = [col[j], col[k]]; }
      idx.forEach((i, k) => {
        const x = rows[i].slice();
        x[fi] = col[k];
        if ((fold.model.predict(x) > 0.5) === (label[i] === 1)) hitsPerm++;
        count++;
      });
    }
    return { key: f.key, label: f.label, drop: accuracy - hitsPerm / count };
  }).sort((a, b) => b.drop - a.drop);

  // ---- the model trained on everything, asked about today ----
  const trainAll = [];
  for (let i = 0; i < N; i++) if (label[i] != null) trainAll.push(i);
  const finalModel = fitEnsemble(trainAll.map((i) => rows[i]), trainAll.map((i) => label[i]), { nets, epochs, l2, seed: seed + 777 });
  const p = finalModel.predict(rows[N - 1]);

  let label2 = "No clear edge";
  let tone = "";
  if (z >= 1.64 && skill > 0) { label2 = "Some predictive signal"; tone = "up"; }
  else if (z <= -1.64) { label2 = "Worse than guessing"; tone = "down"; }

  const lean = Math.abs(p - 0.5) < 0.03 ? "Neutral" : p > 0.5 ? "Leans up" : "Leans down";
  const text = label2 === "Some predictive signal"
    ? `On days it had never seen, the network called the direction right ${(accuracy * 100).toFixed(0)}% of the time versus ${(naive * 100).toFixed(0)}% for always guessing the commoner direction. That is better than chance, though modest and not guaranteed to last.`
    : label2 === "Worse than guessing"
      ? `On unseen days it scored ${(accuracy * 100).toFixed(0)}%, below the ${(naive * 100).toFixed(0)}% of a lazy guess. Do not rely on its call for this stock.`
      : `On unseen days it scored ${(accuracy * 100).toFixed(0)}% against ${(naive * 100).toFixed(0)}% for a lazy guess, which is not a real difference. For this stock the network found no dependable pattern, so treat today's call as a coin flip.`;

  return {
    params: { horizon, step, nets, hidden: 8, epochs, inputs: FEATURES.length, folds: folds.length, trainStart: candles[day[0]].time, firstTest: candles[day[first]].time, trained: N, tested: n },
    today: { probUp: p, lean, time: candles[day[N - 1]].time, trusted: label2 === "Some predictive signal", inputs: FEATURES.map((f, i) => ({ key: f.key, label: f.label, value: rows[N - 1][i] })) },
    card: {
      accuracy, naive, upShare, ci: [lo, hi], z, effectiveTests: effN, n,
      brier, brierNaive, skill,
    },
    calibration,
    strategy,
    curve,
    importance,
    verdict: { label: label2, tone, text, lean },
  };
}
