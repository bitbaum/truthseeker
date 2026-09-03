// LLM client — single source of truth for HOW this app calls a model.
//
// It is deliberately no longer the source of truth for WHICH model. It used to
// be, and that is what broke it: `LLM_MODEL` pinned `llama-3.3-70b-versatile`,
// Groq retired the entire llama-3.x family, and every analysis in this app
// answered HTTP 404 with a key that was perfectly valid. Nothing here was
// wrong when it was written; a constant simply cannot stay true about someone
// else's catalogue.
//
// So the ids come from `ai-kit`, which carries one list for the whole fleet and
// re-probes it against the live catalogues, and a daily audit
// (dotfiles/scripts/ci/model-pin-audit.mjs) asks both vendors whether those ids
// still exist. One place to fix the next retirement instead of six.
//
// And the chain is walked, not merely consulted. A retired id, a busy model or
// a spent daily budget steps aside for the next link rather than surfacing as a
// failed analysis. Crossing VENDORS is the half that matters: a smaller model
// at the same vendor draws on the same org-wide daily budget, so when that runs
// dry every same-vendor "fallback" is already dead. Set OPENROUTER_API_KEY
// alongside GROQ_API_KEY and this app gains a second meter; with one key it
// still gets the model-level fallback, which is what rot actually looks like.

import { freeChain, usableChain, type Env, type Link } from "@bitbaum/ai-kit";
import { recordLLMFailure, recordLLMSuccess } from "./health";

/** Prefix for this app's per-vendor model overrides (TRUTHSEEKER_GROQ_MODELS…). */
const CHAIN_PREFIX = "TRUTHSEEKER";

/**
 * The links this process can actually walk, given the keys in `env`.
 * Empty means no vendor is configured — the one thing a caller can usefully
 * check BEFORE spending twenty seconds fetching an article it cannot analyze.
 *
 * Exported because the CLI needs exactly that preflight, and the version it
 * used to carry (`if (!process.env.GROQ_API_KEY) exit(1)`) was a second, hand-
 * written answer to a question this module already answers. It went stale the
 * moment a second vendor could serve this app: an OpenRouter-only environment
 * runs fine through the HTTP route and was refused at the CLI door.
 */
export function configuredLinks(env: Env = process.env): Link[] {
  return usableChain(freeChain(CHAIN_PREFIX), env);
}

/**
 * What to set when nothing is set — named by the chain rather than by hand.
 * A literal list of key names is the same defect as a pinned model id: it is a
 * constant claiming to be true about a catalogue it does not own, and it goes
 * quietly wrong the day the fleet chain gains a vendor.
 */
