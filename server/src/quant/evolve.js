// Strategy Evolution: a genetic algorithm that breeds trading rules.
//
// A "genome" is a complete strategy for the existing backtester (entry rules, exit rules,
// stop loss, take profit). A population of random genomes is scored on the TRAINING years
// only; the fittest are selected, recombined (crossover) and randomly altered (mutation),
// generation after generation. The final champion is then run once on later years the
// algorithm never saw, and compared with buy-and-hold and with random strategies.
//
// Honest by construction: evolution is very good at memorising the past, so the unseen test
// period is what decides whether the strategy "held up" or was overfit.
import { runBacktest } from "./backtest.js";
import { rng, mean } from "./stats.js";
import { simpleReturns, maxDrawdown, sharpeRatio, cagr } from "./risk.js";

const pick = (u, arr) => arr[Math.floor(u() * arr.length)];
const CROSS = ["crossesAbove", "crossesBelow"];
const RSI_P = [7, 10, 14, 21];
const STO_P = [9, 14, 21];
const EMA_P = [8, 12, 21, 26, 50, 100];
const SMA_P = [10, 20, 30, 50, 100, 150, 200];

/** One random rule from a library of 8 templates built on the backtester's indicators. */
function randomCondition(u) {
  switch (Math.floor(u() * 8)) {
    case 0: return { left: { ind: "price" }, op: pick(u, CROSS), right: { ind: "sma", period: pick(u, SMA_P) } };
    case 1: return { left: { ind: "sma", period: pick(u, [5, 10, 20, 30, 50]) }, op: pick(u, CROSS), right: { ind: "sma", period: pick(u, [60, 100, 150, 200]) } };
    case 2: return { left: { ind: "rsi", period: pick(u, RSI_P) }, op: pick(u, CROSS), right: pick(u, [20, 25, 30, 35, 40, 50, 60, 65, 70, 75, 80]) };
    case 3: return { left: { ind: "rsi", period: pick(u, RSI_P) }, op: pick(u, [">", "<"]), right: pick(u, [25, 30, 35, 40, 50, 60, 65, 70, 75]) };
    case 4: return { left: { ind: "macd" }, op: pick(u, CROSS), right: { ind: "macdSignal" } };
    case 5: return { left: { ind: "price" }, op: pick(u, CROSS), right: { ind: pick(u, ["bbLower", "bbMiddle", "bbUpper"]), period: 20 } };
    case 6: return { left: { ind: "stochK", period: pick(u, STO_P) }, op: pick(u, [...CROSS, ">", "<"]), right: pick(u, [15, 20, 30, 50, 70, 80, 85]) };
    default: return { left: { ind: "price" }, op: pick(u, [">", "<"]), right: { ind: "ema", period: pick(u, EMA_P) } };
  }
}

const randomStop = (u) => (u() < 0.5 ? null : pick(u, [0.03, 0.05, 0.08, 0.1, 0.15]));
const randomTake = (u) => (u() < 0.5 ? null : pick(u, [0.05, 0.1, 0.15, 0.2, 0.3]));

function randomGenome(u) {
  const n = () => (u() < 0.7 ? 1 : 2);
  return {
    entry: Array.from({ length: n() }, () => randomCondition(u)),
    exit: Array.from({ length: n() }, () => randomCondition(u)),
    stopLoss: randomStop(u),
    takeProfit: randomTake(u),
    feeBps: 10,
  };
}

const clone = (g) => JSON.parse(JSON.stringify(g));

function nudgeCondition(c, u) {
  if (typeof c.right === "number") {
    c.right = Math.min(95, Math.max(5, c.right + pick(u, [-10, -5, 5, 10])));
  } else {
    const target = c.right?.ind === "sma" || c.right?.ind === "ema" ? c.right : c.left.period ? c.left : null;
    if (target?.period) target.period = Math.min(400, Math.max(2, Math.round(target.period * pick(u, [0.7, 0.85, 1.15, 1.4]))));
  }
}

function mutate(parent, u) {
  const g = clone(parent);
  const side = u() < 0.5 ? "entry" : "exit";
  const r = u();
  if (r < 0.35) nudgeCondition(pick(u, g[side]), u);
  else if (r < 0.6) g[side][Math.floor(u() * g[side].length)] = randomCondition(u);
  else if (r < 0.75) {
    if (g[side].length < 2) g[side].push(randomCondition(u));
    else g[side].splice(Math.floor(u() * g[side].length), 1);
  } else if (r < 0.9) g.stopLoss = randomStop(u);
  else g.takeProfit = randomTake(u);
  return g;
}

