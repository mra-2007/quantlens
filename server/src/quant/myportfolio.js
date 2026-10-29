// Analysis of a user's real holdings, and the "what if I invest more?" simulator.
// Holdings keep a constant number of shares, so the portfolio's value on day t is
//   V(t) = Σ qᵢ · Pᵢ(t) · FXᵢ(t)
// where FX converts each stock's currency to the portfolio's base currency.
import { alignCloses, simpleReturns, volatility, sharpeRatio, sortinoRatio, maxDrawdown, valueAtRisk, betaVsIndex, cagr } from "./risk.js";
import { correlationMatrix } from "./portfolio.js";
import { monteCarlo } from "./forecast.js";

/**
 * @param {object} p
 * @param {{symbol:string, quantity:number, avgPrice:number}[]} p.holdings
 * @param {Record<string, {candles:any[], currency:string, name?:string}>} p.histories  every holding + the added stock
 * @param {string} p.base             base currency of the portfolio ("INR" or "USD")
 * @param {any[]|null} p.fxCandles    USD→INR daily candles when stocks of both currencies are mixed
 * @param {any[]|null} p.indexCandles benchmark index candles (for beta)
 * @param {{symbol:string, amount:number}|null} p.add  money to add (in base currency)
 */
export function analyzeMyPortfolio({ holdings, histories, base, fxCandles = null, indexCandles = null, add = null, days = 126, paths = 1000, riskFree = 0.04, seed = 11 }) {
  const symbols = [...new Set([...holdings.map((h) => h.symbol), ...(add ? [add.symbol] : [])])];
  const needsFx = symbols.some((s) => histories[s].currency !== base);

  const seriesMap = Object.fromEntries(symbols.map((s) => [s, histories[s].candles]));
  if (needsFx) {
    if (!fxCandles?.length) throw Object.assign(new Error("Currency conversion data is unavailable"), { status: 502 });
    seriesMap.__FX__ = fxCandles;
  }
  if (indexCandles?.length) seriesMap.__INDEX__ = indexCandles;
  const { dates, closes } = alignCloses(seriesMap);
  if (dates.length < 30) throw Object.assign(new Error("Not enough shared trading days between these stocks"), { status: 422 });
  const n = dates.length;

  // Conversion factor into the base currency for one share of a symbol on day t.
  const fxOf = (s, t) => {
    const cur = histories[s].currency;
    if (cur === base) return 1;
    const usdinr = closes.__FX__[t];
    if (cur === "USD" && base === "INR") return usdinr;
    if (cur === "INR" && base === "USD") return 1 / usdinr;
    return 1;
  };
  const priceIn = (s, t) => closes[s][t] * fxOf(s, t);

  const valueSeries = (qtyBySymbol) => {
    const v = new Array(n).fill(0);
    for (const [s, q] of Object.entries(qtyBySymbol)) for (let t = 0; t < n; t++) v[t] += q * priceIn(s, t);
    return v;
  };

  // ---------- today: positions and P&L ----------
  const last = n - 1;
  const qty = Object.fromEntries(holdings.map((h) => [h.symbol, h.quantity]));
  const value = holdings.length ? valueSeries(qty) : new Array(n).fill(0);
  const total = value[last];
  const positions = holdings.map((h) => {
    const px = priceIn(h.symbol, last);
    const v = h.quantity * px;
    const cost = h.quantity * h.avgPrice * fxOf(h.symbol, last);
    const dayChange = h.quantity * (px - priceIn(h.symbol, last - 1));
    return {
      symbol: h.symbol,
      name: histories[h.symbol].name ?? h.symbol,
      currency: histories[h.symbol].currency,
      quantity: h.quantity,
      avgPrice: h.avgPrice,
      price: closes[h.symbol][last],
      value: v,
      cost,
      pnl: v - cost,
      pnlPct: cost > 0 ? v / cost - 1 : null,
      dayChange,
      weight: total > 0 ? v / total : 0,
    };
  }).sort((a, b) => b.value - a.value);

  const totalCost = positions.reduce((s, p) => s + p.cost, 0);
  const summary = {
    value: total,
    cost: totalCost,
    pnl: total - totalCost,
    pnlPct: totalCost > 0 ? total / totalCost - 1 : null,
    dayChange: holdings.length ? value[last] - value[last - 1] : 0,
    dayChangePct: holdings.length && value[last - 1] > 0 ? value[last] / value[last - 1] - 1 : 0,
    asOf: dates[last],
    holdings: positions.length,
  };

  const indexReturns = closes.__INDEX__ ? simpleReturns(closes.__INDEX__) : null;
  const riskOf = (series, weights) => {
    const r = simpleReturns(series);
    const dd = maxDrawdown(series);
    const v95 = valueAtRisk(r, 0.95);
    const sumSq = weights.reduce((s, w) => s + w * w, 0);
    return {
      annualVol: volatility(r).annual,
      sharpe: sharpeRatio(r, riskFree),
      sortino: sortinoRatio(r, riskFree),
      maxDrawdown: dd.maxDrawdown,
      drawdownFrom: dates[dd.peakIndex],
      drawdownTo: dates[dd.troughIndex],
      var95: v95.historical,
      var95Money: v95.historical * series[last],
      beta: indexReturns ? betaVsIndex(r, indexReturns, riskFree).beta : null,
      totalReturn: series[last] / series[0] - 1,
      cagr: cagr(series[0], series[last], n - 1),
      topWeight: weights.length ? Math.max(...weights) : null,
      effectiveHoldings: sumSq > 0 ? 1 / sumSq : 0, // 1 / Σw²: how many equal-sized stocks it behaves like
    };
  };

  // Down-sample long series for charts (≈260 points is plenty).
  const step = Math.max(1, Math.floor(n / 260));
  const keep = (i) => i % step === 0 || i === last;

  const result = {
    base,
    converted: needsFx,
    fxRate: needsFx ? closes.__FX__[last] : null,
    dates: { from: dates[0], to: dates[last], sessions: n },
    summary,
    positions,
  };

  if (holdings.length) {
    result.risk = riskOf(value, positions.map((p) => p.weight));
    result.trend = dates.map((t, i) => ({ time: t, value: value[i] })).filter((_, i) => keep(i));
    result.correlation = holdings.length >= 2
      ? correlationMatrix(Object.fromEntries(holdings.map((h) => [h.symbol, simpleReturns(closes[h.symbol])])))
      : null;
    result.forecast = summariseMc(monteCarlo(value, { days, paths, seed }), value);
  }

  // ---------- what if I add money? ----------
  if (add) {
    const pxNow = priceIn(add.symbol, last);
    const addShares = add.amount / pxNow;
    const qtyAfter = { ...qty, [add.symbol]: (qty[add.symbol] ?? 0) + addShares };
    const after = valueSeries(qtyAfter);
    const totalAfter = after[last];
    const weightsAfter = Object.entries(qtyAfter).map(([s, q]) => (q * priceIn(s, last)) / totalAfter);
    const alone = dates.map((_, t) => addShares * priceIn(add.symbol, t));

    // Correlation of the new stock with the existing portfolio: low = better diversification.
    let corrWithPortfolio = null;
    if (holdings.length && !(holdings.length === 1 && holdings[0].symbol === add.symbol)) {
      const a = simpleReturns(closes[add.symbol]);
      const p = simpleReturns(value);
      corrWithPortfolio = correlationMatrix({ a, p }).matrix[0][1];
    }

    result.whatIf = {
      symbol: add.symbol,
      name: histories[add.symbol].name ?? add.symbol,
      amount: add.amount,
      shares: addShares,
      price: closes[add.symbol][last],
      currency: histories[add.symbol].currency,
      priceInBase: pxNow,
      newWeight: (addShares * pxNow + (qty[add.symbol] ?? 0) * pxNow) / totalAfter,
      corrWithPortfolio,
      after: {
        value: totalAfter,
        risk: riskOf(after, weightsAfter),
        forecast: summariseMc(monteCarlo(after, { days, paths, seed }), after),
      },
      alone: {
        risk: riskOf(alone, [1]),
        forecast: summariseMc(monteCarlo(alone, { days, paths, seed }), alone),
      },
    };
  }

  return result;
}

/** Keeps what the UI needs from a Monte Carlo run: bands, a few paths and the ending distribution. */
function summariseMc(mc, history) {
  const s0 = mc.s0;
  const t = mc.terminal;
  return {
    days: mc.days,
    paths: mc.paths,
    start: s0,
    bands: mc.bands,
    samplePaths: mc.samplePaths.slice(0, 12),
    history: history.slice(-60).map((v) => ({ close: v })),
    median: t.p50,
    p5: t.p5,
    p95: t.p95,
    mean: t.mean,
    probProfit: t.probAbove,
    probLoss10: t.probLoss10,
  };
}
