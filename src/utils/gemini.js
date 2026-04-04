export async function getAnalysis(data) {
  // 🔥 SAFETY CHECK
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
    // 🔍 DEBUG ENV VARIABLE
    console.log("ENV KEY:", import.meta.env.VITE_OPENROUTER_API_KEY);

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ventureiq.vercel.app",
        "X-Title": "VentureIQ",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await res.json();

    // 🔍 DEBUG RESPONSE
    console.log("AI RESPONSE:", result);

    const text = result?.choices?.[0]?.message?.content || "";

    // 🔥 Extract JSON safely
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1) {
      throw new Error("No JSON found");
    }

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