function crossover(a, b, u) {
  return { entry: clone(a.entry), exit: clone(b.exit), stopLoss: u() < 0.5 ? a.stopLoss : b.stopLoss, takeProfit: u() < 0.5 ? a.takeProfit : b.takeProfit, feeBps: 10 };
}

// ---------- scoring ----------
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Training fitness: Sharpe (scaled down below 10 trades), a drawdown penalty and a small complexity penalty. */
function trainScore(genome, candles) {
  try {
    const res = runBacktest(candles, genome, { initialCapital: 10000 });
    const s = res.stats.strategy;
    const trades = res.stats.trades;
    const extra = genome.entry.length + genome.exit.length - 2;
    let fitness = finite(s.sharpe) * Math.min(1, trades / 10) + 0.5 * finite(s.maxDrawdown) - 0.05 * extra;
    if (trades < 3) fitness -= 1;
    return { fitness, trades, sharpe: finite(s.sharpe), totalReturn: s.totalReturn, maxDrawdown: s.maxDrawdown, buyHold: res.stats.buyHold };
  } catch {
    return { fitness: -5, trades: 0, sharpe: 0, totalReturn: 0, maxDrawdown: 0, buyHold: null };
  }
}

function summarise(values) {
  const r = simpleReturns(values);
  return {
    totalReturn: values[values.length - 1] / values[0] - 1,
    cagr: cagr(values[0], values[values.length - 1], values.length - 1),
    sharpe: finite(sharpeRatio(r, 0.04)),
    maxDrawdown: maxDrawdown(values).maxDrawdown,
  };
}

/** Runs a genome on the unseen period, with 250 bars of warm-up so slow indicators are ready on day one. */
function unseenRun(genome, candles, splitIdx) {
  const start = Math.max(0, splitIdx - 250);
  const slice = candles.slice(start);
  const res = runBacktest(slice, genome, { initialCapital: 10000 });
  const from = splitIdx - start;
  const strat = res.curve.slice(from).map((p) => p.strategy);
  const hold = res.curve.slice(from).map((p) => p.buyHold);
  const testStart = candles[splitIdx].time;
  const trades = res.trades.filter((t) => t.entryTime >= testStart);
  const rebase = (arr) => arr.map((v) => (v / arr[0]) * 10000);
  return {
    strategy: summarise(strat),
    buyHold: summarise(hold),
    trades: trades.length,
    winRate: trades.length ? trades.filter((t) => t.returnPct > 0).length / trades.length : null,
    curve: res.curve.slice(from).map((p, i) => ({ time: p.time, strategy: rebase(strat)[i], buyHold: rebase(hold)[i] })),
  };
}

// ---------- human-readable rules ----------
const NAMES = { price: "Price", macd: "MACD", macdSignal: "MACD signal", bbLower: "Lower Bollinger band", bbMiddle: "Middle Bollinger band", bbUpper: "Upper Bollinger band", stochK: "Stochastic %K" };
const OPS = { crossesAbove: "crosses above", crossesBelow: "crosses below", ">": "is above", "<": "is below" };
const operand = (o) => (typeof o === "number" ? String(o) : NAMES[o.ind] ? `${NAMES[o.ind]}${o.ind === "stochK" ? `(${o.period})` : ""}` : `${o.ind.toUpperCase()}(${o.period})`);
export const describeCondition = (c) => `${operand(c.left)} ${OPS[c.op]} ${operand(c.right)}`;
export const describeGenome = (g) => ({
  entry: g.entry.map(describeCondition),
  exit: g.exit.map(describeCondition),
  stopLoss: g.stopLoss,
  takeProfit: g.takeProfit,
});

function verdictOf(train, test) {
  const ts = train.sharpe;
  const xs = test.strategy.sharpe;
  const beatsHold = test.strategy.totalReturn > test.buyHold.totalReturn;
  if (test.trades < 3) return { label: "Too few trades", tone: "mixed", beatsHold, text: "The champion made fewer than 3 trades on unseen data, which is too few to judge." };
  if (xs >= 0.3 && (ts <= 0 || xs >= 0.5 * ts)) {
    return { label: "Held up", tone: "good", beatsHold, text: `On years it never saw, Sharpe went ${ts.toFixed(2)} → ${xs.toFixed(2)}. It kept its edge${beatsHold ? " and beat buy-and-hold" : ", though buy-and-hold still returned more"}.` };
  }
  if (xs < 0 || (ts > 0 && xs < 0.25 * ts)) {
    return { label: "Overfit", tone: "bad", beatsHold, text: `Sharpe collapsed from ${ts.toFixed(2)} on training years to ${xs.toFixed(2)} on unseen years. The AI memorised the past instead of finding a lasting pattern.` };
  }
  return { label: "Mixed", tone: "mixed", beatsHold, text: `Sharpe went ${ts.toFixed(2)} → ${xs.toFixed(2)}: some of the edge survived, some did not.` };
}

