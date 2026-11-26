import { buildCreator, dedupe, mode, toNum, type PostStats } from "./metrics.ts";
import type { Creator, Platform } from "./types.ts";

const API = "https://api.apify.com/v2";
const RECENT_POSTS = 8;

type Env = Record<string, string | undefined>;

function actorFor(platform: Platform, env: Env): string {
  if (platform === "tiktok") return env.APIFY_TIKTOK_ACTOR || "clockworks~tiktok-scraper";
  if (platform === "instagram") return env.APIFY_INSTAGRAM_ACTOR || "apify~instagram-scraper";
  throw new Error(`No Apify actor for ${platform}`);
}

/** Actor input for a keyword search of creator profiles. */
export function buildInput(platform: Platform, query: string, limit: number, env: Env = {}): Record<string, unknown> {
  if (platform === "tiktok") {
    return {
      searchQueries: [query],
      searchSection: "/user",
      maxProfilesPerQuery: limit,
      resultsPerPage: RECENT_POSTS,
      profileSorting: "latest",
      excludePinnedPosts: true,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadAvatars: false,
    };
  }
  return {
    search: query,
    searchType: env.APIFY_INSTAGRAM_SEARCH_TYPE || "user",
    searchLimit: Math.min(limit, 250),
    resultsType: "details",
    resultsLimit: RECENT_POSTS,
  };
}

async function apify<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Apify returned ${res.status}`);
  return body as T;
}

export async function startRun(platform: Platform, query: string, limit: number, env: Env): Promise<string> {
  const token = env.APIFY_TOKEN!;
  const cap = Number(env.APIFY_MAX_CHARGE_USD || "0.5");
  const qs = new URLSearchParams({ maxTotalChargeUsd: String(cap) });
  const res = await apify<{ data: { id: string } }>(`/acts/${actorFor(platform, env)}/runs?${qs}`, token, {
    method: "POST",
    body: JSON.stringify(buildInput(platform, query, limit, env)),
  });
  return res.data.id;
}

export type RunState = { status: "running" } | { status: "done"; items: unknown[] } | { status: "failed"; message: string };

export async function checkRun(runId: string, env: Env): Promise<RunState> {
  const token = env.APIFY_TOKEN!;
  const run = await apify<{ data: { status: string; defaultDatasetId: string; statusMessage?: string } }>(
    `/actor-runs/${encodeURIComponent(runId)}`,
    token,
  );
  const s = run.data.status;
  if (s === "READY" || s === "RUNNING") return { status: "running" };
  if (s !== "SUCCEEDED") return { status: "failed", message: run.data.statusMessage || `The search run ended with status ${s}.` };
  const res = await fetch(`${API}/datasets/${run.data.defaultDatasetId}/items?clean=true&format=json`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return { status: "failed", message: `Couldn't read results (Apify returned ${res.status}).` };
  return { status: "done", items: (await res.json()) as unknown[] };
}

/* ---------- Normalizers ---------- */

type Rec = Record<string, any>;

/** clockworks/tiktok-scraper returns one item per video, with the author nested in authorMeta. */
export function normalizeTikTok(items: unknown[]): Creator[] {
  const byAuthor = new Map<string, { meta: Rec; videos: Rec[] }>();
  for (const raw of items as Rec[]) {
    const meta: Rec | undefined = raw?.authorMeta ?? (raw?.fans !== undefined ? raw : undefined);
    const handle: string | undefined = meta?.name ?? meta?.uniqueId;
    if (!meta || !handle) continue;
    const entry = byAuthor.get(handle) ?? { meta, videos: [] };
    if (raw.authorMeta && (raw.playCount !== undefined || raw.diggCount !== undefined)) entry.videos.push(raw);
    byAuthor.set(handle, entry);
  }
  const creators = [...byAuthor.entries()].map(([handle, { meta, videos }]) => {
    const posts: PostStats[] = videos.slice(0, RECENT_POSTS).map((v) => ({
      views: toNum(v.playCount),
      likes: toNum(v.diggCount),
      comments: toNum(v.commentCount),
    }));
    const country = mode(videos.map((v) => v.locationCreated)) ?? (meta.region ? String(meta.region) : null);
    return buildCreator({
      platform: "tiktok",
      handle,
      name: meta.nickName || meta.nickname || handle,
      url: meta.profileUrl || `https://www.tiktok.com/@${handle}`,
      avatar: meta.avatar ?? null,
      bio: meta.signature ?? "",
      country,
      countrySource: "posts",
      followers: toNum(meta.fans),
      posts,
      verified: meta.verified,
    });
  });
  return dedupe(creators);
}

/** apify/instagram-scraper with resultsType "details" returns one item per profile. */
export function normalizeInstagram(items: unknown[]): Creator[] {
  const creators: Creator[] = [];
  for (const raw of items as Rec[]) {
    const handle: string | undefined = raw?.username;
    if (!handle || raw.followersCount === undefined) continue;
    const latest: Rec[] = Array.isArray(raw.latestPosts) ? raw.latestPosts.slice(0, RECENT_POSTS) : [];
    const posts: PostStats[] = latest.map((p) => ({
      views: toNum(p.videoViewCount ?? p.videoPlayCount),
      likes: toNum(p.likesCount),
      comments: toNum(p.commentsCount),
    }));
    let country: string | null = null;
    const addr = raw.businessAddress;
    if (addr && typeof addr === "object" && typeof addr.country_code === "string") country = addr.country_code;
    creators.push(
      buildCreator({
        platform: "instagram",
        handle,
        name: raw.fullName || handle,
        url: raw.url || `https://www.instagram.com/${handle}/`,
        avatar: raw.profilePicUrl ?? null,
        bio: raw.biography ?? "",
        country,
        countrySource: "profile",
        followers: toNum(raw.followersCount),
        posts,
        verified: raw.verified,
      }),
    );
  }
  return dedupe(creators);
}

export function normalize(platform: Platform, items: unknown[]): Creator[] {
  return platform === "tiktok" ? normalizeTikTok(items) : normalizeInstagram(items);
}
