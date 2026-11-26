import { NextResponse } from "next/server";
import { access, KEY_HEADER } from "@/lib/auth.ts";

export const dynamic = "force-dynamic";

/** Tells the page whether live search exists and whether the sent password unlocks it. */
export async function GET(req: Request) {
  const env = process.env;
  return NextResponse.json({
    liveAvailable: Boolean(env.SCOUT_PASSWORD),
    access: access(req.headers.get(KEY_HEADER)),
    providers: { youtube: Boolean(env.YOUTUBE_API_KEY), apify: Boolean(env.APIFY_TOKEN) },
  });
}
