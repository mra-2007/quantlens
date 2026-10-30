import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SymbolSearch } from "../components/ui";
import Evolution from "../components/lab/Evolution";

const DEFAULT = "RELIANCE.NS";

const FEATURES = [
  { key: "evolution", title: "Strategy Evolution", family: "Evolutionary AI", blurb: "Trading rules breed, mutate and compete over 25 generations. The champion is tested on years it never saw.", Component: Evolution },
];

export default function AILab() {
  const { symbol: raw } = useParams();
  const symbol = decodeURIComponent(raw ?? DEFAULT).toUpperCase();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = FEATURES.some((f) => f.key === params.get("tab")) ? params.get("tab") : FEATURES[0].key;
  const active = FEATURES.find((f) => f.key === tab);
  const Active = active.Component;

  useEffect(() => { document.title = "AI Lab / QuantLens"; }, []);

  return (
    <div className="stack" style={{ "--gap": "20px" }}>
      <div className="page-head">
        <div>
          <h1>AI Lab</h1>
          <p className="muted" style={{ maxWidth: 760 }}>Different families of machine learning, written from scratch and trained on the stock you choose. No outside AI service and no API key: every model runs on QuantLens’s own server, and every result comes with an honest test.</p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="faint small">Stock</span>
          <span className="badge" style={{ fontSize: 14, height: 28, padding: "0 12px" }}>{symbol}</span>
          <SymbolSearch className="search" placeholder="Change stock" onPick={(s) => navigate(`/ai-lab/${encodeURIComponent(s)}?tab=${tab}`)} />
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
        <Link to={`/s/${encodeURIComponent(symbol)}`} className="panel" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <div className="small" style={{ color: "var(--amber)", fontWeight: 600 }}>Unsupervised AI · Hidden Markov Model</div>
          <h3 className="h3" style={{ margin: "4px 0 6px" }}>Market regimes</h3>
          <p className="muted small" style={{ margin: 0 }}>Learns Calm, Choppy and Stress moods from returns. Shown on the stock page →</p>
        </Link>
        {FEATURES.map((f) => (
          <button key={f.key} className="panel" onClick={() => setParams({ tab: f.key })} aria-pressed={f.key === tab} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", borderColor: f.key === tab ? "var(--amber)" : undefined }}>
            <div className="small" style={{ color: "var(--amber)", fontWeight: 600 }}>{f.family}</div>
            <h3 className="h3" style={{ margin: "4px 0 6px" }}>{f.title}</h3>
            <p className="muted small" style={{ margin: 0 }}>{f.blurb}</p>
          </button>
        ))}
      </div>

      <Active key={`${tab}-${symbol}`} symbol={symbol} />
    </div>
  );
}