/**
 * @param {any[]} candles  daily candles, oldest first (about 5 years works well)
 */
export function evolveStrategies(candles, { population = 40, generations = 25, seed = 7, trainFrac = 0.6 } = {}) {
  if (candles.length < 500) throw Object.assign(new Error("Need at least about 2 years of prices to evolve and test strategies"), { status: 422 });
  const u = rng(seed);
  const splitIdx = Math.floor(candles.length * trainFrac);
  const train = candles.slice(0, splitIdx);

  const cache = new Map();
  let evaluations = 0;
  const score = (g) => {
    const key = JSON.stringify(g);
    if (!cache.has(key)) { cache.set(key, trainScore(g, train)); evaluations++; }
    return cache.get(key);
  };

  let pop = Array.from({ length: population }, () => randomGenome(u));
  const firstGen = pop.map(clone);
  const history = [];
  const tournament = (scored) => {
    let best = null;
    for (let i = 0; i < 3; i++) { const c = scored[Math.floor(u() * scored.length)]; if (!best || c.s.fitness > best.s.fitness) best = c; }
    return best.g;
  };

  let scored = [];
  for (let gen = 0; gen <= generations; gen++) {
    scored = pop.map((g) => ({ g, s: score(g) })).sort((a, b) => b.s.fitness - a.s.fitness);
    history.push({ gen, best: scored[0].s.fitness, mean: mean(scored.map((x) => x.s.fitness)), bestSharpe: scored[0].s.sharpe, trades: scored[0].s.trades });
    if (gen === generations) break;
    const next = scored.slice(0, 3).map((x) => x.g); // elitism: the best 3 survive unchanged
    while (next.length < population) {
      let child = u() < 0.7 ? crossover(tournament(scored), tournament(scored), u) : clone(tournament(scored));
      if (u() < 0.45) child = mutate(child, u);
      next.push(child);
    }
    pop = next;
  }

  // Hall of fame: the best strategies of the final generation that differ in structure,
  // not just in a period or threshold (EMA 85 vs EMA 100 counts as the same idea).
  const shape = (g) => JSON.stringify(describeGenome(g)).replace(/\d+(\.\d+)?/g, "#");
  const seen = new Set();
  const hall = [];
  for (const x of scored) {
    const k = shape(x.g);
    if (seen.has(k)) continue;
    seen.add(k);
    hall.push(x);
    if (hall.length === 5) break;
  }
  for (const x of scored) { // too little variety left after convergence: top up with the next best exact-distinct ones
    if (hall.length >= 3) break;
    if (!hall.includes(x) && JSON.stringify(describeGenome(x.g)) !== JSON.stringify(describeGenome(hall[0].g))) hall.push(x);
  }

  const champion = hall[0];
  const test = unseenRun(champion.g, candles, splitIdx);
  const trainStats = champion.s;

  // Did evolution pick something better than random on unseen data?
  const randomTests = firstGen
    .filter((g) => score(g).trades >= 3)
    .map((g) => unseenRun(g, candles, splitIdx).strategy.sharpe);
  const pool = randomTests.length >= 5 ? randomTests : firstGen.map((g) => unseenRun(g, candles, splitIdx).strategy.sharpe);
  const sortedPool = [...pool].sort((a, b) => a - b);

  return {
    split: { trainFrom: train[0].time, trainTo: train[train.length - 1].time, testFrom: candles[splitIdx].time, testTo: candles[candles.length - 1].time, trainBars: train.length, testBars: candles.length - splitIdx },
    config: { population, generations, evaluations, seed },
    history,
    champion: { ...describeGenome(champion.g), genome: champion.g, trainFitness: champion.s.fitness },
    train: { sharpe: trainStats.sharpe, totalReturn: trainStats.totalReturn, maxDrawdown: trainStats.maxDrawdown, trades: trainStats.trades, buyHold: trainStats.buyHold },
    test: { strategy: test.strategy, buyHold: test.buyHold, trades: test.trades, winRate: test.winRate },
    curve: test.curve,
    hallOfFame: hall.map((x) => ({ ...describeGenome(x.g), trainFitness: x.s.fitness, trainSharpe: x.s.sharpe, trades: x.s.trades, testSharpe: unseenRun(x.g, candles, splitIdx).strategy.sharpe })),
    baseline: {
      count: pool.length,
      medianTestSharpe: sortedPool[Math.floor(sortedPool.length / 2)],
      beatPct: pool.filter((v) => v < test.strategy.sharpe).length / pool.length,
    },
    verdict: verdictOf({ sharpe: trainStats.sharpe }, test),
  };
}
