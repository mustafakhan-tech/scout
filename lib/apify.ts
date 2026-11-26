import { buildCreator, dedupe, mode, toNum, type PostInput } from "./metrics.ts";
import type { Creator, JobStage, Platform } from "./types.ts";
import { countryFromBio, countryFromText } from "./place.ts";
import { looksLikeBusiness } from "./signals.ts";
import { countryName } from "./countries.ts";

const API = "https://api.apify.com/v2";
const RECENT_POSTS = 8;
/** TikTok charges per video scraped, so read fewer. 6 still leaves 4+ settled posts for momentum. */
const RECENT_TIKTOK = 6;

type Env = Record<string, string | undefined>;
type Rec = Record<string, any>;

function actorFor(platform: Platform, env: Env): string {
  if (platform === "tiktok") return env.APIFY_TIKTOK_ACTOR || "clockworks~tiktok-scraper";
  if (platform === "instagram") return env.APIFY_INSTAGRAM_ACTOR || "apify~instagram-scraper";
  throw new Error(`No Apify actor for ${platform}`);
}

export interface StageOptions {
  query?: string;
  limit: number;
  /** ISO-2 region to aim the search at */
  region?: string | null;
  /** Handles to profile, for the profiles stage */
  handles?: string[];
}

/**
 * Hashtags to search for a niche: the whole phrase joined, then its trailing and leading pairs.
 * "small business finance" -> smallbusinessfinance, businessfinance, smallbusiness
 */
export function hashtagsFor(query: string, region: string | null = null): string[] {
  const words = query.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const joined = words.join("");
  const tags: string[] = [];
  // A region adds the hashtags local creators actually use, e.g. #fashionsouthafrica, #safashion.
  for (const place of region ? REGION_TAGS[region] ?? [] : []) tags.push(`${joined}${place}`, `${place}${joined}`);
  tags.push(joined);
  if (words.length > 2) tags.push(words.slice(-2).join(""), words.slice(0, 2).join(""));
  return [...new Set(tags)].filter((t) => t.length >= 3 && t.length <= 60).slice(0, region ? 4 : 3);
}

/** Words local creators add to hashtags, by region. */
export const REGION_TAGS: Record<string, string[]> = {
  ZA: ["southafrica", "sa"], NG: ["nigeria", "naija"], GB: ["uk", "london"], US: ["usa"], CA: ["canada", "toronto"],
  AU: ["australia"], KE: ["kenya"], GH: ["ghana"], IN: ["india"], AE: ["dubai", "uae"], IE: ["ireland"],
  NZ: ["nz"], PK: ["pakistan"], SA: ["ksa", "riyadh"], DE: ["germany"], FR: ["france", "paris"], ES: ["spain"],
  IT: ["italy"], NL: ["netherlands"], SE: ["sweden"], BR: ["brasil"], MX: ["mexico"], PH: ["ph"], ID: ["indonesia"],
  SG: ["singapore", "sg"], JP: ["japan"], KR: ["korea"],
};

/** Measured: clockworks/tiktok-scraper charges about $0.0037 per video it returns. */
export const TIKTOK_PER_VIDEO = 0.0037;
/** Measured: discovery plus profile for one Instagram creator. */
export const INSTAGRAM_PER_CREATOR = 0.008;

/** Videos a TikTok scan reads: one search, or with a region, the search plus two local hashtags. */
export function tiktokScanVideos(limit: number, region: string | null): number {
  return region ? 3 * Math.min(limit, 60) : Math.min(limit * 2, 150);
}

/** Expected Apify spend for one stage. TikTok profiles read RECENT_TIKTOK videos per creator. */
export function expectedCost(platform: "tiktok" | "instagram", stage: JobStage, count: number, region: string | null = null): number {
  if (platform === "instagram") return count * INSTAGRAM_PER_CREATOR * (stage === "discover" ? 0.35 : 0.65);
  return (stage === "discover" ? tiktokScanVideos(count, region) : count * RECENT_TIKTOK) * TIKTOK_PER_VIDEO;
}

