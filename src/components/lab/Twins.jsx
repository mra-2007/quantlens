import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import { runJob } from "../../lib/api";
import { fmt, tone, C } from "../../lib/format";
import { Metric, ErrorNote, Skeleton, SimNote, Seg } from "../ui";

const LENGTHS = { "20d": 20, "40d": 40, "60d": 60 };
const HORIZONS = { "1 week": 5, "1 month": 21, "3 months": 63 };

/** Pattern Twins: k-nearest-neighbour search over chart shapes with dynamic time warping. */
export default function Twins({ symbol }) {
  const [len, setLen] = useState("40d");
  const [hor, setHor] = useState("1 month");
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    setR(null);
    setError(null);
    runJob("twins", { symbol, length: LENGTHS[len], horizon: HORIZONS[hor] }, { signal: ctl.signal })
      .then(setR)
      .catch((e) => e.name !== "AbortError" && setError(e));
    return () => ctl.abort();
  }, [symbol, len, hor]);

  const shapes = useMemo(() => {
    if (!r) return [];
    return r.query.shape.map((q, i) => {
      const row = { x: i - r.query.shape.length + 1, q };
      r.matches.forEach((m, k) => { row[`m${k}`] = m.shape[i]; });
      return row;
    });
  }, [r]);

  const futures = useMemo(() => {
    if (!r) return [];
    const H = r.params.horizon;
    return Array.from({ length: H + 1 }, (_, d) => {
      const vals = r.matches.map((m) => (d === 0 ? 0 : m.forward[d - 1])).sort((a, b) => a - b);
      const row = { d, median: vals[Math.floor(vals.length / 2)] };
      r.matches.forEach((m, k) => { row[`f${k}`] = d === 0 ? 0 : m.forward[d - 1]; });
      return row;
    });
  }, [r]);

  const s = r?.summary;
  const word = hor === "1 week" ? "a week" : hor === "1 month" ? "a month" : "3 months";

  return (
    <div className="stack" style={{ "--gap": "18px" }}>
      <section className="panel stack" style={{ "--gap": "12px" }}>
        <div className="panel-head">
          <div>
            <div className="row" style={{ gap: 10 }}><h2 className="h3">Pattern Twins</h2><span className="badge pro">Instance-based AI · k-NN + DTW</span></div>
            <p className="muted small" style={{ maxWidth: 800 }}>
              Take the shape of {symbol}’s last few weeks. The AI searches about five years of {symbol} and its peers for the 20 past moments with the most similar shape (compared with dynamic time warping, so a slightly faster or slower version still counts), then shows what really happened afterwards. No formula, just remembered history.
            </p>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <Seg label="Pattern length" value={len} options={Object.keys(LENGTHS)} onChange={setLen} />
            <Seg label="Look ahead" value={hor} options={Object.keys(HORIZONS)} onChange={setHor} />
          </div>
        </div>
        <ErrorNote error={error} />
        {r && <SimNote show={r.simulated} />}
        {!r && !error && <Skeleton h={300} />}
      </section>

      {r && (
        <>
          <section className="panel stack" style={{ "--gap": "14px", borderColor: r.verdict.label === "Leans up" ? "color-mix(in srgb, var(--up) 45%, transparent)" : r.verdict.label === "Leans down" ? "color-mix(in srgb, var(--down) 45%, transparent)" : undefined }}>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <h3 className="h3">What happened after the {r.matches.length} closest twins</h3>
              <span className={`badge ${r.verdict.label === "Leans up" ? "up" : r.verdict.label === "Leans down" ? "down" : ""}`} style={{ fontSize: 13, height: 26, padding: "0 12px" }}>{r.verdict.label}</span>
            </div>
            <p style={{ margin: 0 }}>
              In <b>{s.up} of {r.matches.length}</b> similar moments the price was higher after {word} ({fmt.pctAbs(s.probUp, 0)}; 95% interval {fmt.pctAbs(s.ci[0], 0)} to {fmt.pctAbs(s.ci[1], 0)}). Across <i>all</i> {fmt.num(r.scanned.windows, 0)} windows searched, {fmt.pctAbs(r.baseline.probUp, 0)} were followed by a rise.{" "}
              {r.verdict.label === "No clear edge"
                ? "That difference is within what chance alone can produce with only 20 examples, so treat it as context, not a signal."
                : `That is a statistically meaningful gap (z = ${fmt.num(r.verdict.z, 1)}), though history can still change.`}
            </p>
            <div className="metrics">
              <Metric label="Went up" value={`${s.up} / ${r.matches.length}`} tone={s.probUp >= 0.5 ? "up" : "down"} formula={`base rate ${fmt.pctAbs(r.baseline.probUp, 0)}`} />
              <Metric label={`Typical outcome (${word})`} value={fmt.pct(s.median)} tone={tone(s.median)} formula={`all windows: ${fmt.pct(r.baseline.median)}`} />
              <Metric label="Range (10th–90th)" value={`${fmt.pct(s.p10, 0)} to ${fmt.pct(s.p90, 0)}`} formula="of the 20 outcomes" />
              <Metric label="Worst / best twin" value={`${fmt.pct(s.worst, 0)} / ${fmt.pct(s.best, 0)}`} formula={`searched ${r.scanned.symbols} stocks`} />
            </div>
          </section>

          <div className="grid g2" style={{ alignItems: "start" }}>
            <section className="panel">
              <div className="panel-head"><h3 className="h3">Today vs its twins</h3><span className="faint small">shape only (z-scored log price), last {r.params.length} days</span></div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={shapes} margin={{ left: 0, right: 8, top: 6 }}>
                  <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} tickFormatter={(v) => (v === 0 ? "today" : `${v}d`)} />
                  <YAxis tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={34} tickFormatter={(v) => fmt.num(v, 0)} />
                  {r.matches.map((_, k) => <Line key={k} dataKey={`m${k}`} stroke={C.sky} strokeOpacity={0.22} strokeWidth={1.2} dot={false} isAnimationActive={false} />)}
                  <Line dataKey="q" stroke={C.amber} strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="faint small" style={{ margin: 0 }}><span style={{ color: C.amber }}>■</span> {symbol} now &nbsp; <span style={{ color: C.sky }}>■</span> its 20 closest past twins</p>
            </section>
            <section className="panel">
              <div className="panel-head"><h3 className="h3">What happened next</h3><span className="faint small">return after each twin, {word} ahead</span></div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={futures} margin={{ left: 0, right: 8, top: 6 }}>
                  <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="d" type="number" domain={[0, r.params.horizon]} tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} tickFormatter={(v) => `+${v}d`} />
                  <YAxis tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={48} tickFormatter={(v) => fmt.pctAbs(v, 0)} />
                  <ReferenceLine y={0} stroke={C.chalk} strokeDasharray="3 3" strokeOpacity={0.5} />
                  {r.matches.map((m, k) => <Line key={k} dataKey={`f${k}`} stroke={m.forwardReturn > 0 ? C.up : C.down} strokeOpacity={0.4} strokeWidth={1.2} dot={false} isAnimationActive={false} />)}
                  <Line dataKey="median" stroke={C.chalk} strokeWidth={3} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="faint small" style={{ margin: 0 }}><span style={{ color: C.up }}>■</span> rose &nbsp; <span style={{ color: C.down }}>■</span> fell &nbsp; <span style={{ color: C.chalk }}>■</span> median of the twins</p>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h3 className="h3">The twins</h3>
              <button className="btn sm ghost" onClick={() => setAll((v) => !v)}>{all ? "Show top 8" : `Show all ${r.matches.length}`}</button>
            </div>
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>#</th><th>Stock</th><th>Period of the twin</th><th className="r">Distance</th><th className="r">Closeness rank</th><th className="r">After {word}</th></tr></thead>
                <tbody>
                  {(all ? r.matches : r.matches.slice(0, 8)).map((m, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td><b>{m.symbol}</b></td>
                      <td className="small">{m.start} → {m.end}</td>
                      <td className="r">{fmt.num(m.distance, 2)}</td>
                      <td className="r">#{fmt.num(m.rank, 0)} of {fmt.num(r.scanned.windows, 0)}</td>
                      <td className={`r ${tone(m.forwardReturn)}`}><b>{fmt.pct(m.forwardReturn)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="faint small" style={{ marginBottom: 0 }}>Distance is the dynamic-time-warping cost per day between z-normalised shapes (lower = more alike). Matches from the same episode are spaced at least 15 days apart. Past results, not advice.</p>
          </section>
        </>
      )}
    </div>
  );
}
