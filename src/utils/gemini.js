export async function getAnalysis(data) {
  // 🔥 SAFETY CHECK (PREVENTS CRASH)
  if (!data || !data.name) {
    return {
      verdict: "UNKNOWN",
      summary: "No valid company provided",
      scores: {
        market: 50,
        team: 50,
        scalability: 50,
        competition: 50,
        financials: 50,
        innovation: 50,
        risk: 50,
        growth: 50,
      },
      pros: ["No data"],
      cons: ["Invalid input"],
    };
  }

  const prompt = `
Analyze the startup: ${data.name}

Score EACH parameter from 0 to 100.

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
        Authorization: "Bearer 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",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await res.json();
    const text = result.choices?.[0]?.message?.content || "";

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1) throw new Error("No JSON");

    const parsed = JSON.parse(text.substring(start, end + 1));

    return parsed;
  } catch (err) {
    console.error("AI ERROR:", err);

    return {
      verdict: "UNKNOWN",
      summary: "AI failed",
      scores: {
        market: 50,
        team: 50,
        scalability: 50,
        competition: 50,
        financials: 50,
        innovation: 50,
        risk: 50,
        growth: 50,
      },
      pros: ["Fallback"],
      cons: ["Check API"],
    };
  }
}