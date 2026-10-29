import { sma, ema, rsi, macd, bollinger, stochastic } from "./indicators.js";
import { simpleReturns, maxDrawdown, sharpeRatio, cagr } from "./risk.js";

/**
 * Rule-based long-only backtester.
 *
 * Strategy shape:
 * {
 *   entry: [ condition, ... ]   // all must be true to buy
 *   exit:  [ condition, ... ]   // any true sells
 *   stopLoss?: 0.08, takeProfit?: 0.2, feeBps?: 5
 * }
 * condition = { left: Operand, op: "crossesAbove"|"crossesBelow"|">"|"<", right: Operand | number }
 * Operand   = { ind: "price"|"sma"|"ema"|"rsi"|"macd"|"macdSignal"|"macdHist"|"bbUpper"|"bbMiddle"|"bbLower"|"stochK"|"stochD", period?: number }
 *
 * Signals are evaluated on the close of bar t and filled at the open of bar t+1,
 * so the test never trades on information it could not have had.
 */

export const INDICATORS = ["price", "sma", "ema", "rsi", "macd", "macdSignal", "macdHist", "bbUpper", "bbMiddle", "bbLower", "stochK", "stochD"];
const OPS = ["crossesAbove", "crossesBelow", ">", "<"];

export const PRESETS = {
  goldenCross: {
    name: "Golden cross (50/200 SMA)",
    entry: [{ left: { ind: "sma", period: 50 }, op: "crossesAbove", right: { ind: "sma", period: 200 } }],
    exit: [{ left: { ind: "sma", period: 50 }, op: "crossesBelow", right: { ind: "sma", period: 200 } }],
  },
  rsiReversion: {
    name: "RSI mean reversion (30/70)",
    entry: [{ left: { ind: "rsi", period: 14 }, op: "crossesAbove", right: 30 }],
    exit: [{ left: { ind: "rsi", period: 14 }, op: "crossesAbove", right: 70 }],
  },
  macdCross: {
    name: "MACD signal cross",
    entry: [{ left: { ind: "macd" }, op: "crossesAbove", right: { ind: "macdSignal" } }],
    exit: [{ left: { ind: "macd" }, op: "crossesBelow", right: { ind: "macdSignal" } }],
  },
  bollingerBounce: {
    name: "Bollinger band bounce",
    entry: [{ left: { ind: "price" }, op: "crossesAbove", right: { ind: "bbLower", period: 20 } }],
    exit: [{ left: { ind: "price" }, op: "crossesAbove", right: { ind: "bbMiddle", period: 20 } }],
  },
};

export function validateStrategy(s) {
  const errors = [];
  const checkOperand = (o, where) => {
    if (typeof o === "number") return;
    if (!o || !INDICATORS.includes(o.ind)) errors.push(`${where}: unknown indicator`);
    if (o?.period !== undefined && !(Number.isInteger(o.period) && o.period >= 2 && o.period <= 400)) {
      errors.push(`${where}: period must be an integer between 2 and 400`);
    }
  };
  for (const side of ["entry", "exit"]) {
    if (!Array.isArray(s?.[side]) || s[side].length === 0 || s[side].length > 5) {
      errors.push(`${side}: provide 1 to 5 conditions`);
      continue;
    }
    s[side].forEach((c, i) => {
      if (!OPS.includes(c.op)) errors.push(`${side}[${i}]: unknown operator`);
      if (typeof c.left === "number") errors.push(`${side}[${i}]: left side must be an indicator`);
      checkOperand(c.left, `${side}[${i}].left`);
      checkOperand(c.right, `${side}[${i}].right`);
    });
  }
  for (const k of ["stopLoss", "takeProfit"]) {
    if (s?.[k] != null && !(s[k] > 0 && s[k] < 1)) errors.push(`${k} must be between 0 and 1`);
  }
  return errors;
}

/** Computes each distinct operand series once and memoises it. */
function seriesResolver(candles) {
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const cache = new Map();
  return (op) => {
    if (typeof op === "number") return null;
    const key = `${op.ind}:${op.period ?? ""}`;
    if (cache.has(key)) return cache.get(key);
    const p = op.period;
    let s;
    switch (op.ind) {
      case "price": s = close; break;
      case "sma": s = sma(close, p ?? 20); break;
      case "ema": s = ema(close, p ?? 20); break;
      case "rsi": s = rsi(close, p ?? 14); break;
      case "macd": s = macd(close).macd; break;
      case "macdSignal": s = macd(close).signal; break;
      case "macdHist": s = macd(close).histogram; break;
      case "bbUpper": s = bollinger(close, p ?? 20).upper; break;
      case "bbMiddle": s = bollinger(close, p ?? 20).middle; break;
      case "bbLower": s = bollinger(close, p ?? 20).lower; break;
      case "stochK": s = stochastic(high, low, close, p ?? 14).k; break;
      case "stochD": s = stochastic(high, low, close, p ?? 14).d; break;
      default: throw new Error(`Unknown indicator ${op.ind}`);
    }
    cache.set(key, s);
    return s;
  };
}

