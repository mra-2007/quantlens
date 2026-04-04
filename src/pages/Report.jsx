import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAnalysis } from "../utils/gemini";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export default function Report() {
  const { state } = useLocation();

  const [analysis, setAnalysis] = useState(null);
  const [data, setData] = useState([]);

  useEffect(() => {
    // 🔥 DO NOT BLOCK EXECUTION — just fallback safely
    getAnalysis(state || { name: "Unknown" }).then(setAnalysis);

    let base = 100;
    const graph = Array.from({ length: 20 }, (_, i) => {
      base += Math.random() * 10 - 5;
      return {
        time: i,
        value: parseFloat(base.toFixed(2)),
      };
    });

    setData(graph);
  }, [state]);

  if (!analysis) {
    return <div className="text-white p-6">Analyzing...</div>;
  }

  const isUp =
    data.length > 1 &&
    data[data.length - 1].value > data[data.length - 2].value;

  const latestPrice = data[data.length - 1]?.value?.toFixed(2);

  return (
    <div className="relative min-h-screen bg-black text-white p-6 overflow-hidden">

      {/* 🌌 BACKGROUND GLOW */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute w-[500px] h-[500px] bg-purple-500 blur-[150px] opacity-20 top-0 left-0"></div>
        <div className="absolute w-[500px] h-[500px] bg-blue-500 blur-[150px] opacity-20 bottom-0 right-0"></div>
      </div>

      <motion.h1
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-4xl font-bold"
      >
        {state?.name || "Unknown Company"}
      </motion.h1>

      <motion.h2
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={`text-3xl mt-2 ${
          analysis.verdict === "INVEST"
            ? "text-green-400"
            : "text-red-400"
        }`}
      >
        {analysis.verdict}
      </motion.h2>

      <p className="text-gray-400 mt-2">{analysis.summary}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8">
        {Object.entries(analysis.scores).map(([key, value]) => (
          <motion.div
            key={key}
            whileHover={{ scale: 1.08 }}
            className="bg-white/5 backdrop-blur-lg border border-white/10 p-5 rounded-2xl shadow-lg"
          >
            <p className="text-gray-400 capitalize">{key}</p>
            <p className="text-2xl font-bold">{value}</p>
          </motion.div>
        ))}
      </div>

      <div className="mt-10 bg-white/5 backdrop-blur-xl p-6 rounded-2xl border border-white/10 shadow-lg">
        <h2 className="text-xl mb-2">
          Market Trend ({state?.name || "Unknown"})
        </h2>

        {latestPrice && (
          <p
            className={`text-2xl font-bold mb-4 ${
              isUp ? "text-green-400" : "text-red-400"
            }`}
          >
            ${latestPrice}
          </p>
        )}

        <LineChart width={700} height={300} data={data}>
          <CartesianGrid stroke="#222" />
          <XAxis dataKey="time" stroke="#aaa" />
          <YAxis stroke="#aaa" />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="value"
            stroke={isUp ? "#22c55e" : "#ef4444"}
            strokeWidth={4}
            dot={false}
          />
        </LineChart>
      </div>

      <div className="mt-10">
        <h3 className="text-green-400 text-xl mb-2">Strengths</h3>
        {analysis.pros.map((p, i) => (
          <p key={i}>✔ {p}</p>
        ))}
      </div>

      <div className="mt-6">
        <h3 className="text-red-400 text-xl mb-2">Risks</h3>
        {analysis.cons.map((c, i) => (
          <p key={i}>✖ {c}</p>
        ))}
      </div>

    </div>
  );
}