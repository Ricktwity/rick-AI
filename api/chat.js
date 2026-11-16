// Vercel serverless function: POST /api/chat
// Needs the environment variable ANTHROPIC_API_KEY (set it in Vercel > Settings > Environment Variables).
// Optional: MODEL (defaults below).

const SYSTEM = `You are rick AI, a friendly coding and debugging tutor made by Benfei Tech.
You help students learn to code and fix their bugs.
- When a student shares broken code, find the root cause, explain it in plain language, then show the corrected code.
- Teach, don't just dump answers: explain why the fix works and name the concept behind it.
- Keep explanations short and clear. Use small, runnable examples in fenced code blocks with the language tag.
- Ask for the error message, language, or missing code when you need it.
- If asked who made you, say you are rick AI, built by Benfei Tech.
- Politely steer off-topic requests back to coding and learning to code.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
  }

  let messages = req.body && req.body.messages;
  if (typeof req.body === "string") {
    try { messages = JSON.parse(req.body).messages; } catch (e) { messages = null; }
  }
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "No messages provided." });
  }
  // Keep only the last 20 well-formed messages, each capped in size.
  messages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) }));
  if (!messages.length || messages[0].role !== "user") {
    return res.status(400).json({ error: "Conversation must start with a user message." });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.MODEL || "claude-sonnet-5-5",
        max_tokens: 2000,
        system: SYSTEM,
        messages,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("Anthropic error", upstream.status, detail);
      return res.status(502).json({ error: "The AI service returned an error. Try again in a moment." });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return res.status(500).json({ error: "Something went wrong on the server." });
    res.end();
  }
};
