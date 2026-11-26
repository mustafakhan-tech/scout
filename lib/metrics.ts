import type { Creator, Platform, CountrySource } from "./types.ts";

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
  return Number.isFinite(n) ? n : null;
}

export interface PostStats {
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export interface CreatorInput {
  platform: Platform;
  handle: string;
  name?: string;
  url: string;
  avatar?: string | null;
  bio?: string;
  country?: string | null;
  countrySource?: CountrySource | null;
  followers: number | null;
  posts: PostStats[];
  verified?: boolean;
  sample?: boolean;
}

/** Turn raw profile + recent posts into a Creator with averages and engagement rates. */
export function buildCreator(input: CreatorInput): Creator {
  const avgViews = mean(input.posts.map((p) => p.views));
  const avgLikes = mean(input.posts.map((p) => p.likes));
  const avgComments = mean(input.posts.map((p) => p.comments));
  const interactions = avgLikes === null && avgComments === null ? null : (avgLikes ?? 0) + (avgComments ?? 0);
  const followers = input.followers !== null && input.followers >= 0 ? input.followers : null;

  const erFollowers = interactions !== null && followers ? interactions / followers : null;
  const erViews = interactions !== null && avgViews ? interactions / avgViews : null;
  const country = input.country ? input.country.toUpperCase() : null;

  return {
    id: `${input.platform}:${input.handle.toLowerCase()}`,
    platform: input.platform,
    handle: input.handle,
    name: input.name || input.handle,
    url: input.url,
    avatar: input.avatar ?? null,
    bio: (input.bio ?? "").trim(),
    country,
    countrySource: country ? input.countrySource ?? "profile" : null,
    followers,
    postsSampled: input.posts.length,
    avgViews,
    avgLikes,
    avgComments,
    erFollowers,
    erViews,
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
