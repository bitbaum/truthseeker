// Orchestrator — combines article-fetch + LLM + prompt into one call.
// Both the HTTP route and the CLI script consume this; the API surface
// for "given a URL, produce an analysis" lives here so neither caller has
// to know about Groq or HTML stripping.

import { fetchArticle, type FetchedArticle } from "./article-fetch";
import { callLLM } from "./llm";
import { ANALYSIS_SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

export interface CoreClaim {
  claim: string;
  type: "factual" | "normative" | "causal";
  supported_in_article: boolean;
  evidence_quality: "strong" | "moderate" | "weak" | "asserted";
}

export interface NamedSource {
  name: string;
  role: string;
  attributed_claim: string;
}

export interface Analysis {
  title: string;
  author: string | null;
  publication: string;
  publication_date: string | null;
  language: string;
  summary: string;
  core_claims: CoreClaim[];
  first_principles_critique: string;
  named_sources: NamedSource[];
  biases_to_consider: string;
  what_would_change_assessment: string;
}

export interface AnalysisResult {
  analysis: Analysis;
  fetched: Pick<FetchedArticle, "url" | "status" | "title" | "textLength">;
  /** True when the article text exceeded MAX_CHARS and was cut before reaching the model. */
  truncated: boolean;
  /** Tokens / words / etc. that the caller might want to surface in the UI. */
  durationMs: number;
}

export async function analyzeUrl(url: string): Promise<AnalysisResult> {
  const fetched = await fetchArticle(url);

  if (fetched.status >= 400) {
    throw new Error(`Could not fetch article (HTTP ${fetched.status}). Some sites block bots — try downloading the article and pasting its text instead.`);
  }
  if (fetched.textLength < 200) {
    throw new Error(`Article body was too short (${fetched.textLength} chars after cleaning). The page may require JavaScript or paywall login.`);
  }

  return analyzeText({
    url: fetched.url,
    title: fetched.title,
    text: fetched.text,
    fetchedStatus: fetched.status,
  });
}

/**
 * Analyze pre-fetched article text. Use this when the source URL is bot-gated
 * (Republik, paywalls) and the body has to be retrieved out-of-band — paste
 * the body into the UI textarea, or save it from a logged-in browser and feed
 * it in via the CLI's --text flag.
 */
export async function analyzeText(opts: {
  url: string;
  title: string | null;
  text: string;
  /** Optional — surfaced in the result for caller diagnostics. */
  fetchedStatus?: number;
}): Promise<AnalysisResult> {
  const start = Date.now();
  if (!opts.text || opts.text.trim().length < 200) {
    throw new Error(`Article text was too short (${opts.text?.length ?? 0} chars). Need at least 200 chars of body to analyze meaningfully.`);
  }

  // Cap the article text we send. The model's context window is large, but
  // this Groq org's on_demand tier caps at 12,000 tokens/minute (prompt +
  // completion combined) — the real constraint, not the model. Budget:
  // ~750 tokens system+wrapper overhead, 4000 reserved for the completion,
  // leaving ~7000 tokens (~3.3 chars/token, conservative for dense prose)
  // for article text.
  const MAX_CHARS = 20_000;
  const truncated = opts.text.length > MAX_CHARS;
  const articleText = truncated
    ? opts.text.slice(0, MAX_CHARS) + "\n[...truncated]"
    : opts.text;

  const completion = await callLLM(
    buildUserPrompt({
      url: opts.url,
      htmlTitle: opts.title,
      articleText,
    }),
    {
      systemPrompt: ANALYSIS_SYSTEM_PROMPT,
      maxTokens: 4000,
      temperature: 0.2,
      jsonMode: true,
    },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(completion);
  } catch {
    throw new Error(
      `LLM returned non-JSON output (this is a model quirk — usually fixed by retrying). First 300 chars: ${completion.slice(0, 300)}`,
    );
  }

  const analysis = validateAnalysisShape(parsed);

  return {
    analysis,
    fetched: {
      url: opts.url,
      status: opts.fetchedStatus ?? 200,
      title: opts.title,
      // Length actually sent to the model, not the raw fetched/pasted length —
      // otherwise the UI reports a char count larger than what was analyzed.
      textLength: Math.min(opts.text.length, MAX_CHARS),
    },
    truncated,
    durationMs: Date.now() - start,
  };
}

const CLAIM_TYPES = new Set(["factual", "normative", "causal"]);
const EVIDENCE_QUALITIES = new Set(["strong", "moderate", "weak", "asserted"]);

/**
 * The LLM call above uses Groq's JSON mode, which only guarantees syntactically
 * valid JSON — not that it matches the Analysis shape. A response missing
 * core_claims/named_sources, or using a claim `type` outside the enum, parses
 * fine and then throws deep in React rendering (page.tsx calls .map()/.length
 * on those arrays and indexes CLAIM_TYPES by `type` unconditionally) — a crash
 * with no readable error. Validate here so a bad response fails the same clear,
 * catchable way a non-JSON response already does.
 */
function validateAnalysisShape(v: unknown): Analysis {
  const fail = (why: string): never => {
    throw new Error(`LLM returned malformed analysis JSON (${why}). Try again.`);
  };

  if (typeof v !== "object" || v === null) return fail("not an object");
  const a = v as Record<string, unknown>;

  const str = (k: string) => typeof a[k] === "string";
  const strOrNull = (k: string) => a[k] === null || typeof a[k] === "string";

  if (!str("title")) return fail("title missing");
  if (!strOrNull("author")) return fail("author must be string or null");
  if (!str("publication")) return fail("publication missing");
  if (!strOrNull("publication_date")) return fail("publication_date must be string or null");
  if (!str("language")) return fail("language missing");
  if (!str("summary")) return fail("summary missing");
  if (!str("first_principles_critique")) return fail("first_principles_critique missing");
  if (!str("biases_to_consider")) return fail("biases_to_consider missing");
  if (!str("what_would_change_assessment")) return fail("what_would_change_assessment missing");

  if (!Array.isArray(a.core_claims)) return fail("core_claims is not an array");
  for (const c of a.core_claims as unknown[]) {
    if (typeof c !== "object" || c === null) return fail("a core_claims entry is not an object");
    const claim = c as Record<string, unknown>;
    if (typeof claim.claim !== "string") return fail("a core_claims entry is missing 'claim'");
    if (!CLAIM_TYPES.has(claim.type as string)) return fail(`a core_claims entry has invalid type '${claim.type}'`);
    if (typeof claim.supported_in_article !== "boolean")
      return fail("a core_claims entry's supported_in_article is not a boolean");
    if (!EVIDENCE_QUALITIES.has(claim.evidence_quality as string))
      return fail(`a core_claims entry has invalid evidence_quality '${claim.evidence_quality}'`);
  }

  if (!Array.isArray(a.named_sources)) return fail("named_sources is not an array");
  for (const s of a.named_sources as unknown[]) {
    if (typeof s !== "object" || s === null) return fail("a named_sources entry is not an object");
    const source = s as Record<string, unknown>;
    if (typeof source.name !== "string") return fail("a named_sources entry is missing 'name'");
    if (typeof source.role !== "string") return fail("a named_sources entry is missing 'role'");
    if (typeof source.attributed_claim !== "string")
      return fail("a named_sources entry is missing 'attributed_claim'");
  }

  return a as unknown as Analysis;
}
