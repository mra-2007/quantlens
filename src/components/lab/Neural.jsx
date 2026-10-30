import { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { runJob } from "../../lib/api";
import { fmt, tone, C } from "../../lib/format";
import { Metric, ErrorNote, Skeleton, SimNote, ChartTip } from "../ui";

const LEAN_BADGE = { "Leans up": "up", "Leans down": "down", Neutral: "" };

/** Neural Forecaster: a neural network plus an honest walk-forward report card. */
export default function Neural({ symbol }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    setR(null);
    setError(null);
    runJob("neural", { symbol }, { signal: ctl.signal })
      .then(setR)
      .catch((e) => e.name !== "AbortError" && setError(e));
    return () => ctl.abort();
  }, [symbol]);

  const cd = r?.card;
  const st = r?.strategy;
  const maxDrop = r ? Math.max(0.001, ...r.importance.map((x) => x.drop)) : 1;

  return (
    <div className="stack" style={{ "--gap": "18px" }}>
      <section className="panel stack" style={{ "--gap": "12px" }}>
        <div>
          <div className="row" style={{ gap: 10 }}><h2 className="h3">Neural Forecaster</h2><span className="badge pro">Deep learning · Neural network</span></div>
          <p className="muted small" style={{ maxWidth: 820 }}>
            A small neural network (10 inputs, 8 hidden neurons, trained with the Adam optimiser) learns from the recent behaviour of {symbol} and outputs the chance that the price is higher in 5 trading days. The real test comes first: the network is retrained every quarter using only the past, and graded on the days that followed. Those are days it had never seen, so the score cannot be faked.
          </p>
        </div>
        <ErrorNote error={error} />
        {r && <SimNote show={r.simulated} />}
        {!r && !error && <Skeleton h={260} />}
      </section>

      {r && (
        <>
          <section className="panel stack" style={{ "--gap": "14px", borderColor: r.verdict.tone === "up" ? "color-mix(in srgb, var(--up) 45%, transparent)" : undefined }}>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <h3 className="h3">Report card first</h3>
              <span className={`badge ${r.verdict.tone}`} style={{ fontSize: 13, height: 26, padding: "0 12px" }}>{r.verdict.label}</span>
            </div>
            <p style={{ margin: 0, maxWidth: 820 }}>{r.verdict.text}</p>
            <div className="metrics">
              <Metric label="Right on unseen days" value={fmt.pctAbs(cd.accuracy, 1)} tone={r.verdict.tone} formula={`tested on ${fmt.num(cd.n, 0)} days in ${r.params.folds} windows`} />
              <Metric label="Lazy guess scores" value={fmt.pctAbs(cd.naive, 1)} formula="always say the commoner direction" />
              <Metric label="Probability skill" value={fmt.pct(cd.skill, 1)} tone={cd.skill > 0 ? "up" : "down"} formula="1 − Brier / Brier of a flat guess" />
              <Metric label="Statistical strength" value={`z = ${fmt.num(cd.z, 2)}`} tone={cd.z >= 1.64 ? "up" : undefined} formula={`needs ≥ 1.64, ~${fmt.num(cd.effectiveTests, 0)} independent tests`} />
            </div>
          </section>

          <section className="panel stack" style={{ "--gap": "14px" }}>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <h3 className="h3">Today’s call, {r.today.time}</h3>
              <span className={`badge ${LEAN_BADGE[r.today.lean]}`} style={{ fontSize: 13, height: 26, padding: "0 12px" }}>{r.today.lean}</span>
              <span className="faint small">{r.today.trusted ? "backed by the report card" : "report card does not back this call, treat it as a coin flip"}</span>
            </div>
            <p style={{ margin: 0 }}>
              The network puts the chance of a higher close in {r.params.horizon} trading days at <b>{fmt.pctAbs(r.today.probUp, 0)}</b>. Any stock rises over a week about {fmt.pctAbs(cd.upShare, 0)} of the time in this history.
            </p>
            <div style={{ position: "relative", height: 10, background: C.rule, borderRadius: 5 }} aria-label={`Chance of rising ${fmt.pctAbs(r.today.probUp, 0)}`}>
              <div style={{ width: `${Math.min(100, Math.max(0, r.today.probUp * 100))}%`, height: "100%", background: r.today.trusted ? (r.today.probUp > 0.5 ? C.up : C.down) : C.muted, borderRadius: 5, opacity: r.today.trusted ? 1 : 0.55 }} />
              <div title="50%" style={{ position: "absolute", left: "50%", top: -4, width: 2, height: 18, background: C.chalk }} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3 className="h3">If you had followed it (unseen days only)</h3>
              <span className="faint small"><span style={{ color: C.amber }}>●</span> network: in when it says up, else cash · <span style={{ color: C.muted }}>●</span> buy and hold</span>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={r.curve} margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} minTickGap={60} tickFormatter={(x) => x.slice(0, 7)} />
                <YAxis tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={50} domain={["auto", "auto"]} tickFormatter={(x) => `${fmt.num(x, 1)}×`} />
                <Tooltip content={<ChartTip format={(x) => `${fmt.num(x, 2)}×`} />} />
                <ReferenceLine y={1} stroke={C.rule} />
                <Line dataKey="hold" name="Buy and hold" stroke={C.muted} strokeWidth={1.4} dot={false} isAnimationActive={false} />
                <Line dataKey="model" name="Follow the network" stroke={C.amber} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="metrics" style={{ marginTop: 12 }}>
              <Metric label="Network return" value={fmt.pct(st.model.total, 0)} tone={tone(st.model.total)} formula={`Sharpe ${fmt.num(st.model.sharpe, 2)}, worst drop ${fmt.pct(st.model.maxDD, 0)}`} />
              <Metric label="Buy and hold return" value={fmt.pct(st.hold.total, 0)} tone={tone(st.hold.total)} formula={`Sharpe ${fmt.num(st.hold.sharpe, 2)}, worst drop ${fmt.pct(st.hold.maxDD, 0)}`} />
              <Metric label="Time invested" value={fmt.pctAbs(st.exposure, 0)} formula={`${st.feeBps} bps cost per switch included`} />
            </div>
          </section>

          <div className="grid g2" style={{ alignItems: "start" }}>
            <section className="panel stack" style={{ "--gap": "12px" }}>
              <h3 className="h3">What the network pays attention to</h3>
              <p className="faint small" style={{ margin: 0 }}>Each input is scrambled on the unseen days; the bar shows how much accuracy fell. A longer bar means the network relied on it more.</p>
              <div className="stack" style={{ "--gap": "8px" }}>
                {r.importance.map((f) => (
                  <div key={f.key}>
                    <div className="spread small"><span>{f.label}</span><span className="faint">{f.drop > 0 ? `−${fmt.num(f.drop * 100, 1)} pts` : "no effect"}</span></div>
                    <div style={{ height: 6, background: C.rule, borderRadius: 3 }}><div style={{ width: `${Math.max(0, f.drop / maxDrop) * 100}%`, height: "100%", background: C.amber, borderRadius: 3 }} /></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel stack" style={{ "--gap": "12px" }}>
              <h3 className="h3">Can you trust its percentages?</h3>
              <p className="faint small" style={{ margin: 0 }}>When it said “60%”, did the stock really rise about 60% of the time? Close numbers in the two columns mean its confidence is honest.</p>
              <div className="scroll-x">
                <table className="table">
                  <thead><tr><th>It said</th><th className="r">Days</th><th className="r">Average said</th><th className="r">Really rose</th></tr></thead>
                  <tbody>
                    {r.calibration.filter((b) => b.n > 0).map((b) => (
                      <tr key={b.from}>
                        <td>{fmt.num(b.from * 100, 0)}% to {fmt.num(b.to * 100, 0)}%</td>
                        <td className="r">{b.n}</td>
                        <td className="r">{fmt.pctAbs(b.predicted, 0)}</td>
                        <td className="r">{fmt.pctAbs(b.actual, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="math muted small">p = σ( b₂ + Σⱼ W₂ⱼ · tanh( b₁ⱼ + W₁ⱼ · x ) ) &nbsp;·&nbsp; loss = cross-entropy + λ‖W‖²</div>
              <p className="faint small" style={{ margin: 0 }}>Trained on {fmt.num(r.params.trained, 0)} days from {r.params.trainStart}; tests start {r.params.firstTest}; three networks with different random starts are averaged. Markets are mostly noise, so a result of “no clear edge” is normal and honest. Past results, not advice.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
