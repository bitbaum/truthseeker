// GET /api/health — liveness. A dead LLM key must never fail the check a
// kill-and-restart decision reads: restarting the process can't fix someone
// else's outage. Always 200 once the process is up; `llm` is informational.

import { NextResponse } from "next/server";
import { getLLMHealth } from "@/lib/health";

export async function GET() {
  const llm = getLLMHealth();

  return NextResponse.json({
    success: true,
    data: {
      status: "healthy",
      llm,
      timestamp: new Date().toISOString(),
    },
  });
}