/** What the person pays before analyzing anyone: a TikTok scan, or a full Instagram search. */
export function searchCost(platform: "tiktok" | "instagram", limit: number, region: string | null): number {
  return platform === "tiktok" ? expectedCost("tiktok", "discover", limit, region) : limit * INSTAGRAM_PER_CREATOR;
}

/** Reading one TikTok creator's latest videos. */
export const ANALYZE_COST = RECENT_TIKTOK * TIKTOK_PER_VIDEO;

/** Apify refuses runs capped below $0.50. */
export const APIFY_MIN_CAP = 0.5;

/** Spend cap for one run: half again what it should cost, never above the account's ceiling. */
export function runCap(platform: "tiktok" | "instagram", stage: JobStage, count: number, ceiling: number, region: string | null = null): number {
  const cap = Math.round((0.05 + expectedCost(platform, stage, count, region) * 1.5) * 100) / 100;
  return Math.max(APIFY_MIN_CAP, Math.min(ceiling, cap));
}

/*
 * Two stages per platform:
 *   discover  – search posts about the niche, to find who is actively making that content
 *   profiles  – scrape those creators' latest posts, to measure how they perform now
 * Searching profiles directly mostly matches usernames, which surfaces shops and dead accounts.
 */
export function buildInput(platform: Platform, stage: JobStage, o: StageOptions, env: Env = {}): Record<string, unknown> {
  const noDownloads = { shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadAvatars: false, shouldDownloadSlideshowImages: false };
  if (platform === "tiktok") {
    // TikTok shows search results for the country it thinks you're in, so a regional proxy localises them.
    const where = o.region ? { proxyCountryCode: o.region } : {};
    if (stage === "discover") {
      if (!o.region) return { searchQueries: [o.query], searchSection: "/video", resultsPerPage: tiktokScanVideos(o.limit, null), ...noDownloads };
      // A proxy alone barely changes TikTok's results, so also search the niche with the country's name
      // and the hashtags local creators use (#fashionsouthafrica). Discovery then keeps local authors first.
      const joined = hashtagsFor(o.query ?? "")[0];
      const tags = hashtagsFor(o.query ?? "", o.region).filter((t) => t !== joined).slice(0, 2);
      return {
        searchQueries: [`${o.query} ${countryName(o.region)}`],
        hashtags: tags,
        searchSection: "/video",
        resultsPerPage: tiktokScanVideos(o.limit, o.region) / 3,
        ...where,
        ...noDownloads,
      };
    }
    return { profiles: o.handles, profileScrapeSections: ["videos"], resultsPerPage: RECENT_TIKTOK, profileSorting: "latest", excludePinnedPosts: true, ...where, ...noDownloads };
  }
  if (stage === "discover") {
    return {
      directUrls: hashtagsFor(o.query ?? "", o.region ?? null).map((t) => `https://www.instagram.com/explore/tags/${t}/`),
      resultsType: "posts",
      resultsLimit: Math.min(Math.max(o.limit * 2, 15), 40),
    };
  }
  if (o.handles && o.handles.length > 0) {
    return { directUrls: o.handles.map((h) => `https://www.instagram.com/${h}/`), resultsType: "details", resultsLimit: RECENT_POSTS };
  }
  // Fallback when hashtag discovery finds nobody: account search by keyword.
  return { search: o.query, searchType: env.APIFY_INSTAGRAM_SEARCH_TYPE || "user", searchLimit: Math.min(o.limit, 250), resultsType: "details", resultsLimit: RECENT_POSTS };
}

/** Apify's own wording for an empty account is long and points at upgrading; say what it means here. */
export function friendlyApifyError(message: string): string {
  const left = /remaining usage of \$([\d.]+)/i.exec(message);
  if (left || /not enough|exceeded.*(usage|limit)|monthly usage/i.test(message)) {
    const amount = left ? ` (${"$"}${Number(left[1]).toFixed(2)} left)` : "";
    return `Your Apify credit for this month is used up${amount}, so this platform can't search until it renews. Add credit at console.apify.com/billing, or search YouTube, which is free.`;
  }
  return message;
}

