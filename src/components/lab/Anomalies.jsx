import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { runJob } from "../../lib/api";
import { fmt, tone, C } from "../../lib/format";
import { Metric, ErrorNote, Skeleton, SimNote, Seg, ChartTip } from "../ui";

const VIEWS = { "1y": 252, "2y": 504, "5y": 1300 };

const REASON = {
  ret: (v) => `daily move ${fmt.pct(v, 1)}`,
  gap: (v) => `opening gap ${fmt.pct(v, 1)}`,
  range: (v) => `intraday range ${fmt.pctAbs(v, 1)}`,
  volume: (v) => `volume ${fmt.num(v, 1)}× normal`,
  ret5: (v) => `5-day move ${fmt.pct(v, 1)}`,
  shock: (v) => `a ${fmt.num(Math.abs(v), 1)}σ move for recent calm`,
};
const reasonText = (reasons, n = 2) => reasons.slice(0, n).map((x) => REASON[x.key](x.value)).join(" · ");

/** Anomaly Radar: an Isolation Forest flags unusual trading days and explains why. */
export default function Anomalies({ symbol }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState("2y");

  useEffect(() => {
    const ctl = new AbortController();
    setR(null);
    setError(null);
    runJob("anomaly", { symbol }, { signal: ctl.signal })
      .then(setR)
      .catch((e) => e.name !== "AbortError" && setError(e));
    return () => ctl.abort();
  }, [symbol]);

  const data = useMemo(() => (r ? r.series.slice(-VIEWS[view]).map((p) => ({ ...p, flag: p.flagged ? p.close : undefined })) : []), [r, view]);
  const cur = r?.currency;
  const t = r?.today;

  return (
    <div className="stack" style={{ "--gap": "18px" }}>
      <section className="panel stack" style={{ "--gap": "12px" }}>
        <div className="panel-head">
          <div>
            <div className="row" style={{ gap: 10 }}><h2 className="h3">Anomaly Radar</h2><span className="badge pro">Unsupervised AI · Isolation Forest</span></div>
            <p className="muted small" style={{ maxWidth: 800 }}>
              The AI builds 150 random decision trees from six facts about every trading day of {symbol} (size of the move, opening gap, intraday range, volume, 5-day move and shock versus recent calm). Unusual days are cut off from the crowd after only a few random splits, so they score close to 1. It was never told what “unusual” means: it learned what normal looks like for this stock.
            </p>
          </div>
          <Seg label="View" value={view} options={Object.keys(VIEWS)} onChange={setView} />
        </div>
        <ErrorNote error={error} />
        {r && <SimNote show={r.simulated} />}
        {!r && !error && <Skeleton h={300} />}
      </section>

      {r && (
        <>
          <section className="panel stack" style={{ "--gap": "14px", borderColor: t.flagged ? "color-mix(in srgb, var(--down) 45%, transparent)" : undefined }}>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <h3 className="h3">Latest session, {t.time}</h3>
              <span className={`badge ${t.flagged ? "down" : "up"}`} style={{ fontSize: 13, height: 26, padding: "0 12px" }}>{t.flagged ? "Unusual" : "Ordinary"}</span>
            </div>
            <p style={{ margin: 0 }}>
              {t.flagged ? "This day is among the most unusual 2% of the last five years" : "Nothing out of the ordinary"}: more unusual than <b>{fmt.pctAbs(t.percentile, 0)}</b> of days. Biggest contributors: {reasonText(t.reasons)}.
            </p>
            <div style={{ position: "relative", height: 10, background: C.rule, borderRadius: 5 }} aria-label={`Anomaly score ${fmt.num(t.score, 2)}`}>
              <div style={{ width: `${Math.min(100, Math.max(0, ((t.score - 0.35) / 0.4) * 100))}%`, height: "100%", background: t.flagged ? C.down : C.up, borderRadius: 5 }} />
              <div title="flag threshold" style={{ position: "absolute", left: `${((r.params.threshold - 0.35) / 0.4) * 100}%`, top: -4, width: 2, height: 18, background: C.chalk }} />
            </div>
            <div className="metrics">
              <Metric label="Today's anomaly score" value={fmt.num(t.score, 2)} tone={t.flagged ? "down" : undefined} formula="2^(−E[h]/c(ψ)), about 0.5 is ordinary" />
              <Metric label="Flag threshold" value={fmt.num(r.params.threshold, 2)} formula="top 2% of days" />
              <Metric label="Days flagged" value={`${r.flaggedCount} of ${fmt.num(r.params.days, 0)}`} formula="about 1 in 50" />
              <Metric label="Trees / subsample" value={`${r.params.trees} / ${r.params.subsample}`} formula="isolation forest" />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3 className="h3">Price with flagged days</h3><span className="faint small"><span style={{ color: C.down }}>●</span> days the AI found unusual</span></div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} minTickGap={60} tickFormatter={(x) => x.slice(0, 7)} />
                <YAxis tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={58} domain={["auto", "auto"]} tickFormatter={(x) => fmt.num(x, 0)} />
                <Tooltip content={<ChartTip format={(x) => fmt.money(x, cur)} filter={(p) => p.dataKey !== "flag"} />} />
                <Line dataKey="close" name="Close" stroke={C.chalk} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                <Line dataKey="flag" name="Flagged" stroke="none" dot={{ r: 4.5, fill: C.down, stroke: "#0E1726", strokeWidth: 1 }} activeDot={false} isAnimationActive={false} legendType="none" />
              </LineChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={data} margin={{ left: 0, right: 12, top: 4 }}>
                <XAxis dataKey="time" hide />
                <YAxis tick={{ fill: C.muted, fontSize: 11 }} stroke={C.rule} width={58} domain={[0.35, "auto"]} tickFormatter={(x) => fmt.num(x, 2)} />
                <Tooltip content={<ChartTip format={(x) => fmt.num(x, 3)} />} />
                <ReferenceLine y={r.params.threshold} stroke={C.down} strokeDasharray="3 3" />
                <Area dataKey="score" name="Anomaly score" stroke={C.amber} fill={C.amber} fillOpacity={0.18} strokeWidth={1.4} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </section>

          <div className="grid g2" style={{ alignItems: "start" }}>
            <section className="panel">
              <div className="panel-head"><h3 className="h3">The most unusual days</h3><span className="faint small">last 5 years</span></div>
              <div className="scroll-x">
                <table className="table">
                  <thead><tr><th>Date</th><th className="r">Score</th><th>Why it stood out</th><th className="r">Next 5 days</th></tr></thead>
                  <tbody>
                    {r.anomalies.map((a) => (
                      <tr key={a.time}>
                        <td className="small" style={{ whiteSpace: "nowrap" }}><b>{a.time}</b><div className={tone(a.move)}>{fmt.pct(a.move, 1)}</div></td>
                        <td className="r">{fmt.num(a.score, 2)}</td>
                        <td className="small">{reasonText(a.reasons, 3)}</td>
                        <td className={`r ${tone(a.next5)}`}>{a.next5 == null ? "–" : fmt.pct(a.next5, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel stack" style={{ "--gap": "12px" }}>
              <h3 className="h3">What usually follows a flagged day?</h3>
              <div className="scroll-x">
                <table className="table">
                  <thead><tr><th /><th className="r">Median</th><th className="r">Went up</th><th className="r">Cases</th></tr></thead>
                  <tbody>
                    {[["h5", "5 days later"], ["h20", "20 days later"]].flatMap(([k, label]) => [
                      <tr key={`${k}f`}><td><b>{label}</b><div className="faint small">after flagged days</div></td><td className={`r ${tone(r.aftermath[k].flagged.median)}`}>{fmt.pct(r.aftermath[k].flagged.median)}</td><td className="r">{fmt.pctAbs(r.aftermath[k].flagged.probUp, 0)}</td><td className="r">{r.aftermath[k].flagged.n}</td></tr>,
                      <tr key={`${k}a`}><td className="faint small">after any day</td><td className={`r ${tone(r.aftermath[k].all.median)}`}>{fmt.pct(r.aftermath[k].all.median)}</td><td className="r">{fmt.pctAbs(r.aftermath[k].all.probUp, 0)}</td><td className="r">{r.aftermath[k].all.n}</td></tr>,
                    ])}
                  </tbody>
                </table>
              </div>
              <p className="faint small" style={{ margin: 0 }}>With only about {r.flaggedCount} flagged days, differences here are often just noise. The radar tells you a day was unusual, not which way the price will go. Past results, not advice.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
