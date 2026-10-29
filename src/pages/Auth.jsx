import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Logo, ErrorNote } from "../components/ui";

export default function Auth({ mode }) {
  const isSignup = mode === "signup";
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isSignup) await register(form.email, form.password, form.name || undefined);
      else await login(form.email, form.password);
      navigate("/dashboard");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="wrap">
      <div style={{ padding: "18px 0" }}><Logo /></div>
      <form className="panel auth-card stack" style={{ "--gap": "14px" }} onSubmit={submit}>
        <h1 className="h2">{isSignup ? "Create your account" : "Sign in"}</h1>
        <p className="muted" style={{ marginTop: 6 }}>{isSignup ? "Save a watchlist and unlock Pro tools." : "Welcome back."}</p>
        {isSignup && (
          <label className="field">Name
            <input className="input" value={form.name} onChange={set("name")} autoComplete="name" />
          </label>
        )}
        <label className="field">Email
          <input className="input" type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
        </label>
        <label className="field">Password
          <input className="input" type="password" required minLength={isSignup ? 8 : 1} value={form.password} onChange={set("password")} autoComplete={isSignup ? "new-password" : "current-password"} />
          {isSignup && <span className="faint small">At least 8 characters.</span>}
        </label>
        <ErrorNote error={error} />
        <button className="btn primary" style={{ width: "100%" }} disabled={busy}>{busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}</button>
        <p className="small muted" style={{ textAlign: "center" }}>
          {isSignup ? <>Already have an account? <Link to="/login">Sign in</Link></> : <>New to QuantLens? <Link to="/signup">Create an account</Link></>}
        </p>
      </form>
    </div>
  );
}
