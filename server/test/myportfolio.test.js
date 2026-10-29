import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMyPortfolio } from "../src/quant/myportfolio.js";
import { syntheticCandles } from "../src/lib/demoData.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const hist = (symbol, currency = "INR") => ({ candles: syntheticCandles(symbol, 300), currency, name: symbol });

test("Value, cost and P&L add up across holdings", () => {
  const histories = { "TCS.NS": hist("TCS.NS"), "INFY.NS": hist("INFY.NS") };
  const holdings = [{ symbol: "TCS.NS", quantity: 10, avgPrice: 3000 }, { symbol: "INFY.NS", quantity: 20, avgPrice: 1400 }];
  const r = analyzeMyPortfolio({ holdings, histories, base: "INR" });
  const tcs = histories["TCS.NS"].candles.at(-1).close;
  const infy = histories["INFY.NS"].candles.at(-1).close;
  close(r.summary.value, 10 * tcs + 20 * infy);
  close(r.summary.cost, 10 * 3000 + 20 * 1400);
  close(r.summary.pnl, r.summary.value - r.summary.cost);
  close(r.positions.reduce((s, p) => s + p.weight, 0), 1);
  assert.ok(r.risk.effectiveHoldings > 1 && r.risk.effectiveHoldings <= 2);
  assert.equal(r.forecast.paths, 1000);
});

test("Mixed currencies convert USD holdings into INR with the FX series", () => {
  const histories = { "TCS.NS": hist("TCS.NS"), AAPL: hist("AAPL", "USD") };
  const fx = syntheticCandles("USDINR=X", 300);
  const holdings = [{ symbol: "TCS.NS", quantity: 1, avgPrice: 3000 }, { symbol: "AAPL", quantity: 2, avgPrice: 150 }];
  const r = analyzeMyPortfolio({ holdings, histories, base: "INR", fxCandles: fx });
  const usdinr = fx.at(-1).close;
  const aapl = r.positions.find((p) => p.symbol === "AAPL");
  close(aapl.value, 2 * histories.AAPL.candles.at(-1).close * usdinr);
  close(aapl.cost, 2 * 150 * usdinr);
  assert.equal(r.converted, true);
});

test("What-if: adding money raises today's value by exactly that amount", () => {
  const histories = { "TCS.NS": hist("TCS.NS"), "HDFCBANK.NS": hist("HDFCBANK.NS") };
  const holdings = [{ symbol: "TCS.NS", quantity: 10, avgPrice: 3000 }];
  const r = analyzeMyPortfolio({ holdings, histories, base: "INR", add: { symbol: "HDFCBANK.NS", amount: 10000 } });
  close(r.whatIf.after.value, r.summary.value + 10000, 1e-6);
  close(r.whatIf.shares * r.whatIf.priceInBase, 10000);
  close(r.whatIf.alone.forecast.start, 10000, 1e-6);
  assert.ok(r.whatIf.newWeight > 0 && r.whatIf.newWeight < 1);
  assert.ok(r.whatIf.corrWithPortfolio >= -1 && r.whatIf.corrWithPortfolio <= 1);
  const f = r.whatIf.after.forecast;
  assert.ok(f.p5 <= f.median && f.median <= f.p95);
  assert.ok(f.probProfit >= 0 && f.probProfit <= 1 && f.probLoss10 >= 0 && f.probLoss10 <= 1);
});

test("What-if works with an empty portfolio (first investment)", () => {
  const histories = { "TCS.NS": hist("TCS.NS") };
  const r = analyzeMyPortfolio({ holdings: [], histories, base: "INR", add: { symbol: "TCS.NS", amount: 5000 } });
  close(r.whatIf.after.value, 5000, 1e-6);
  assert.equal(r.summary.value, 0);
  assert.equal(r.forecast, undefined);
});
