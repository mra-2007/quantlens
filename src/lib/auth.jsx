import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, tokenStore } from "./api";

const AuthContext = createContext(null);

/** Loads Razorpay Checkout once, on first use. */
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load Razorpay. Check your internet connection."));
    document.body.appendChild(s);
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [billing, setBilling] = useState({ provider: "demo" });

  useEffect(() => {
    api("/billing/config").then(setBilling).catch(() => {});
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) {
      setReady(true);
      return;
    }
    api("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => tokenStore.set(null))
      .finally(() => setReady(true));
  }, []);

  const accept = useCallback((d) => {
    tokenStore.set(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const value = {
    user,
    ready,
    isPro: user?.plan === "pro",
    login: (email, password) => api("/auth/login", { method: "POST", body: { email, password } }).then(accept),
    register: (email, password, name) => api("/auth/register", { method: "POST", body: { email, password, name } }).then(accept),
    billing,
    /** Pro goes through Razorpay Checkout when the server has keys; otherwise the demo switch. */
    upgrade: async (plan = "pro") => {
      if (plan !== "pro" || billing.provider !== "razorpay") {
        return api("/auth/upgrade", { method: "POST", body: { plan } }).then(accept);
      }
      await loadRazorpay();
      const order = await api("/billing/order", { method: "POST" });
      return new Promise((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: "QuantLens",
          description: "QuantLens Pro, 1 month",
          prefill: { email: user?.email, name: user?.name ?? "" },
          theme: { color: "#F2B544" },
          handler: (resp) => api("/billing/verify", { method: "POST", body: resp }).then(accept).then(resolve, reject),
          modal: { ondismiss: () => resolve(null) },
        });
        rzp.on("payment.failed", (r) => reject(new Error(r.error?.description ?? "Payment failed")));
        rzp.open();
      });
    },
    logout: () => {
      tokenStore.set(null);
      setUser(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
