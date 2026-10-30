import { test } from "node:test";
import assert from "node:assert/strict";
import { evolveStrategies, describeCondition } from "../src/quant/evolve.js";
import { validateStrategy } from "../src/quant/backtest.js";
import { syntheticCandles } from "../src/lib/demoData.js";

const candles = syntheticCandles("RELIANCE.NS", 1100);
const run = () => evolveStrategies(candles, { population: 20, generations: 8, seed: 3 });

test("Evolution never loses its best strategy and is reproducible", () => {
  const a = run();
  for (let i = 1; i < a.history.length; i++) assert.ok(a.history[i].best >= a.history[i - 1].best - 1e-12, "elitism keeps the best");
  assert.ok(a.history.at(-1).best >= a.history[0].best);
  const b = run();
  assert.deepEqual(a.champion.entry, b.champion.entry);
  assert.equal(a.test.strategy.sharpe, b.test.strategy.sharpe);
});

test("The champion is a valid strategy and is judged only on later, unseen days", () => {
  const r = run();
  assert.deepEqual(validateStrategy(r.champion.genome), []);
  assert.ok(r.split.trainTo < r.split.testFrom);
  assert.equal(r.split.trainBars + r.split.testBars, candles.length);
  assert.equal(r.curve[0].time, r.split.testFrom);
  assert.ok(Math.abs(r.curve[0].strategy - 10000) < 1e-6 && Math.abs(r.curve[0].buyHold - 10000) < 1e-6);
  assert.ok(["Held up", "Overfit", "Mixed", "Too few trades"].includes(r.verdict.label));
  assert.ok(r.baseline.beatPct >= 0 && r.baseline.beatPct <= 1);
});

test("Rules are described in plain words", () => {
  assert.equal(describeCondition({ left: { ind: "rsi", period: 14 }, op: "crossesAbove", right: 30 }), "RSI(14) crosses above 30");
  assert.equal(describeCondition({ left: { ind: "price" }, op: "crossesBelow", right: { ind: "sma", period: 50 } }), "Price crosses below SMA(50)");
});