function evaluate(cond, i, resolve) {
  const L = resolve(cond.left);
  const R = typeof cond.right === "number" ? null : resolve(cond.right);
  const at = (series, j) => (series ? series[j] : cond.right);
  const l1 = L[i];
  const r1 = at(R, i);
  if (l1 == null || r1 == null) return false;
  if (cond.op === ">") return l1 > r1;
  if (cond.op === "<") return l1 < r1;
  if (i === 0) return false;
  const l0 = L[i - 1];
  const r0 = at(R, i - 1);
  if (l0 == null || r0 == null) return false;
  if (cond.op === "crossesAbove") return l0 <= r0 && l1 > r1;
  if (cond.op === "crossesBelow") return l0 >= r0 && l1 < r1;
  return false;
}

export function runBacktest(candles, strategy, { initialCapital = 10000, riskFree = 0.04 } = {}) {
  const errors = validateStrategy(strategy);
  if (errors.length) {
    const e = new Error(errors.join("; "));
    e.status = 400;
    throw e;
  }
  const feeRate = (strategy.feeBps ?? 5) / 10000;
  const resolve = seriesResolver(candles);
  const n = candles.length;

  let cash = initialCapital;
  let shares = 0;
  let entryPrice = 0;
  let entryTime = null;
  let pending = null; // "buy" | "sell" decided at close, filled next open
  let barsInMarket = 0;
  const trades = [];
  const equity = new Array(n);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const fillPrice = c.open ?? c.close;

    if (pending === "buy" && shares === 0) {
      shares = (cash * (1 - feeRate)) / fillPrice;
      cash = 0;
      entryPrice = fillPrice;
      entryTime = c.time;
    } else if (pending === "sell" && shares > 0) {
      cash = shares * fillPrice * (1 - feeRate);
      trades.push(closeTrade(entryTime, entryPrice, c.time, fillPrice, "exit signal"));
      shares = 0;
    }
    pending = null;

    if (shares > 0) barsInMarket++;

    // Intraday protective exits use the bar's low/high.
    if (shares > 0 && strategy.stopLoss && c.low <= entryPrice * (1 - strategy.stopLoss)) {
      const px = Math.min(fillPrice, entryPrice * (1 - strategy.stopLoss));
      cash = shares * px * (1 - feeRate);
      trades.push(closeTrade(entryTime, entryPrice, c.time, px, "stop loss"));
      shares = 0;
    } else if (shares > 0 && strategy.takeProfit && c.high >= entryPrice * (1 + strategy.takeProfit)) {
      const px = Math.max(fillPrice, entryPrice * (1 + strategy.takeProfit));
      cash = shares * px * (1 - feeRate);
      trades.push(closeTrade(entryTime, entryPrice, c.time, px, "take profit"));
      shares = 0;
    }

    equity[i] = cash + shares * c.close;

    if (i < n - 1) {
      if (shares === 0 && strategy.entry.every((cond) => evaluate(cond, i, resolve))) pending = "buy";
      else if (shares > 0 && strategy.exit.some((cond) => evaluate(cond, i, resolve))) pending = "sell";
    }
  }

  const open = shares > 0 ? { entryTime, entryPrice, markPrice: candles[n - 1].close, returnPct: candles[n - 1].close / entryPrice - 1 } : null;
  const buyHold = candles.map((c) => (initialCapital * c.close) / candles[0].close);

  return {
    initialCapital,
    curve: candles.map((c, i) => ({ time: c.time, strategy: equity[i], buyHold: buyHold[i] })),
    trades,
    openPosition: open,
    stats: {
      strategy: summarise(equity, riskFree),
      buyHold: summarise(buyHold, riskFree),
      trades: trades.length,
      winRate: trades.length ? trades.filter((t) => t.returnPct > 0).length / trades.length : null,
      avgTrade: trades.length ? trades.reduce((s, t) => s + t.returnPct, 0) / trades.length : null,
      exposure: barsInMarket / n,
    },
  };
}

function closeTrade(entryTime, entryPrice, exitTime, exitPrice, reason) {
  return { entryTime, entryPrice, exitTime, exitPrice, returnPct: exitPrice / entryPrice - 1, reason };
}

function summarise(values, riskFree) {
  const r = simpleReturns(values);
  return {
    totalReturn: values[values.length - 1] / values[0] - 1,
    cagr: cagr(values[0], values[values.length - 1], values.length - 1),
    sharpe: sharpeRatio(r, riskFree),
    maxDrawdown: maxDrawdown(values).maxDrawdown,
    finalValue: values[values.length - 1],
  };
}
