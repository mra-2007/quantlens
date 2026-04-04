export async function getAnalysis(data) {
  if (!data || !data.name) return fallback();

  const prompt = `
Company: ${data.name}
Current Price: ${data.price || "unknown"}
Investment: ${data.amount || "not provided"}

Return ONLY JSON:
{
  "verdict": "INVEST or AVOID",
  "summary": "short explanation",
  "scores": {
    "market": 0,
    "team": 0,
    "scalability": 0,
    "competition": 0,
    "financials": 0,
    "innovation": 0,
    "risk": 0,
    "growth": 0
  },
  "pros": [],
  "cons": []
}
`;

  try {
    const res = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://ventureiq.vercel.app",
          "X-Title": "VentureIQ",
        },
        body: JSON.stringify({
          model: "openai/gpt-3.5-turbo",
          messages: [{ role: "user", content: prompt }],
        }),
      }
    );

    if (!res.ok) {
      console.error("API STATUS:", res.status);
      return fallback();
    }

    const result = await res.json();

    if (!result || !result.choices) return fallback();

    const text = result.choices[0].message.content || "";

    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");

      if (start === -1 || end === -1) return fallback();

      return JSON.parse(text.substring(start, end + 1));
    } catch {
      return fallback();
    }

  } catch (err) {
    console.error("AI ERROR:", err);
    return fallback();
  }
}

// 🔥 SAFE FALLBACK (NEVER BREAKS UI)
function fallback() {
  return {
    verdict: Math.random() > 0.5 ? "INVEST" : "AVOID",
    summary: "Simulated result (AI fallback)",
    scores: {
      market: rand(),
      team: rand(),
      scalability: rand(),
      competition: rand(),
      financials: rand(),
      innovation: rand(),
      risk: rand(),
      growth: rand(),
    },
    pros: ["Stable outlook"],
    cons: ["Needs more validation"],
  };
}

function rand() {
  return Math.floor(Math.random() * 100);
}