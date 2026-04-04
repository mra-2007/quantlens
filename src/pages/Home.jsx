import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { auth } from "../firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";

export default function Home() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  const handleSearch = () => {
    if (!query.trim()) {
      alert("Enter company name");
      return;
    }
    navigate("/report", { state: { name: query } });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white">

      {/* 🔥 NAVBAR */}
      <div className="flex justify-between items-center px-8 py-6 border-b border-white/10 backdrop-blur-md">

        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
          VentureIQ
        </h1>

        <div className="flex gap-4">
          {user ? (
            <>
              <button
                onClick={() => navigate("/dashboard")}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400"
              >
                Dashboard
              </button>

              <button
                onClick={() => signOut(auth)}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-500 to-pink-500"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => navigate("/login")}
                className="px-5 py-2 rounded-xl border border-white/20"
              >
                Login
              </button>

              <button
                onClick={() => navigate("/signup")}
                className="px-5 py-2 rounded-xl bg-white text-black"
              >
                Signup
              </button>
            </>
          )}
        </div>
      </div>

      {/* 🔍 CENTER */}
      <div className="flex flex-col items-center justify-center mt-32">

        <h1 className="text-6xl font-bold mb-10 bg-gradient-to-r from-white via-gray-300 to-gray-500 bg-clip-text text-transparent">
          Smart Investment Analyzer
        </h1>

        <div className="flex items-center w-full max-w-2xl px-6 py-5 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl">

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search companies like Tesla, Apple..."
            className="bg-transparent outline-none w-full text-lg"
          />

          <button
            onClick={handleSearch}
            className="ml-4 px-6 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500"
          >
            Search
          </button>
        </div>

        <p className="mt-6 text-gray-400 text-sm">
          AI-powered startup & stock analysis
        </p>

      </div>
    </div>
  );
}