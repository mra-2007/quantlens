// Technical indicators. Every function is a single pass over the series (O(n))
// using rolling sums, running EMAs or a monotonic deque. Outputs are aligned to
// the input: index i holds the value at bar i, or null during warm-up.

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Simple moving average via a rolling sum. */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` points.
 *  Leading nulls in the input are skipped (needed when chaining, e.g. MACD signal). */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let start = values.findIndex(isNum);
  if (start < 0 || values.length - start < period) return out;
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += values[i];
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** MACD line, signal line and histogram. */
export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const line = values.map((_, i) => (isNum(ef[i]) && isNum(es[i]) ? ef[i] - es[i] : null));
  const signal = ema(line, signalPeriod);
  const histogram = line.map((v, i) => (isNum(v) && isNum(signal[i]) ? v - signal[i] : null));
  return { macd: line, signal, histogram };
}

/** Bollinger Bands: rolling mean ± k·σ, with σ from rolling sum and sum of squares. */
export function bollinger(values, period = 20, k = 2) {
  const n = values.length;
  const middle = new Array(n).fill(null);
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    sumSq += values[i] * values[i];
    if (i >= period) {
      sum -= values[i - period];
      sumSq -= values[i - period] * values[i - period];
    }
    if (i >= period - 1) {
      const mean = sum / period;
      const variance = Math.max(sumSq / period - mean * mean, 0);
      const sd = Math.sqrt(variance);
      middle[i] = mean;
      upper[i] = mean + k * sd;
      lower[i] = mean - k * sd;
    }
  }
  return { middle, upper, lower };
}

/** Relative Strength Index with Wilder's smoothing. */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const toRsi = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = toRsi();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = toRsi();
  }
  return out;
}

/** Rolling max / min in O(n) using monotonic deques. */
export function rollingExtrema(values, period) {
  const max = new Array(values.length).fill(null);
  const min = new Array(values.length).fill(null);
  const dMax = [];
  const dMin = [];
  for (let i = 0; i < values.length; i++) {
    while (dMax.length && values[dMax[dMax.length - 1]] <= values[i]) dMax.pop();
    while (dMin.length && values[dMin[dMin.length - 1]] >= values[i]) dMin.pop();
    dMax.push(i);
    dMin.push(i);
    if (dMax[0] <= i - period) dMax.shift();
    if (dMin[0] <= i - period) dMin.shift();
    if (i >= period - 1) {
      max[i] = values[dMax[0]];
      min[i] = values[dMin[0]];
    }
  }
  return { max, min };
}

/** Stochastic oscillator %K (with optional smoothing) and %D. */
export function stochastic(high, low, close, period = 14, smoothK = 3, smoothD = 3) {
  const { max } = rollingExtrema(high, period);
  const { min } = rollingExtrema(low, period);
  const rawK = close.map((c, i) => {
    if (!isNum(max[i])) return null;
    const range = max[i] - min[i];
    return range === 0 ? 50 : ((c - min[i]) / range) * 100;
  });
  const k = smoothK > 1 ? smaSkipNull(rawK, smoothK) : rawK;
  const d = smaSkipNull(k, smoothD);
  return { k, d };
}

/** SMA that starts after the leading nulls of a derived series. */
export function smaSkipNull(values, period) {
  const start = values.findIndex(isNum);
  const out = new Array(values.length).fill(null);
  if (start < 0) return out;
  const tail = sma(values.slice(start), period);
  for (let i = 0; i < tail.length; i++) out[start + i] = tail[i];
  return out;
}

/** Ordinary least squares on (index, value). Returns slope, intercept, R² and the fitted line. */
export function linearRegression(values) {
  const n = values.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i];
    sx += i; sy += y; sxy += i * y; sxx += i * i; syy += y * y;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  let ssRes = 0;
  const line = new Array(n);
  for (let i = 0; i < n; i++) {
    line[i] = intercept + slope * i;
    ssRes += (values[i] - line[i]) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const residualSd = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
  return { slope, intercept, r2, residualSd, line, predict: (x) => intercept + slope * x };
}
