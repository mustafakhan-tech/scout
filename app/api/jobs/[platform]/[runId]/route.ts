import { NextResponse } from "next/server";
import { access, KEY_HEADER } from "@/lib/auth.ts";
import { checkRun, normalize } from "@/lib/apify.ts";
import type { JobResponse } from "@/lib/types.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ platform: string; runId: string }> }) {
  const { platform, runId } = await params;
  if (access(req.headers.get(KEY_HEADER)) !== "live") {
    return NextResponse.json({ message: "Live search is locked." }, { status: 401 });
  }
  if (platform !== "tiktok" && platform !== "instagram") {
    return NextResponse.json({ message: "Unknown platform." }, { status: 400 });
  }
  if (!/^[A-Za-z0-9]{6,40}$/.test(runId)) return NextResponse.json({ message: "Unknown run." }, { status: 400 });

  try {
    const state = await checkRun(runId, process.env);
    let res: JobResponse;
    if (state.status === "running") res = { status: "running", creators: [] };
    else if (state.status === "failed") res = { status: "failed", creators: [], message: state.message };
    else res = { status: "done", creators: normalize(platform, state.items) };
    return NextResponse.json(res);
  } catch (e) {
    const res: JobResponse = { status: "failed", creators: [], message: e instanceof Error ? e.message : "Couldn't check the search." };
    return NextResponse.json(res, { status: 502 });
  }
}
