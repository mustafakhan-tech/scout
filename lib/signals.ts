import type { Platform, Post } from "./types.ts";

/*
 * Scouting signals. Each one is a plain, explainable rule, so the UI can always say
 * why a creator got the label or score they did.
 */

const SPONSOR_RE =
  /(#ad\b|#ads\b|#advert|#sponsored|#sponsor\b|#paidpartnership|#partner\b|#brandpartner|#gifted|#collab\b|paid partnership|paid promotion|sponsored by|in partnership with|thanks? to [^.\n]{1,40} for sponsoring|this (video|post) is sponsored|use (my )?code\b|discount code|promo code|affiliate link|link in bio for \d+% off)/i;

export function captionLooksSponsored(caption: string): boolean {
  return SPONSOR_RE.test(caption);
}

const MANAGER_RE =
  /(\bmgmt\b|\bmanagement\b|managed by|\bmanager\b|talent agency|represented by|\bmy agent\b|\bbookings?@|\bpartnerships@|@[\w.]*(mgmt|management|talent)\b|[\w.+-]+@[\w-]*(mgmt|management|talent|agency)[\w-]*\.)/i;

export function bioMentionsManager(text: string): boolean {
  return MANAGER_RE.test(text);
}

const BUSINESS_RE =
  /(free shipping|shop now|shop (our|the) (new|latest|collection)|order (now|below|bellow|here|online)|dm (us )?to order|tap (the )?link to shop|we (sell|ship|deliver)\b|our (store|shop|products)\b|wholesale|official (store|shop|account|page)\b|\bLLC\b|\bInc\.(?=\s|$)|\bLtd\b|get a quote)/i;

export function looksLikeBusiness(bio: string, flags: { seller?: boolean } = {}): boolean {
  return Boolean(flags.seller) || BUSINESS_RE.test(bio);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * One measure per creator, never a mix: views when at least 4 posts have them, otherwise likes.
 * (Instagram photos have no views, so mixing would compare likes on one post with views on another.)
 */
export function performanceMetric(posts: Post[]): "views" | "likes" | null {
  if (posts.filter((p) => p.views !== null).length >= 4) return "views";
  if (posts.filter((p) => p.likes !== null).length >= 4) return "likes";
  return null;
}

/** Sort newest first when dates exist; otherwise keep the platform's order, which is newest first. */
export function newestFirst(posts: Post[]): Post[] {
  if (!posts.every((p) => p.date)) return posts;
  return [...posts].sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!));
}

/**
 * Median of the newest 3 posts divided by the median of the older ones.
 * Medians keep one viral post from making an account look like it's taking off.
 */
export function momentumOf(posts: Post[]): number | null {
  const metric = performanceMetric(posts);
  if (!metric) return null;
  const perf = newestFirst(posts).map((p) => p[metric]).filter((v): v is number => v !== null);
  if (perf.length < 4) return null;
  const split = Math.min(3, Math.floor(perf.length / 2));
  const recent = median(perf.slice(0, split));
  const older = median(perf.slice(split));
  if (recent === null || older === null) return null;
  if (older === 0) return recent > 0 ? 20 : 1;
  return Math.min(20, Math.max(0.05, recent / older));
}

export function daysSince(date: string | null, now = Date.now()): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
}

export function postsPerWeekOf(posts: Post[]): number | null {
  const times = posts.map((p) => (p.date ? Date.parse(p.date) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length < 2) return null;
  const spanDays = (times[times.length - 1] - times[0]) / 86_400_000;
  if (spanDays < 1) return null;
  return ((times.length - 1) / spanDays) * 7;
}

/** Typical views-to-followers ratio per platform, used as the "par" for reach. */
export const REACH_PAR: Record<Platform, number> = { tiktok: 0.3, youtube: 0.12, instagram: 0.2 };

/**
 * 0–100. 50 means "performing like a typical account of its size".
 * Pushed up by recent posts beating older ones and by views well above follower count;
 * pulled down by going quiet or already being very large.
 */
export function breakoutScore(input: {
  platform: Platform;
  momentum: number | null;
  reach: number | null;
  followers: number | null;
  daysSinceLastPost: number | null;
}): number | null {
  const { platform, momentum, reach, followers, daysSinceLastPost } = input;
  if (momentum === null && reach === null) return null;
  let z = 0;
  if (momentum !== null) z += 0.9 * Math.log2(momentum);
  if (reach !== null && reach > 0) z += 0.35 * Math.log2(reach / REACH_PAR[platform]);
  if (daysSinceLastPost !== null && daysSinceLastPost > 45) z -= 1.5;
  if (followers !== null && followers > 1_000_000) z -= 0.6;
  return Math.round(100 / (1 + Math.exp(-z)));
}

export const RISING = 70;
