import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState([]);

  useEffect(() => {
    setPortfolio([
      { name: "Tesla", invested: 500, current: 620 },
      { name: "Apple", invested: 400, current: 380 },
      { name: "Amazon", invested: 300, current: 450 },
    ]);
  }, []);

  const totalInvested = portfolio.reduce((a, b) => a + b.invested, 0);
  const totalCurrent = portfolio.reduce((a, b) => a + b.current, 0);
  const profit = totalCurrent - totalInvested;

  const isProfit = profit >= 0;

  return (
    <div className="relative min-h-screen bg-black text-white p-6 overflow-hidden">

      {/* 🌌 BACKGROUND */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute w-[500px] h-[500px] bg-purple-500 blur-[150px] opacity-20"></div>
        <div className="absolute w-[500px] h-[500px] bg-blue-500 blur-[150px] opacity-20 bottom-0 right-0"></div>
      </div>

      {/* TITLE */}
      <motion.h1
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-4xl font-bold mb-6"
      >
        Portfolio Dashboard
      </motion.h1>

      {/* SUMMARY */}
      <div className="bg-white/5 backdrop-blur-xl p-6 rounded-2xl mb-6 border border-white/10">
        <p>Total Invested: ${totalInvested}</p>
        <p>Current Value: ${totalCurrent}</p>

        <p className={isProfit ? "text-green-400" : "text-red-400"}>
          Profit: ${profit}
        </p>
      </div>

      {/* CARDS */}
      <div className="grid md:grid-cols-3 gap-6">
        {portfolio.map((item, i) => {
          const gain = item.current - item.invested;

          return (
            <motion.div
              key={i}
              whileHover={{ scale: 1.05 }}
              className="bg-white/5 backdrop-blur-xl p-5 rounded-2xl border border-white/10"
            >
              <h3 className="text-xl">{item.name}</h3>
              <p>${item.invested} → ${item.current}</p>

              <p className={gain >= 0 ? "text-green-400" : "text-red-400"}>
                {gain >= 0 ? "Profit" : "Loss"}: ${gain}
              </p>
            </motion.div>
          );
        })}
      </div>

      {/* AI STYLE INSIGHT */}
      <div className="mt-10 bg-white/5 backdrop-blur-xl p-6 rounded-2xl border border-white/10">
        <h2 className="text-xl mb-2">Portfolio Insight</h2>

        <p className="text-gray-300">
          {isProfit
            ? "Your portfolio is performing well. Consider diversification for stability."
            : "Your portfolio is underperforming. Consider reallocating assets."}
        </p>
      </div>

    </div>
  );
}