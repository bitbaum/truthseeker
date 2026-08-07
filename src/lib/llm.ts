// Groq client — single source of truth for the model + endpoint.
// Adapted from FleetCrown's src/lib/groq.ts. If we ever swap LLM providers
// (Claude, OpenAI, local), this is the one file to change.

export const LLM_MODEL = "llama-3.3-70b-versatile";
const LLM_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface LLMOptions {
  /** Max tokens in the completion. Default 4000 — generous for structured JSON. */
  maxTokens?: number;
  /** Temperature. Default 0.2 — deterministic enough for structured analysis. */
  temperature?: number;
  /** Abort timeout in ms. Default 35_000. Sized to leave headroom under the
   *  API route's 60s maxDuration once article-fetch's own 20s timeout is
   *  added — see the budget note in route.ts. */
  timeoutMs?: number;
  /** System prompt prepended to the messages. */
  systemPrompt?: string;
  /** Force JSON object response (OpenAI-compatible flag). */
  jsonMode?: boolean;
}

/**
 * Single text-in, text-out call. Throws on missing key, HTTP error, or timeout.
 * Callers handle parsing for their own structured-output shape.
 */
export async function callLLM(prompt: string, opts: LLMOptions = {}): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set in environment");

  const {
    maxTokens = 4000,
    temperature = 0.2,
    timeoutMs = 35_000,
    systemPrompt,
    jsonMode,
  } = opts;

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(LLM_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}
