import { NextResponse } from "next/server";
import { access, KEY_HEADER } from "@/lib/auth.ts";
import { discover, normalize, runItems, startRun } from "@/lib/apify.ts";
import type { Job, JobResponse, JobStage } from "@/lib/types.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUN_ID = /^[A-Za-z0-9]{6,40}$/;

export async function GET(req: Request, { params }: { params: Promise<{ platform: string; runId: string }> }) {
  const { platform, runId } = await params;
  if (access(req.headers.get(KEY_HEADER)) !== "live") {
    return NextResponse.json({ message: "Live search is locked." }, { status: 401 });
  }
  if (platform !== "tiktok" && platform !== "instagram") return NextResponse.json({ message: "Unknown platform." }, { status: 400 });
  if (!RUN_ID.test(runId)) return NextResponse.json({ message: "Unknown run." }, { status: 400 });

  const url = new URL(req.url);
  const stage: JobStage = url.searchParams.get("stage") === "discover" ? "discover" : "profiles";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);
  const query = (url.searchParams.get("q") ?? "").slice(0, 100);
  const from = url.searchParams.get("from");
  const regionParam = url.searchParams.get("region");
  const region = regionParam && /^[A-Z]{2}$/.test(regionParam) ? regionParam : null;
  const env = process.env;

  try {
    const state = await runItems(runId, env);
    if (state.status === "running") return NextResponse.json({ status: "running", creators: [] } satisfies JobResponse);
    if (state.status === "failed") return NextResponse.json({ status: "failed", creators: [], message: state.message } satisfies JobResponse);

    if (stage === "discover") {
      const found = discover(platform, state.items, limit);
      if (found.handles.length === 0 && platform === "tiktok") {
        return NextResponse.json({ status: "done", creators: [], message: "No TikTok videos came back for this niche." } satisfies JobResponse);
      }
      // Instagram with no hashtag results falls back to account search inside the profiles stage.
      const nextId = await startRun(platform, "profiles", { query, limit, handles: found.handles, region }, env);
      const next: Job = { platform, runId: nextId, stage: "profiles", from: runId, limit, query, region };
      return NextResponse.json({ status: "running", creators: [], next } satisfies JobResponse);
    }

    let hints: Record<string, string> = {};
    if (platform === "tiktok" && from && RUN_ID.test(from)) {
      const origin = await runItems(from, env).catch(() => null);
      if (origin?.status === "done") hints = discover("tiktok", origin.items, 50).countries;
    }
    return NextResponse.json({ status: "done", creators: normalize(platform, state.items, hints) } satisfies JobResponse);
  } catch (e) {
    const res: JobResponse = { status: "failed", creators: [], message: e instanceof Error ? e.message : "Couldn't check the search." };
    return NextResponse.json(res, { status: 502 });
  }
}
