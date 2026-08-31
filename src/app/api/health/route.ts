// GET /api/health — liveness by default; add ?strict=1 for readiness.
//
// A dead LLM key must never fail the check a kill-and-restart decision reads:
// restarting the process can't fix someone else's outage. So the plain check
// always returns 200 once the process is up, carrying `llm` as information
// only. `?strict=1` is the opt-in for a caller that actually wants to know
// whether analysis currently works — it 503s only when the chain has been
// down for `downAfter` consecutive requests.

import { NextRequest, NextResponse } from "next/server";
import { getLLMHealth } from "@/lib/health";

export async function GET(req: NextRequest) {
  const llm = getLLMHealth();
  const strict = req.nextUrl.searchParams.get("strict") === "1";
  const status = strict && llm.status === "down" ? 503 : 200;

  return NextResponse.json(
    {
      success: true,
      data: {
        status: status === 200 ? "healthy" : "unhealthy",
        llm,
        timestamp: new Date().toISOString(),
      },
    },
    { status },
  );
}
