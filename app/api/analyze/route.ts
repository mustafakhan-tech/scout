import { NextResponse } from "next/server";
import { access, KEY_HEADER } from "@/lib/auth.ts";
import { startRun } from "@/lib/apify.ts";
import { cacheGet, profileKey } from "@/lib/cache.ts";
import type { Creator, Job, SearchResponse } from "@/lib/types.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HANDLE = /^[A-Za-z0-9._]{1,40}$/;
const MAX = 50;

/**
 * Read the latest videos of TikTok creators picked from a quick scan.
 * Creators analyzed in the last week come straight from the cache, free.
 */
export async function POST(req: Request) {
  if (access(req.headers.get(KEY_HEADER)) !== "live") {
    return NextResponse.json({ message: "Live search is locked." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const handles: string[] = Array.isArray(body?.handles)
    ? [...new Set<string>(body.handles.filter((h: unknown): h is string => typeof h === "string" && HANDLE.test(h)))].slice(0, MAX)
    : [];
  if (handles.length === 0) return NextResponse.json({ message: "Pick at least one TikTok creator to analyze." }, { status: 400 });
  const query = typeof body?.query === "string" ? body.query.slice(0, 100) : "";
  const region = typeof body?.region === "string" && /^[A-Z]{2}$/.test(body.region) ? body.region : null;
  const env = process.env;

  const cached = await Promise.all(handles.map((h) => cacheGet<Creator>(profileKey("tiktok", h), env)));
  const creators = cached.flatMap((c) => (c ? [c.data] : []));
  const missing = handles.filter((_, i) => !cached[i]);

  const res: SearchResponse = { mode: "live", creators, jobs: [], errors: [] };
  if (missing.length > 0) {
    try {
      const runId = await startRun("tiktok", "profiles", { query, limit: missing.length, handles: missing, region }, env);
      const job: Job = { platform: "tiktok", runId, stage: "profiles", limit: missing.length, query, region };
      res.jobs.push(job);
    } catch (e) {
      res.errors.push({ platform: "tiktok", message: e instanceof Error ? e.message : "Couldn't start the analysis." });
    }
  }
  return NextResponse.json(res);
}