export function noProviderMessage(): string {
  const keys = [...new Set(freeChain(CHAIN_PREFIX).map((p) => p.keyEnv))];
  return `No LLM provider configured: set ${keys.join(" or ")}`;
}

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
  // `usableChain` drops any vendor whose key is absent, so a deployment with
  // only GROQ_API_KEY gets a Groq-only chain rather than links that would 401
  // on every request.
  const links = configuredLinks();
  if (links.length === 0) {
    const error = new Error(noProviderMessage());
    recordLLMFailure(error);
    throw error;
  }

  const { maxTokens = 4000, temperature = 0.2, timeoutMs = 35_000, systemPrompt, jsonMode } = opts;

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  // The timeout is PER LINK, not for the walk as a whole. Sharing one deadline
  // across the chain would let a first vendor that hangs consume the budget of
  // every fallback behind it, which is the case the fallback exists for.
  let lastError: Error | null = null;

  // Vendors that answered "this key is not valid". Every remaining link at such
  // a vendor would send the SAME key and get the same answer, so the walk skips
  // them instead of spending a request to be told twice.
  const rejected = new Map<string, { providerId: string; status: number }>();

  for (const link of links) {
    const key = process.env[link.provider.keyEnv];
    if (!key) continue;
    if (rejected.has(link.provider.keyEnv)) continue;

    try {
      const res = await fetch(`${link.provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: link.model,
          messages,
          max_tokens: maxTokens,
          temperature,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastError = new Error(
          `LLM HTTP ${res.status} at ${link.provider.id}/${link.model}: ${body.slice(0, 200)}`,
        );
        // A rejected key is the one verdict that is about the VENDOR rather
        // than the model: 401/403 says "not you", and every further link at
        // this vendor presents the identical key. Note it and let the loop skip
        // them — while still crossing to the next vendor, which is a different
        // key and the whole reason the chain spans vendors.
        //
        // Everything else falls through link by link. A 404 is a retired id, a
        // 429 a busy or spent model, a 5xx a vendor being unwell — all three
        // are answered by asking a DIFFERENT model, which is what the next link
        // is. Widening this skip beyond auth would quietly turn the chain back
        // into the pin it replaced.
        if (AUTH_REJECTED.has(res.status)) {
          rejected.set(link.provider.keyEnv, {
            providerId: link.provider.id,
            status: res.status,
          });
        }
        continue;
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = (data?.choices?.[0]?.message?.content ?? "").trim();
      // A 200 carrying empty content is a failure that reads like success —
      // one free model was observed doing exactly this. Treat it as a miss and
      // let the next link answer, rather than returning "" to the caller.
      if (!content) {
        lastError = new Error(`LLM returned empty content at ${link.provider.id}/${link.model}`);
        continue;
      }
      recordLLMSuccess();
      return content;
    } catch (err) {
      // Timeout or transport failure. Same reasoning: the next link is a
      // different model and possibly a different vendor.
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // When every vendor rejected its key, the walk is not the story — the key is.
  // "LLM chain exhausted … Last: HTTP 401" is true and useless: it reads as an
  // outage at someone else's shop, and the reader goes looking for one. The
  // fact worth surfacing is that a credential this app holds was refused, and
  // what to do about it.
  const configuredVendors = new Set(links.map((l) => l.provider.keyEnv));
  if (rejected.size > 0 && rejected.size === configuredVendors.size) {
    const error = new Error(
      `${rejectedKeyMessage(rejected)} ${secondVendorHint(configuredVendors)}`.trim(),
    );
    recordLLMFailure(error);
    throw error;
  }

  // Otherwise: name the whole chain, not just the last link. "gpt-oss-120b
  // failed" sends the reader after one model; "all 2 links failed" says the
  // shape of the problem is the key, the network or the budget.
  const exhausted = new Error(
    `LLM chain exhausted — all ${links.length} link(s) failed. Last: ${lastError?.message ?? "unknown"}`,
  );
  recordLLMFailure(exhausted);
  throw exhausted;
}

/** HTTP statuses that mean "this key", not "this model". */
const AUTH_REJECTED = new Set([401, 403]);

function rejectedKeyMessage(rejected: Map<string, { providerId: string; status: number }>): string {
  const named = [...rejected.entries()]
    .map(([keyEnv, r]) => `${keyEnv} (${r.providerId}, HTTP ${r.status})`)
    .join("; ");
  const subject = rejected.size === 1 ? "key was" : "keys were";
  return `LLM ${subject} rejected by the vendor: ${named}. Replace it — the chain never got as far as a model.`;
}

/**
 * The vendors this app could reach but currently has no key for. Derived from
 * the chain, so it stays true as the fleet chain grows — and it is the actual
 * remedy for a rejected key, not a nicety: a second vendor is a second
 * credential AND a second daily budget.
 */
function secondVendorHint(configured: Set<string>): string {
  const unconfigured = [...new Set(freeChain(CHAIN_PREFIX).map((p) => p.keyEnv))].filter(
    (keyEnv) => !configured.has(keyEnv),
  );
  if (unconfigured.length === 0) return "";
  return `Setting ${unconfigured.join(" or ")} would also give this app a second vendor to fall back to.`;
}
