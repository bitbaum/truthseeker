# truthseeker

First-principles rebuttal generator. Paste any article URL, get a structured response that includes:

- the article's core claims (factual, normative, causal — separated)
- a first-principles critique of those claims
- the named sources and people quoted, with role + attribution
- potential biases of the author or publication to consider
- the article's metadata (title, author, publication, date)

Built to fight the surrender to consensus framing. The point is not to disagree by default — it is to surface the structure of an argument so a reader can engage with the load-bearing parts and ignore the rhetorical scaffolding.

## Status

v0.1 — text-only, English + German articles (LLM handles other languages too). Built as the first dogfood project on top of the FleetCrown bootstrap loop. See [the FleetCrown essay](https://fleetcrown.orangecat.ch/thoughts/from-idea-to-first-commit-the-fleetcrown-bootstrap-loop) for the design context.

Planned for v0.2+:
- public author profiles (what they have written, said, taken positions on)
- speech / video transcript analysis
- response stored at a permanent URL so the analysis accumulates
- per-claim source verification (cite to primary documents where possible)

## Run

```bash
npm install
echo "GROQ_API_KEY=gsk_..." > .env.local   # or OPENROUTER_API_KEY — either vendor alone is enough
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Paste a URL. Wait ~5-10 seconds.

## CLI (no UI needed)

```bash
npm run analyze -- "https://www.republik.ch/2026/06/05/europa-soll-aufhoeren-das-silicon-valley-zu-kopieren"
```

Writes the result as `analyses/<slug>.md` so you can review and commit it alongside the code.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind v4
- A free-model **chain** from [`ai-kit`](https://github.com/maonakamoto/ai-kit) for the analysis, walked link by link — never one pinned model. A pin is a scheduled outage: `llama-3.3-70b-versatile` was named here until Groq retired the whole llama-3.x family and every analysis started answering 404 with a perfectly valid key. Set both `GROQ_API_KEY` and `OPENROUTER_API_KEY` and the walk crosses vendors, which is the half that survives a spent daily budget; one key still buys the model-level fallback. See `src/lib/llm.ts`.

## Architecture

```
src/
├── app/
│   ├── page.tsx               URL input + result render
│   ├── api/analyze/route.ts   POST: { url } → structured analysis JSON
│   └── globals.css
├── lib/
│   ├── article-fetch.ts       HTTP + HTML → plain-text article body
│   ├── llm.ts                 Groq client (single source of truth for model + URL)
│   └── prompts.ts             The first-principles analysis system prompt
└── scripts/
    └── analyze-cli.ts         No-server CLI variant for batch / dogfood
```

The LLM call is the only paid edge. Everything else is a pure function.

## Why "first principles"?

A first-principles critique works one level lower than "I agree / I disagree." It asks: what are the actual claims here, what kind of claim is each (factual, normative, causal), and what evidence would change my read? Articles in the wild bundle all three claim types under one rhetorical posture; separating them is the bulk of the work.

This is not a tool for picking sides. It is a tool for not getting swept along by a side that does not deserve it.
