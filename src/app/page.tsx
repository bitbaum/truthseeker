"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysis";

type SubmitState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; result: AnalysisResult };

export default function Home() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setState({ status: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ status: "done", result: body as AnalysisResult });
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "Network error",
      });
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 sm:py-20">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">truthseeker</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Paste an article URL. Get a first-principles response with the article&apos;s
          claim structure, named sources, and biases to consider.
        </p>
      </header>

      <form onSubmit={analyze} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article-url"
          required
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={state.status === "loading"}
          className="rounded-lg bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {state.status === "loading" ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      {state.status === "loading" && (
        <p className="mt-6 text-sm text-zinc-500">
          Fetching article and generating analysis — usually 5–15 seconds.
        </p>
      )}

      {state.status === "error" && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {state.message}
        </div>
      )}

      {state.status === "done" && <Result result={state.result} />}
    </main>
  );
}

function Result({ result }: { result: AnalysisResult }) {
  const a = result.analysis;
  return (
    <article className="mt-10 space-y-8">
      <section>
        <h2 className="text-xl font-semibold">{a.title}</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {[a.author, a.publication, a.publication_date].filter(Boolean).join(" · ")} · {a.language}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Summary
        </h3>
        <p className="text-zinc-800 dark:text-zinc-200">{a.summary}</p>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Core claims
        </h3>
        <ul className="space-y-3">
          {a.core_claims.map((c, i) => (
            <li key={i} className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <p className="text-zinc-800 dark:text-zinc-200">{c.claim}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {c.type} · {c.evidence_quality}
                {c.supported_in_article ? " · supported" : " · unsupported"}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          First-principles critique
        </h3>
        <div className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
          {a.first_principles_critique}
        </div>
      </section>

      {a.named_sources.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Named sources
          </h3>
          <ul className="space-y-2">
            {a.named_sources.map((s, i) => (
              <li key={i} className="text-sm text-zinc-800 dark:text-zinc-200">
                <span className="font-medium">{s.name}</span>
                <span className="text-zinc-500"> — {s.role}</span>
                {s.attributed_claim && (
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">↳ {s.attributed_claim}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Biases to consider
        </h3>
        <p className="text-zinc-800 dark:text-zinc-200">{a.biases_to_consider}</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          What would change this assessment
        </h3>
        <p className="text-zinc-800 dark:text-zinc-200">{a.what_would_change_assessment}</p>
      </section>

      <footer className="border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800">
        Fetched {result.fetched.textLength.toLocaleString()} chars · {result.durationMs}ms
      </footer>
    </article>
  );
}
