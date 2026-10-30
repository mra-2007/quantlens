import { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { runJob } from "../../lib/api";
import { fmt, tone, C } from "../../lib/format";
import { Metric, ErrorNote, Skeleton, ChartTip, SimNote } from "../ui";

const VERDICT_TONE = { good: "up", bad: "down", mixed: "" };

/** Strategy Evolution: a genetic algorithm breeds trading rules and the champion is tested on unseen years. */
export default function Evolution({ symbol }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(0); // how many generations of the animation are visible

  useEffect(() => { setResult(null); setError(null); setShown(0); }, [symbol]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setShown(0);
    try {
      setResult(await runJob("evolve", { symbol, population: 40, generations: 25, seed: Math.floor(Math.random() * 1e6) }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  // Replay the generations one by one so you can watch the population improve.
  useEffect(() => {
    if (!result) return undefined;
    const last = result.history.length - 1;
    const t = setInterval(() => setShown((s) => { if (s >= last) { clearInterval(t); return s; } return s + 1; }), 140);
    return () => clearInterval(t);
  }, [result]);

  const done = result && shown >= result.history.length - 1;
  const cur = result?.currency;

  return (
    <div className="stack" style={{ "--gap": "18px" }}>
      <section className="panel stack" style={{ "--gap": "12px" }}>
        <div className="panel-head">
          <div>
            <div className="row" style={{ gap: 10 }}><h2 className="h3">Strategy Evolution</h2><span className="badge pro">Evolutionary AI</span></div>
            <p className="muted small" style={{ maxWidth: 780 }}>
              Forty random trading strategies are bred like living things. Each generation the best ones survive, swap rules (crossover) and randomly change (mutation). They only ever see the <b>first 60%</b> of {symbol}’s five years. The champion is then tested on the last 40%, years it has never seen, and compared with buy-and-hold and with random strategies.
            </p>
          </div>
          <button className="btn primary" onClick={start} disabled={busy}>{busy ? "Evolving…" : result ? "Evolve again (new seed)" : "Start evolution"}</button>
        </div>
        <ErrorNote error={error} />
        {busy && <Skeleton h={260} />}
        {result && <SimNote show={result.simulated} />}
      </section>

      {result && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3 className="h3">Generation {shown} of {result.config.generations}</h3>
              <p className="faint small">Fitness = Sharpe ratio on the training years, scaled down below 10 trades, minus a drawdown and complexity penalty. {fmt.num(result.config.evaluations, 0)} different strategies were tested.</p>
            </div>
            <span className="faint small">trained {result.split.trainFrom} → {result.split.trainTo}</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={result.history.slice(0, shown + 1)} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="gen" type="number" domain={[0, result.config.generations]} tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} />
              <YAxis tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={44} tickFormatter={(v) => fmt.num(v, 1)} />
              <Tooltip content={<ChartTip format={(v) => fmt.num(v, 2)} labelFormat={(l) => `Generation ${l}`} />} />
              <Legend />
              <Line dataKey="best" name="Best strategy" stroke={C.amber} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line dataKey="mean" name="Population average" stroke={C.sky} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {done && <Champion r={result} cur={cur} />}
    </div>
  );
}

function Champion({ r, cur }) {
  const t = r.test;
  const v = r.verdict;
  return (
    <>
      <section className="panel stack" style={{ "--gap": "14px", borderColor: v.tone === "good" ? "color-mix(in srgb, var(--up) 45%, transparent)" : v.tone === "bad" ? "color-mix(in srgb, var(--down) 45%, transparent)" : undefined }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <h3 className="h3">The champion</h3>
          <span className={`badge ${VERDICT_TONE[v.tone]}`} style={{ fontSize: 13, height: 26, padding: "0 12px" }}>{v.label}</span>
        </div>
        <p style={{ margin: 0 }}>{v.text}</p>

        <div className="grid g2" style={{ alignItems: "start" }}>
          <div className="stack small" style={{ "--gap": "6px" }}>
            <div className="faint">Rules the AI discovered</div>
            <div><b className="up">Buy when</b> {r.champion.entry.join(" AND ")}</div>
            <div><b className="down">Sell when</b> {r.champion.exit.join(" OR ")}</div>
            <div className="muted">
              {r.champion.stopLoss ? `Stop loss ${fmt.pctAbs(r.champion.stopLoss, 0)}` : "No stop loss"} · {r.champion.takeProfit ? `Take profit ${fmt.pctAbs(r.champion.takeProfit, 0)}` : "no take profit"}
            </div>
          </div>
          <div className="metrics" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Metric label="Sharpe, training years" value={fmt.num(r.train.sharpe)} formula={`${r.train.trades} trades`} />
            <Metric label="Sharpe, unseen years" value={fmt.num(t.strategy.sharpe)} tone={tone(t.strategy.sharpe)} formula={`${t.trades} trades`} />
            <Metric label="Unseen return" value={fmt.pct(t.strategy.totalReturn)} tone={tone(t.strategy.totalReturn)} formula={`max drawdown ${fmt.pct(t.strategy.maxDrawdown)}`} />
            <Metric label="Buy and hold, same years" value={fmt.pct(t.buyHold.totalReturn)} tone={tone(t.buyHold.totalReturn)} formula={`Sharpe ${fmt.num(t.buyHold.sharpe)}`} />
          </div>
        </div>
      </section>

      <div className="grid g2" style={{ alignItems: "start" }}>
        <section className="panel">
          <div className="panel-head"><h3 className="h3">On years it never saw</h3><span className="faint small">{r.split.testFrom} → {r.split.testTo}, starting at {fmt.money(10000, cur, 0)}</span></div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={r.curve} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} minTickGap={50} tickFormatter={(x) => x.slice(0, 7)} />
              <YAxis tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={56} domain={["auto", "auto"]} tickFormatter={(x) => fmt.compact(x)} />
              <Tooltip content={<ChartTip format={(x) => fmt.money(x, cur, 0)} />} />
              <Legend />
              <Line dataKey="strategy" name="Evolved strategy" stroke={C.amber} strokeWidth={2.2} dot={false} isAnimationActive={false} />
              <Line dataKey="buyHold" name="Buy and hold" stroke={C.muted} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </section>

        <section className="panel stack" style={{ "--gap": "12px" }}>
          <h3 className="h3">Was it better than luck?</h3>
          <p style={{ margin: 0 }}>
            On unseen years the champion’s Sharpe beat <b>{fmt.pctAbs(r.baseline.beatPct, 0)}</b> of {r.baseline.count} random strategies (their median Sharpe: {fmt.num(r.baseline.medianTestSharpe)}).
          </p>
          <div className="faint small">Hall of fame: the best distinct strategies of the final generation</div>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Buy rule</th><th className="r">Train Sharpe</th><th className="r">Unseen Sharpe</th></tr></thead>
              <tbody>
                {r.hallOfFame.map((h, i) => (
                  <tr key={i}>
                    <td className="small">{h.entry.join(" AND ")}<div className="faint">sell: {h.exit.join(" OR ")}</div></td>
                    <td className="r">{fmt.num(h.trainSharpe)}</td>
                    <td className={`r ${tone(h.testSharpe)}`}>{fmt.num(h.testSharpe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint small" style={{ margin: 0 }}>Evolution is excellent at memorising the past, which is why the unseen years decide the verdict. Past results, not advice.</p>
        </section>
      </div>
    </>
  );
}
