"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysis";
import { CLAIM_TYPES, CLAIM_TYPE_ORDER } from "@/lib/claim-types";

type SubmitState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; result: AnalysisResult };

export default function Home() {
  const [url, setUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  async function submit(text?: string) {
    setState({ status: "loading" });
    setPastedText("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), ...(text ? { text } : {}) }),
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

  function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    submit();
  }

  function analyzeWithPastedText(e: React.FormEvent) {
    e.preventDefault();
    if (!pastedText.trim()) return;
    submit(pastedText);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12 sm:py-16">
      <header className="mb-9">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-text-muted">
          first-principles article analysis
        </p>
        <h1 className="mt-2 font-mono text-4xl font-bold tracking-tight text-text">
          truth<span className="text-brand">/</span>seeker
        </h1>
        <p className="mt-3 max-w-xl text-text-muted">
          Paste an article URL. Get a forensic breakdown — every claim tagged,
          its sources named, its biases surfaced, and a first-principles critique
          you can argue with.
        </p>
      </header>

      <form onSubmit={analyze} className="flex flex-col gap-2.5 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article-url"
          required
          className="flex-1 rounded-card border border-border bg-surface px-4 py-3 font-mono text-sm text-text placeholder-text-muted shadow-card transition-colors focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.status === "loading"}
          className="rounded-card bg-text px-6 py-3 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-bg transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {state.status === "loading" ? "Examining…" : "Examine"}
        </button>
      </form>

      {state.status === "idle" && <EmptyState />}
      {state.status === "loading" && <LoadingState />}
      {state.status === "error" && (
        <>
          <ErrorState message={state.message} />
          <PasteTextFallback
            value={pastedText}
            onChange={setPastedText}
            onSubmit={analyzeWithPastedText}
          />
        </>
      )}
      {state.status === "done" && <Result result={state.result} />}
    </main>
  );
}

/* ---------------------------------------------------------------- states -- */

function ClaimLegend() {
  return (
    <dl className="grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3">
      {CLAIM_TYPE_ORDER.map((t) => {
        const c = CLAIM_TYPES[t];
        return (
          <div key={t} className="bg-surface px-4 py-3">
            <dt className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${c.dot}`} />
              <span className={`font-mono text-xs font-semibold uppercase tracking-wider ${c.text}`}>
                {c.label}
              </span>
            </dt>
            <dd className="mt-1 text-xs text-text-muted">{c.gloss}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function EmptyState() {
  return (
    <section className="mt-10 space-y-6">
      <div className="rule-forensic h-px w-full" />
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-muted">
        How it reads an article
      </p>
      <p className="max-w-xl text-sm text-text-muted">
        truthseeker doesn&apos;t tell you whether an article is true. It exposes
        its <span className="text-text">structure</span> so you can judge it
        yourself. Every load-bearing claim is sorted into one of three kinds:
      </p>
      <ClaimLegend />
      <ol className="space-y-2 font-mono text-xs text-text-muted">
        {[
          "Extracts the core claims and tags each by type",
          "Names every source the article leans on",
          "Surfaces the author's and publication's likely biases",
          "Writes a first-principles critique — and what would change it",
        ].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="text-brand">{String(i + 1).padStart(2, "0")}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LoadingState() {
  return (
    <section className="mt-10 space-y-4">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.15em] text-text">
          Examining
        </p>
      </div>
      <ul className="space-y-1.5 font-mono text-xs text-text-muted">
        <li>→ fetching and cleaning article body</li>
        <li>→ extracting claims, sorting by type</li>
        <li>→ tracing sources and biases</li>
      </ul>
      <p className="text-xs text-text-muted">Usually 5–15 seconds.</p>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="mt-8 rounded-card border-l-2 border-flag bg-flag-soft px-4 py-3">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-flag">
        Examination halted
      </p>
      <p className="mt-1.5 text-sm text-text">{message}</p>
    </div>
  );
}

function PasteTextFallback({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-2.5">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-muted">
        Or paste the article text directly
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste the article body here — copy it from a logged-in browser tab if the site blocked the fetch."
        rows={8}
        className="w-full rounded-card border border-border bg-surface px-4 py-3 font-mono text-xs text-text placeholder-text-muted shadow-card transition-colors focus:border-brand focus:outline-none"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="rounded-card bg-text px-6 py-3 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-bg transition-opacity hover:opacity-85 disabled:opacity-50"
      >
        Examine pasted text
      </button>
    </form>
  );
}

/* ---------------------------------------------------------------- result -- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
      {children}
    </h3>
  );
}

function Result({ result }: { result: AnalysisResult }) {
  const a = result.analysis;
  return (
    <article className="mt-10 space-y-9">
      <section className="border-l-2 border-brand pl-4">
        <h2 className="text-2xl font-semibold tracking-tight text-text">{a.title}</h2>
        <p className="mt-1.5 font-mono text-xs text-text-muted">
          {[a.author, a.publication, a.publication_date].filter(Boolean).join(" · ")}
          {a.language ? ` · ${a.language}` : ""}
        </p>
      </section>

      <section>
        <SectionLabel>Summary</SectionLabel>
        <p className="text-text">{a.summary}</p>
      </section>

      <section>
        <SectionLabel>Core claims</SectionLabel>
        <ul className="space-y-2.5">
          {a.core_claims.map((c, i) => {
            const style = CLAIM_TYPES[c.type];
            return (
              <li
                key={i}
                className={`rounded-card border border-border border-l-2 ${style.border} bg-surface px-4 py-3 shadow-card`}
              >
                <p className="text-text">{c.claim}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                  <span className={`rounded-chip px-1.5 py-0.5 ${style.chip}`}>
                    {style.label}
                  </span>
                  <span className="text-text-muted">{c.evidence_quality}</span>
                  <span className="text-text-muted">
                    {c.supported_in_article ? "· supported in article" : "· unsupported"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <SectionLabel>First-principles critique</SectionLabel>
        <div className="whitespace-pre-wrap leading-relaxed text-text">
          {a.first_principles_critique}
        </div>
      </section>

      {a.named_sources.length > 0 && (
        <section>
          <SectionLabel>Named sources</SectionLabel>
          <ul className="space-y-2.5">
            {a.named_sources.map((s, i) => (
              <li
                key={i}
                className="rounded-card border border-border bg-surface px-4 py-3 text-sm"
              >
                <p>
                  <span className="font-semibold text-text">{s.name}</span>
                  <span className="text-text-muted"> — {s.role}</span>
                </p>
                {s.attributed_claim && (
                  <p className="mt-1 border-l border-border pl-3 text-text-muted">
                    {s.attributed_claim}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionLabel>Biases to consider</SectionLabel>
        <p className="text-text">{a.biases_to_consider}</p>
      </section>

      <section>
        <SectionLabel>What would change this assessment</SectionLabel>
        <p className="text-text">{a.what_would_change_assessment}</p>
      </section>

      <footer className="rule-forensic mt-2 h-px w-full" />
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
        examined {result.fetched.textLength.toLocaleString()} chars
        {result.truncated && " (truncated — article was longer)"} · {result.durationMs}ms
      </p>
    </article>
  );
}
