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
  const articleText = opts.text.length > MAX_CHARS
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

  let analysis: Analysis;
  try {
    analysis = JSON.parse(completion) as Analysis;
  } catch {
    throw new Error(
      `LLM returned non-JSON output (this is a model quirk — usually fixed by retrying). First 300 chars: ${completion.slice(0, 300)}`,
    );
  }

  return {
    analysis,
    fetched: {
      url: opts.url,
      status: opts.fetchedStatus ?? 200,
      title: opts.title,
      textLength: opts.text.length,
    },
    durationMs: Date.now() - start,
  };
}