async function apify<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyApifyError(body?.error?.message || `Apify returned ${res.status}`));
  return body as T;
}

export async function startRun(platform: Platform, stage: JobStage, o: StageOptions, env: Env): Promise<string> {
  const ceiling = Number(env.APIFY_MAX_CHARGE_USD || "2");
  if (platform === "youtube") throw new Error("YouTube doesn't use Apify");
  const count = stage === "profiles" && o.handles?.length ? o.handles.length : o.limit;
  const qs = new URLSearchParams({ maxTotalChargeUsd: String(runCap(platform, stage, count, ceiling, o.region ?? null)) });
  const res = await apify<{ data: { id: string } }>(`/acts/${actorFor(platform, env)}/runs?${qs}`, env.APIFY_TOKEN!, {
    method: "POST",
    body: JSON.stringify(buildInput(platform, stage, o, env)),
  });
  return res.data.id;
}

export type RunState = { status: "running" } | { status: "done"; items: unknown[] } | { status: "failed"; message: string };

export async function runItems(runId: string, env: Env): Promise<RunState> {
  const token = env.APIFY_TOKEN!;
  const run = await apify<{ data: { status: string; defaultDatasetId: string; statusMessage?: string } }>(`/actor-runs/${encodeURIComponent(runId)}`, token);
  const s = run.data.status;
  if (s === "READY" || s === "RUNNING") return { status: "running" };
  // A run stopped by the spend cap still has useful results.
  if (s !== "SUCCEEDED" && s !== "ABORTED" && s !== "TIMED-OUT") {
    return { status: "failed", message: run.data.statusMessage || `The search run ended with status ${s}.` };
  }
  const res = await fetch(`${API}/datasets/${run.data.defaultDatasetId}/items?clean=true&format=json`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return { status: "failed", message: `Couldn't read results (Apify returned ${res.status}).` };
  const items = (await res.json()) as unknown[];
  if (items.length === 0 && s !== "SUCCEEDED") return { status: "failed", message: run.data.statusMessage || `The search run ended with status ${s}.` };
  return { status: "done", items };
}

/* ---------- discovery: who is making this content ---------- */

export interface Discovery {
  handles: string[];
  /** Country per handle, from where their niche videos were posted */
  countries: Record<string, string>;
}

function rankAuthors(entries: Array<{ handle: string; plays: number }>, limit: number): string[] {
  const agg = new Map<string, { n: number; plays: number; first: number }>();
  entries.forEach((e, i) => {
    const a = agg.get(e.handle);
    if (a) { a.n++; a.plays += e.plays; }
    else agg.set(e.handle, { n: 1, plays: e.plays, first: i });
  });
  return [...agg.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[1].plays - a[1].plays || a[1].first - b[1].first)
    .slice(0, limit)
    .map(([h]) => h);
}

export function discoverTikTok(items: unknown[], limit: number, region: string | null = null): Discovery {
  const rows = (items as Rec[]).filter((v) => v?.authorMeta?.name && !v.authorMeta.privateAccount);
  const byAuthor = new Map<string, Rec[]>();
  for (const v of rows) byAuthor.set(v.authorMeta.name, [...(byAuthor.get(v.authorMeta.name) ?? []), v]);

  // Where each author is, from the best evidence available: where the video was posted,
  // then the bio, then places in their captions and hashtags.
  const countries: Record<string, string> = {};
  const shops = new Set<string>();
  for (const [h, vids] of byAuthor) {
    const meta = vids[0].authorMeta;
    const c = mode(vids.map((v) => v.locationCreated)) ?? countryFromBio(meta.signature ?? "") ?? mode(vids.map((v) => countryFromText(v.text ?? "")));
    if (c) countries[h] = c;
    if (looksLikeBusiness(meta.signature ?? "", { seller: meta.ttSeller === true, name: meta.nickName ?? meta.nickname ?? "" })) shops.add(h);
  }

  const entries = (keep: (h: string) => boolean) =>
    rows.filter((v) => keep(v.authorMeta.name)).map((v) => ({ handle: v.authorMeta.name, plays: toNum(v.playCount) ?? 0 }));
  const people = (h: string) => !shops.has(h);
  let handles: string[];
  if (region) {
    // Creators who are clearly from the region first, then ones who could be; never ones from elsewhere.
    const local = rankAuthors(entries((h) => people(h) && countries[h] === region), limit);
    const maybe = rankAuthors(entries((h) => people(h) && !countries[h]), limit - local.length);
    handles = [...local, ...maybe];
  } else {
    handles = rankAuthors(entries(people), limit);
  }
  // Only a couple of shops in the results? Better than nothing.
  if (handles.length === 0) handles = rankAuthors(entries(() => true), limit);
  return { handles, countries: Object.fromEntries(handles.filter((h) => countries[h]).map((h) => [h, countries[h]])) };
}

/**
 * Quick-scan creators from TikTok discovery alone: follower counts and the niche videos Scout found.
 * No extra Apify cost. Analyzing a creator later reads their latest videos for the full picture.
 */
export function previewTikTok(items: unknown[], limit: number, region: string | null = null, now?: number): Creator[] {
  const { handles } = discoverTikTok(items, limit, region);
  const rows = (items as Rec[]).filter((v) => v?.authorMeta?.name);
  return handles.flatMap((handle) => {
    const vids = rows.filter((v) => v.authorMeta.name === handle);
    const meta: Rec = vids[0]?.authorMeta;
    if (!meta) return [];
    const bio = meta.signature ?? "";
    // Where they posted wins; the bio is read by buildCreator; captions come last.
    const posted = mode(vids.map((v) => v.locationCreated));
    const fromCaptions = posted || countryFromBio(bio) ? null : mode(vids.map((v) => countryFromText(v.text ?? "")));
    const country = posted ?? fromCaptions;
    return [
      buildCreator({
        platform: "tiktok",
        handle,
        name: meta.nickName || meta.nickname || handle,
        url: meta.profileUrl || `https://www.tiktok.com/@${handle}`,
        avatar: meta.avatar ?? null,
        bio,
        contactText: typeof meta.bioLink === "string" ? meta.bioLink : meta.bioLink?.link ?? "",
        country,
        countrySource: country ? "posts" : null,
        language: mode(vids.map((v) => v.textLanguage).filter((l) => l && l !== "un")),
        followers: toNum(meta.fans),
        posts: newestVideosFirst(vids).map((v) => ({
          views: toNum(v.playCount),
          likes: toNum(v.diggCount),
          comments: toNum(v.commentCount),
          date: v.createTimeISO ?? (toNum(v.createTime) ? new Date(v.createTime * 1000).toISOString() : null),
          caption: v.text ?? "",
          markedSponsored: v.isAd === true || v.isSponsored === true,
          url: v.webVideoUrl ?? null,
        })),
        verified: meta.verified,
        seller: meta.ttSeller === true,
        preview: true,
        now,
      }),
    ];
  });
}

function newestVideosFirst(vids: Rec[]): Rec[] {
  const t = (v: Rec) => Date.parse(v.createTimeISO ?? "") || (toNum(v.createTime) ?? 0) * 1000;
  return [...vids].sort((a, b) => t(b) - t(a));
}

export function discoverInstagram(items: unknown[], limit: number): Discovery {
  const rows = (items as Rec[]).filter((p) => typeof p?.ownerUsername === "string");
  return {
    handles: rankAuthors(rows.map((p) => ({ handle: p.ownerUsername, plays: (toNum(p.likesCount) ?? 0) + (toNum(p.videoViewCount) ?? 0) })), limit),
    countries: {},
  };
}

export function discover(platform: Platform, items: unknown[], limit: number, region: string | null = null): Discovery {
  return platform === "tiktok" ? discoverTikTok(items, limit, region) : discoverInstagram(items, limit);
}

/* ---------- profiles: how they perform now ---------- */

/** clockworks/tiktok-scraper returns one item per video, with the author nested in authorMeta. */
export function normalizeTikTok(items: unknown[], hints: Record<string, string> = {}, now?: number): Creator[] {
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
    const posts: PostInput[] = videos.slice(0, RECENT_TIKTOK).map((v) => ({
      views: toNum(v.playCount),
      likes: toNum(v.diggCount),
      comments: toNum(v.commentCount),
      date: v.createTimeISO ?? (toNum(v.createTime) ? new Date(v.createTime * 1000).toISOString() : null),
      caption: v.text ?? "",
      markedSponsored: v.isAd === true || v.isSponsored === true,
      url: v.webVideoUrl ?? null,
    }));
    const country = mode(videos.map((v) => v.locationCreated)) ?? hints[handle] ?? (meta.region ? String(meta.region) : null);
    return buildCreator({
      platform: "tiktok",
      handle,
      name: meta.nickName || meta.nickname || handle,
      url: meta.profileUrl || `https://www.tiktok.com/@${handle}`,
      avatar: meta.avatar ?? null,
      bio: meta.signature ?? "",
      contactText: typeof meta.bioLink === "string" ? meta.bioLink : meta.bioLink?.link ?? "",
      country,
      countrySource: "posts",
      language: mode(videos.map((v) => v.textLanguage).filter((l) => l && l !== "un")),
      followers: toNum(meta.fans),
      posts,
      verified: meta.verified,
      seller: meta.ttSeller === true,
      now,
    });
  });
  return dedupe(creators);
}

