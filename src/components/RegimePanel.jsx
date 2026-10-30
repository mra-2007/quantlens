import { fmt, REGIME_COLORS } from "../lib/format";
import { ErrorNote, Skeleton } from "./ui";

const days = (n) => `${fmt.num(n, 0)} day${Math.round(n) === 1 ? "" : "s"}`;

/** Explains what the Hidden Markov Model found: today's regime, each regime's behaviour, and the evidence. */
export default function RegimePanel({ regime, error, loading }) {
  return (
    <section className="panel stack" style={{ "--gap": "16px" }}>
      <div className="panel-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h2 className="h3">Market regimes</h2>
            <span className="badge pro">AI</span>
          </div>
          <p className="muted small" style={{ maxWidth: 760 }}>
            A Hidden Markov Model learns three hidden “moods” of this stock from its daily returns alone, with no labels given. The shaded bands on the chart show which mood the stock was in on each day.
          </p>
        </div>
      </div>

      <ErrorNote error={error} />
      {loading && !regime && <Skeleton h={220} />}
      {regime && <Body r={regime} />}
    </section>
  );
}

function Body({ r }) {
  const { now, regimes, model } = r;
  const color = REGIME_COLORS[now.state];
  const cur = regimes[now.state];

  return (
    <>
      {!model.meaningful && (
        <div className="notice sim">
          <span className="amber">●</span>
          <span>This stock doesn’t show clearly separate regimes (the three-regime model barely beats a single bell curve, ΔBIC = {fmt.num(model.deltaBic, 0)}). Treat the labels below as weak.</span>
        </div>
      )}

      <div className="row" style={{ gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span className="badge" style={{ color, borderColor: color, fontSize: 14, height: 28, padding: "0 12px" }}>Today: {now.name}</span>
        <span className="muted">
          <b style={{ color: "var(--chalk, #E6ECF5)" }}>{fmt.pctAbs(now.prob, 0)}</b> sure, in this regime for {days(now.runDays)}. {now.name} phases last about <b style={{ color: "var(--chalk, #E6ECF5)" }}>{days(cur.expectedDuration)}</b> on average.
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Tomorrow’s odds, given today:{" "}
        {regimes.map((g, k) => (
          <span key={g.name} style={{ marginRight: 12 }}><span style={{ color: REGIME_COLORS[k] }}>●</span> {g.name} <b>{fmt.pctAbs(now.next[k], 0)}</b></span>
        ))}
      </p>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))" }}>
        {regimes.map((g, k) => (
          <div key={g.name} style={{ borderLeft: `4px solid ${REGIME_COLORS[k]}`, background: "var(--panel-2)", borderRadius: 10, padding: "12px 16px" }}>
            <div className="spread"><b style={{ color: REGIME_COLORS[k] }}>{g.name}</b><span className="faint small">{fmt.pctAbs(g.share, 0)} of days</span></div>
            <div className="stack small" style={{ "--gap": "4px", marginTop: 8 }}>
              <div className="spread"><span className="muted">Annual volatility</span><b>{fmt.pctAbs(g.annualVol, 0)}</b></div>
              <div className="spread"><span className="muted">Typical length</span><b>{days(g.expectedDuration)}</b></div>
              <div className="spread"><span className="muted">Long-run share of time</span><b>{fmt.pctAbs(g.longRunShare, 0)}</b></div>
              <div className="spread"><span className="muted" title="Noisy estimate, shown for information">Avg. yearly return*</span><b>{fmt.pct(g.annualDrift, 0)}</b></div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid g2" style={{ alignItems: "start" }}>
        <div>
          <div className="faint small" style={{ marginBottom: 6 }}>Transition matrix A: chance of tomorrow’s regime, given today’s</div>
          <table className="table">
            <thead><tr><th>From \ To</th>{regimes.map((g, k) => <th key={g.name} className="r" style={{ color: REGIME_COLORS[k] }}>{g.name}</th>)}</tr></thead>
            <tbody>
              {model.A.map((row, i) => (
                <tr key={i}>
                  <td style={{ color: REGIME_COLORS[i] }}><b>{regimes[i].name}</b></td>
                  {row.map((v, j) => <td key={j} className="r" style={i === j ? { fontWeight: 700 } : { color: "var(--muted, #8A9AB3)" }}>{fmt.pctAbs(v, 1)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stack small" style={{ "--gap": "8px" }}>
          <div className="faint">Evidence and method</div>
          <div>
            <b>{model.meaningful ? "Three regimes fit clearly better than one." : "Weak evidence for three regimes."}</b>{" "}
            <span className="muted">BIC improvement over a single Normal distribution: <b>{fmt.num(model.deltaBic, 0)}</b> (above 10 counts as very strong).</span>
          </div>
          <div className="muted">Trained on {fmt.num(model.observations, 0)} daily returns, best of {model.restarts} starting points, converged in {model.iterations} EM iterations.</div>
          <div className="math muted">r<sub>t</sub> | S<sub>t</sub> = k ~ N(μ<sub>k</sub>, σ<sub>k</sub>²) &nbsp;·&nbsp; P(S<sub>t</sub> = j | S<sub>t−1</sub> = i) = A<sub>ij</sub></div>
          <div className="faint">*Per-regime average returns are noisy estimates, so the regime-aware forecast keeps one common drift and lets only the volatility follow the regime.</div>
          <div className="muted">Fitted with Baum–Welch (expectation-maximisation). Today’s state comes from the forward algorithm, using only past data. The chart bands use the Viterbi path.</div>
        </div>
      </div>
    </>
  );
}
