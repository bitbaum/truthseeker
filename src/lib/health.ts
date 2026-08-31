/**
 * LLM chain health — did the last analysis actually reach a model?
 *
 * `callLLM` already knows whether every link in the chain refused; this just
 * remembers that fact between requests so `/api/health` can say so before a
 * reader does. Mirrors the same `ai-kit` tracker adopted fleet-wide (evig,
 * kivvi, botsmann, hirnli, aoz-housing).
 */

import { createHealthTracker } from "ai-kit";

const tracker = createHealthTracker({ downAfter: 3 });

export function recordLLMSuccess(): void {
  tracker.recordSuccess();
}

export function recordLLMFailure(error: unknown): void {
  tracker.recordFailure(error);
}

export function getLLMHealth() {
  return tracker.getHealth();
}

export function resetLLMHealth(): void {
  tracker.reset();
}
