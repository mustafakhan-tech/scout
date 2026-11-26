import type { Creator, Platform, CountrySource, Post } from "./types.ts";
import {
  bioMentionsManager, breakoutScore, captionLooksSponsored, daysSince, looksLikeBusiness, lowReachForSize, maturePosts, momentumOf, newestFirst,
  postsPerWeekOf,
} from "./signals.ts";

/** Mean of the usable numbers. Negative values mean "hidden" on Instagram and are skipped. */
export function mean(values: Array<number | null | undefined>): number | null {
  const ok = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

/** Most common non-empty value, or null. */
export function mode(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    const k = v.toUpperCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return best;
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface PostInput {
  views: number | null;
  likes: number | null;
  comments: number | null;
  date?: string | null;
  caption?: string;
  /** Platform's own ad / paid-partnership flag */
  markedSponsored?: boolean;
  url?: string | null;
}

export interface CreatorInput {
  platform: Platform;
  handle: string;
  name?: string;
  url: string;
  avatar?: string | null;
  bio?: string;
  /** Extra text checked for manager mentions, e.g. the bio link */
  contactText?: string;
  country?: string | null;
  countrySource?: CountrySource | null;
  language?: string | null;
  followers: number | null;
  posts: PostInput[];
  verified?: boolean;
  seller?: boolean;
  sample?: boolean;
  now?: number;
}

export function toPost(p: PostInput): Post {
  const caption = (p.caption ?? "").trim();
  return {
    date: p.date ?? null,
    views: p.views,
    likes: p.likes,
    comments: p.comments,
    sponsored: Boolean(p.markedSponsored) || captionLooksSponsored(caption),
    caption: caption.length > 280 ? caption.slice(0, 277) + "…" : caption,
    url: p.url ?? null,
  };
}

/** Turn raw profile + recent posts into a Creator with averages, engagement and scouting signals. */
export function buildCreator(input: CreatorInput): Creator {
  const posts = newestFirst(input.posts.map(toPost));
  const avgViews = mean(posts.map((p) => p.views));
  const avgLikes = mean(posts.map((p) => p.likes));
  const avgComments = mean(posts.map((p) => p.comments));
  const interactions = avgLikes === null && avgComments === null ? null : (avgLikes ?? 0) + (avgComments ?? 0);
  const followers = input.followers !== null && input.followers >= 0 ? input.followers : null;

  const erFollowers = interactions !== null && followers ? interactions / followers : null;
  const erViews = interactions !== null && avgViews ? interactions / avgViews : null;
  const country = input.country ? input.country.toUpperCase() : null;
  const bio = (input.bio ?? "").trim();

  const momentum = momentumOf(maturePosts(posts, input.platform, input.now));
  const reach = avgViews !== null && followers ? avgViews / followers : null;
  const daysSinceLastPost = daysSince(posts[0]?.date ?? null, input.now);

  return {
    id: `${input.platform}:${input.handle.toLowerCase()}`,
    platform: input.platform,
    handle: input.handle,
    name: input.name || input.handle,
    url: input.url,
    avatar: input.avatar ?? null,
    bio,
    country,
    countrySource: country ? input.countrySource ?? "profile" : null,
    language: input.language ? input.language.toLowerCase().slice(0, 2) : null,
    followers,
    posts,
    postsSampled: posts.length,
    avgViews,
    avgLikes,
    avgComments,
    erFollowers,
    erViews,
    momentum,
    reach,
    breakout: breakoutScore({ platform: input.platform, momentum, reach, followers, daysSinceLastPost }),
    brandDeals: posts.filter((p) => p.sponsored).length,
    managed: bioMentionsManager(`${bio} ${input.contactText ?? ""}`),
    business: looksLikeBusiness(bio, { seller: input.seller }),
    lowReach: lowReachForSize(reach, followers),
    daysSinceLastPost,
    postsPerWeek: postsPerWeekOf(posts),
    verified: Boolean(input.verified),
    sample: Boolean(input.sample),
  };
}

/** Cost per thousand views for a given fee. */
export function cpm(fee: number, avgViews: number | null): number | null {
  if (!fee || !avgViews) return null;
  return (fee / avgViews) * 1000;
}

export function dedupe(creators: Creator[]): Creator[] {
  const seen = new Map<string, Creator>();
  for (const c of creators) if (!seen.has(c.id)) seen.set(c.id, c);
  return [...seen.values()];
}
