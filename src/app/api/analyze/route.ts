// POST /api/analyze
// Body: { url: string, text?: string }
// Response: { ok: true, ...AnalysisResult } | { ok: false, error: string }
//
// One route, one job. Delegates to lib/analysis. The route's only
// responsibility is request validation and HTTP shape — the analysis
// logic lives where it belongs.
//
// `text` is the escape hatch for bot-gated sites: when the caller already
// has the article body (pasted from a logged-in browser), skip the fetch
// and analyze that text directly, still attributed to `url`.

import { NextRequest, NextResponse } from "next/server";
import { analyzeUrl, analyzeText } from "@/lib/analysis";

// LLM completion + article fetch can together hit 30-45 seconds on a
// long article with a slow upstream. Match the timeout in llm.ts with
// a small margin.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  const url = (body as { url?: unknown })?.url;
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ ok: false, error: "Missing 'url' field" }, { status: 400 });
  }

  const text = (body as { text?: unknown })?.text;
  if (text !== undefined && typeof text !== "string") {
    return NextResponse.json({ ok: false, error: "'text' must be a string" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid URL" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ ok: false, error: "URL must use http or https" }, { status: 400 });
  }

  try {
    const result = text?.trim()
      ? await analyzeText({ url: parsed.toString(), title: null, text })
      : await analyzeUrl(parsed.toString());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
