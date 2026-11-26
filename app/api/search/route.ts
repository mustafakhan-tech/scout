import { NextResponse } from "next/server";
import { access, KEY_HEADER } from "@/lib/auth.ts";
import { startRun } from "@/lib/apify.ts";
import { sampleCreators } from "@/lib/sample.ts";
import { searchYouTube } from "@/lib/youtube.ts";
import { PLATFORMS, type Creator, type Job, type Platform, type ProviderError, type SearchResponse } from "@/lib/types.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PER_PLATFORM = 50;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 100) : "";
  if (!query) return NextResponse.json({ message: "Type a niche to search for." }, { status: 400 });

  const platforms: Platform[] = Array.isArray(body?.platforms)
    ? PLATFORMS.filter((p) => body.platforms.includes(p))
    : [];
  if (platforms.length === 0) return NextResponse.json({ message: "Pick at least one platform." }, { status: 400 });

  const region = typeof body?.region === "string" && /^[A-Z]{2}$/.test(body.region) ? body.region : null;
  const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), MAX_PER_PLATFORM);

  const level = access(req.headers.get(KEY_HEADER));
  if (level === "denied") return NextResponse.json({ message: "That password isn't right." }, { status: 401 });

  if (level === "sample") {
    const res: SearchResponse = { mode: "sample", creators: sampleCreators(query, platforms, limit, region), jobs: [], errors: [] };
    return NextResponse.json(res);
  }

  const env = process.env;
  const creators: Creator[] = [];
  const jobs: Job[] = [];
  const errors: ProviderError[] = [];

  await Promise.all(
    platforms.map(async (platform) => {
      try {
        if (platform === "youtube") {
          if (!env.YOUTUBE_API_KEY) throw new Error("Add YOUTUBE_API_KEY to the environment to search YouTube.");
          creators.push(...(await searchYouTube(query, limit, region, env.YOUTUBE_API_KEY)));
        } else {
          if (!env.APIFY_TOKEN) throw new Error("Add APIFY_TOKEN to the environment to search Instagram and TikTok.");
          const runId = await startRun(platform, "discover", { query, limit, region }, env);
          jobs.push({ platform, runId, stage: "discover", limit, query, region });
        }
      } catch (e) {
        errors.push({ platform, message: e instanceof Error ? e.message : "Search failed." });
      }
    }),
  );

  const res: SearchResponse = { mode: "live", creators, jobs, errors };
  return NextResponse.json(res);
}