const SHOP_CATEGORY = /(shopping|retail|store|clothing|product\/service|brand|restaurant|company|bank|financial service|loan|real estate|agency|hotel|grocery|cosmetics store)/i;

/** apify/instagram-scraper with resultsType "details" returns one item per profile. */
export function normalizeInstagram(items: unknown[], now?: number): Creator[] {
  const creators: Creator[] = [];
  for (const raw of items as Rec[]) {
    const handle: string | undefined = raw?.username;
    if (!handle || raw.followersCount === undefined || raw.private === true) continue;
    const latest: Rec[] = Array.isArray(raw.latestPosts) ? raw.latestPosts.slice(0, RECENT_POSTS) : [];
    const posts: PostInput[] = latest.map((p) => ({
      views: toNum(p.videoViewCount ?? p.videoPlayCount ?? p.igPlayCount ?? p.playCount),
      likes: toNum(p.likesCount),
      comments: toNum(p.commentsCount),
      date: p.timestamp ?? null,
      caption: p.caption ?? "",
      markedSponsored: p.isSponsored === true || p.paidPartnership === true || p.isPaidPartnership === true,
      url: p.url ?? (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null),
    }));
    const addr = raw.businessAddress;
    const country = addr && typeof addr === "object" && typeof addr.country_code === "string" ? addr.country_code : null;
    const links = [raw.externalUrl, ...(Array.isArray(raw.externalUrls) ? raw.externalUrls.map((u: Rec) => u?.url) : [])].filter(Boolean).join(" ");
    creators.push(
      buildCreator({
        platform: "instagram",
        handle,
        name: raw.fullName || handle,
        url: raw.url || `https://www.instagram.com/${handle}/`,
        avatar: raw.profilePicUrl ?? null,
        bio: raw.biography ?? "",
        contactText: `${links} ${raw.businessEmail ?? ""}`,
        country,
        countrySource: "profile",
        followers: toNum(raw.followersCount),
        posts,
        verified: raw.verified,
        seller: raw.isBusinessAccount === true && SHOP_CATEGORY.test(raw.businessCategoryName ?? ""),
        now,
      }),
    );
  }
  return dedupe(creators);
}

export function normalize(platform: Platform, items: unknown[], hints: Record<string, string> = {}): Creator[] {
  return platform === "tiktok" ? normalizeTikTok(items, hints) : normalizeInstagram(items);
}
