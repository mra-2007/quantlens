import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export function Logo() {
  return (
    <Link to="/" className="brand" aria-label="QuantLens home">
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#18253B" />
        <path d="M5 22 C10 22 12 10 16 10 S22 18 27 8" fill="none" stroke="#F2B544" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="27" cy="8" r="2.4" fill="#E6ECF5" />
      </svg>
      QuantLens
    </Link>
  );
}

export function TopBar() {
  const { user, isPro, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        <Logo />
        <nav className="nav" aria-label="Main">
          <NavLink to="/s/AAPL">Analyze</NavLink>
          <NavLink to="/compare">Compare</NavLink>
          <NavLink to="/backtest">Backtest</NavLink>
          <NavLink to="/portfolio">Optimiser</NavLink>
          {user && <NavLink to="/my-portfolio">My portfolio</NavLink>}
          {user && <NavLink to="/dashboard">Dashboard</NavLink>}
        </nav>
        <SymbolSearch className="search" />
        <div className="row" style={{ flexShrink: 0, gap: 8 }}>
          {user ? (
            <>
              {isPro ? <span className="badge pro">Pro</span> : <Link to="/dashboard#plan" className="btn sm primary">Go Pro</Link>}
              <button className="btn sm ghost" onClick={() => { logout(); navigate("/"); }}>Sign out</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn sm ghost">Sign in</Link>
              <Link to="/signup" className="btn sm primary">Create account</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const SearchIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

/** Debounced symbol autocomplete. Enter on raw text goes straight to that ticker. */
export function SymbolSearch({ className = "search", placeholder = "Search a stock or ticker", onPick, autoFocus, iconSize }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const boxRef = useRef(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api(`/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal })
        .then((d) => {
          setResults(d.results);
          setActive(0);
        })
        .catch(() => {});
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const pick = (symbol) => {
    setQ("");
    setOpen(false);
    if (onPick) onPick(symbol);
    else navigate(`/s/${encodeURIComponent(symbol)}`);
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Escape") setOpen(false);
    if (e.key === "Enter") {
      const chosen = results[active]?.symbol ?? q.trim().toUpperCase();
      if (chosen) pick(chosen);
    }
  };

  return (
    <div className={className} ref={boxRef}>
      <SearchIcon size={iconSize} />
      <input
        className="input"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        aria-label="Search stocks"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="search-results"
      />
      {open && results.length > 0 && (
        <div className="search-menu" id="search-results" role="listbox">
          {results.map((r, i) => (
            <button key={r.symbol} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => pick(r.symbol)}>
              <span className="sym">{r.symbol}</span>
              <span className="nm">{r.name}{r.exchange ? ` / ${r.exchange}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Metric({ label, value, formula, tone, hint }) {
  return (
    <div className="metric" title={hint}>
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ""}`}>{value}</div>
      {formula && <div className="formula">{formula}</div>}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="notice error" role="alert">{error.message ?? String(error)}</div>;
}

export function SimNote({ show }) {
  if (!show) return null;
  return (
    <div className="notice sim">
      <span className="amber">●</span>
      <span>Prices here are simulated because the server runs in demo mode (DATA_PROVIDER=demo). Set it to <b>yahoo</b> for live market data.</span>
    </div>
  );
}

/** Shown in place of Pro features for free or signed-out users. */
export function ProGate({ title, children }) {
  const { user, upgrade, billing } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  return (
    <div className="panel gate">
      <span className="badge pro">Pro</span>
      <h2 className="h2" style={{ marginTop: 14 }}>{title}</h2>
      <p className="muted">{children}</p>
      {user ? (
        <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await upgrade("pro"); } catch (e) { setErr(e); } finally { setBusy(false); } }}>
          {busy ? "Opening checkout…" : billing.provider === "razorpay" ? "Upgrade to Pro for ₹399/month" : "Upgrade to Pro"}
        </button>
      ) : (
        <div className="row" style={{ justifyContent: "center" }}>
          <Link to="/signup" className="btn primary">Create a free account</Link>
          <Link to="/login" className="btn">Sign in</Link>
        </div>
      )}
      {err && <div style={{ maxWidth: 420, margin: "16px auto 0" }}><ErrorNote error={err} /></div>}
      <p className="faint small" style={{ marginTop: 16 }}>
        {billing.provider === "razorpay" ? (billing.testMode ? "Payments run in Razorpay test mode. Use a test card or UPI ID; no money is charged." : "Secure payment by Razorpay.") : "Demo mode: upgrading is instant and free because payments aren't configured on the server."}
      </p>
    </div>
  );
}

export function Seg({ value, options, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** Recharts tooltip in the house style. */
export function ChartTip({ active, payload, label, format = (v) => v, labelFormat = (l) => l, filter = () => true }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tt">
      <div className="faint" style={{ marginBottom: 4 }}>{labelFormat(label)}</div>
      {payload.filter((p) => p.value != null && !p.hide && filter(p)).map((p) => (
        <div className="tt-row" key={p.dataKey}>
          <span style={{ color: p.color ?? p.stroke }}>{p.name}</span>
          <b>{format(p.value, p.dataKey)}</b>
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ h = 120 }) {
  return <div className="skeleton" style={{ height: h }} />;
}
