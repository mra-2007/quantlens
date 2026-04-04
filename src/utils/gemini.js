export async function getAnalysis(data) {
  if (!data || !data.name) {
    return fallback();
  }

  const prompt = `
Company: ${data.name}
Current Price: ${data.price || "unknown"}

Analyze and predict:

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
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistralai/mistral-7b-instruct",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await res.json();
    const text = result?.choices?.[0]?.message?.content || "";

    let parsed;

    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");

      if (start !== -1 && end !== -1) {
        parsed = JSON.parse(text.substring(start, end + 1));
      } else {
        throw new Error();
      }
    } catch {
      parsed = fallback();
    }

    return parsed;

  } catch (err) {
    console.error("AI ERROR:", err);
    return fallback();
  }
}

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
    cons: ["Needs more data"],
  };
}

function rand() {
  return Math.floor(Math.random() * 100);
}