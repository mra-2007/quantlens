import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Outlet, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { TopBar, Skeleton } from "./components/ui";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";

// Heavier pages (charts) load on demand to keep the first paint small.
const Stock = lazy(() => import("./pages/Stock"));
const Compare = lazy(() => import("./pages/Compare"));
const Backtest = lazy(() => import("./pages/Backtest"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Dashboard = lazy(() => import("./pages/Dashboard"));

function Shell() {
  return (
    <>
      <TopBar />
      <main className="wrap page">
        <Suspense fallback={<Skeleton h={400} />}>
          <Outlet />
        </Suspense>
      </main>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Auth mode="login" />} />
          <Route path="/signup" element={<Auth mode="signup" />} />
          <Route element={<Shell />}>
            <Route path="/s/:symbol" element={<Stock />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
