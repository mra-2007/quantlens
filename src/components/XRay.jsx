import { useEffect, useState } from "react";
import { runJob } from "../lib/api";
import { fmt, C } from "../lib/format";
import { ErrorNote, Skeleton, Metric } from "./ui";

const short = (s) => s.replace(/\.(NS|BO)$/, "");
const GRADE_TONE = { "Well spread": "up", "Partly concentrated": "", Concentrated: "down" };
const PALETTE = [C.amber, C.up, "#7AA2FF", C.down, "#C792EA"];

/** Portfolio X-Ray: PCA and clustering reveal how many independent bets the holdings really are. */
export default function XRay({ holdings }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = holdings.map((h) => `${h.symbol}:${h.quantity}`).join(",");

  useEffect(() => {
    if (holdings.length < 3) { setR(null); setError(null); return undefined; }
    const ctl = new AbortController();
    setBusy(true);
    setError(null);
    runJob("xray", {}, { signal: ctl.signal })
      .then(setR)
      .catch((e) => e.name !== "AbortError" && setError(e))
      .finally(() => setBusy(false));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <section className="panel stack" style={{ "--gap": "16px" }}>
      <div>
        <div className="row" style={{ gap: 10 }}><h2 className="h3">Portfolio X-Ray</h2><span className="badge pro">AI · Clustering + PCA</span></div>
        <p className="muted small" style={{ maxWidth: 800 }}>
          How many truly different bets do you own? The AI studies how your stocks move together, groups them without being told any sectors, and shows where your risk is really hiding.
        </p>
      </div>
      {holdings.length < 3 && <p className="muted" style={{ margin: 0 }}>Add at least 3 stocks to see how your risk is grouped.</p>}
      <ErrorNote error={error} />
      {busy && !r && holdings.length >= 3 && <Skeleton h={200} />}
      {r && <Body r={r} />}
    </section>
  );
}

function Body({ r }) {
  const maxBar = Math.max(...r.holdings.map((h) => Math.max(h.weight, h.riskShare)));
  return (
    <>
      <div className="row" style={{ gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{fmt.num(r.effectiveBets, 1)}<span className="muted" style={{ fontSize: 18, fontWeight: 500 }}> real bets out of {r.n} stocks</span></div>
        </div>
        <span className={`badge ${GRADE_TONE[r.grade]}`} style={{ fontSize: 13, height: 26, padding: "0 12px" }}>{r.grade}</span>
      </div>
      <p style={{ margin: 0, maxWidth: 820 }}>{r.plain}</p>

      <div className="metrics">
        <Metric label="Portfolio volatility" value={fmt.pctAbs(r.risk.annualVol, 1)} formula="annualised, from your actual weights" />
        <Metric label="Diversification benefit" value={`${fmt.num(r.risk.diversificationRatio, 2)}×`} formula="average stock risk ÷ portfolio risk" />
        <Metric label="One common driver" value={fmt.pctAbs(r.pc1Share, 0)} formula="share of all movement explained by PC1" />
        <Metric label="Groups found" value={String(r.clusters.k)} formula={`silhouette ${fmt.num(r.clusters.silhouette, 2)}`} />
      </div>

      {r.danger && (
        <div className="notice sim">
          <span className="amber">●</span>
          <span><b>Hidden danger: {short(r.danger.symbol)}.</b> It is {fmt.pctAbs(r.danger.weight, 0)} of your money but carries {fmt.pctAbs(r.danger.riskShare, 0)} of your risk, because it is volatile and moves with your other stocks.</span>
        </div>
      )}

      <div className="grid g2" style={{ alignItems: "start" }}>
        <div className="stack" style={{ "--gap": "12px" }}>
          <div className="faint small">Groups the AI found (by how they move together)</div>
          {r.clusters.groups.map((g, k) => (
            <div key={k} style={{ borderLeft: `4px solid ${PALETTE[k % PALETTE.length]}`, background: "var(--panel-2)", borderRadius: 10, padding: "10px 14px" }}>
              <div className="spread small"><b>{g.members.map((m) => short(m.symbol)).join(" · ")}</b><span className="faint">{g.avgCorrelation == null ? "alone" : `avg. correlation ${fmt.num(g.avgCorrelation, 2)}`}</span></div>
              <div className="small muted" style={{ marginTop: 4 }}>{fmt.pctAbs(g.weight, 0)} of your money · <b style={{ color: g.riskShare > g.weight + 0.05 ? C.down : undefined }}>{fmt.pctAbs(g.riskShare, 0)} of your risk</b></div>
            </div>
          ))}
        </div>

        <div className="stack" style={{ "--gap": "8px" }}>
          <div className="faint small">Money vs risk, stock by stock <span style={{ color: C.muted }}>■</span> money <span style={{ color: C.amber }}>■</span> risk</div>
          {r.holdings.map((h) => (
            <div key={h.symbol}>
              <div className="spread small"><b>{short(h.symbol)}</b><span className="faint">{fmt.pctAbs(h.weight, 0)} money · {fmt.pctAbs(h.riskShare, 0)} risk</span></div>
              <div style={{ height: 5, background: C.rule, borderRadius: 3, marginBottom: 2 }}><div style={{ width: `${(h.weight / maxBar) * 100}%`, height: "100%", background: C.muted, borderRadius: 3 }} /></div>
              <div style={{ height: 5, background: C.rule, borderRadius: 3 }}><div style={{ width: `${(h.riskShare / maxBar) * 100}%`, height: "100%", background: C.amber, borderRadius: 3 }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="faint small" style={{ marginBottom: 6 }}>What if you trimmed a stock by a quarter and spread the money across the others?</div>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Trim</th><th className="r">Now</th><th className="r">Share of risk</th><th className="r">Portfolio risk falls by</th></tr></thead>
            <tbody>
              {r.trims.slice(0, 4).map((t) => (
                <tr key={t.symbol}><td><b>{short(t.symbol)}</b></td><td className="r">{fmt.pctAbs(t.weight, 0)}</td><td className="r">{fmt.pctAbs(t.riskShare, 0)}</td><td className={`r ${t.riskCut > 0 ? "up" : ""}`}>{fmt.pctAbs(Math.max(0, t.riskCut), 1)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="faint small" style={{ margin: 0 }}>
        Method: PCA on the correlation matrix (effective bets = exp of the entropy of the eigenvalue shares), average-linkage clustering with the group count chosen by silhouette score, and Euler risk attribution wᵢ(Σw)ᵢ/σ². Based on {fmt.num(r.observations, 0)} shared trading days. Not advice.
      </p>
    </>
  );
}
