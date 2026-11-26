import { buildCreator, type PostStats } from "./metrics.ts";
import type { Creator, Platform } from "./types.ts";

/*
 * Sample data for the public demo. Every creator here is invented: names are built from
 * random syllables and numbers come from plausible distributions, so no real account's
 * stats are ever shown or misrepresented.
 */

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["ka", "mi", "ro", "ze", "lu", "an", "te", "sa", "jo", "ni", "da", "ve", "or", "pa", "li", "em"];
const SECOND = ["ra", "lo", "na", "vi", "den", "sha", "ko", "rin", "mo", "tel", "bie", "ya", "lex", "ndo"];
const SUFFIX = ["daily", "hq", "studio", "notes", "lab", "club", "official", "diaries", "talks", "works"];
const BIOS = [
  "Weekly videos on {q}. Collabs in DMs.",
  "Making {q} less confusing, one post at a time.",
  "{q} tips, honest reviews, no fluff.",
  "Documenting my {q} journey. New post every Tuesday.",
  "Former agency person talking {q}.",
  "Short, useful takes on {q}. Business inquiries via link.",
];
const SAMPLE_COUNTRIES = ["US", "US", "US", "CA", "CA", "GB", "GB", "AU", "ZA", "NG", "IN", "AE", "DE", "PH"];

function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

function logNormal(r: () => number, median: number, spread: number): number {
  // Box-Muller
  const u = Math.max(r(), 1e-9);
  const v = r();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.round(median * Math.exp(z * spread));
}

function slug(query: string): string {
  const words = query.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  return (words.sort((a, b) => b.length - a.length)[0] || "creator").slice(0, 10);
}

const PROFILE: Record<Platform, { followerMedian: number; viewRatio: [number, number]; likeRate: [number, number]; commentRate: number }> = {
  // viewRatio = avg views / followers; likeRate = likes / views
  youtube: { followerMedian: 60_000, viewRatio: [0.05, 0.6], likeRate: [0.02, 0.05], commentRate: 0.08 },
  instagram: { followerMedian: 45_000, viewRatio: [0.15, 1.2], likeRate: [0.03, 0.09], commentRate: 0.04 },
  tiktok: { followerMedian: 80_000, viewRatio: [0.1, 2.5], likeRate: [0.05, 0.14], commentRate: 0.02 },
};

export function sampleCreators(query: string, platforms: Platform[], perPlatform: number, region: string | null): Creator[] {
  const out: Creator[] = [];
  const topic = slug(query);
  for (const platform of platforms) {
    const r = seededRandom(`${query.toLowerCase()}|${platform}`);
    const p = PROFILE[platform];
    const used = new Set<string>();
    for (let i = 0; i < perPlatform; i++) {
      const first = pick(r, FIRST) + pick(r, SECOND);
      const name = first[0].toUpperCase() + first.slice(1);
      let handle = r() < 0.5 ? `${topic}with${first}` : `${first}.${pick(r, SUFFIX)}`;
      if (used.has(handle)) handle = `${handle}${i}`;
      used.add(handle);
      const followers = Math.max(1_200, logNormal(r, p.followerMedian, 1.25));
      const viewRatio = p.viewRatio[0] + r() * (p.viewRatio[1] - p.viewRatio[0]);
      const likeRate = p.likeRate[0] + r() * (p.likeRate[1] - p.likeRate[0]);
      const posts: PostStats[] = Array.from({ length: 8 }, () => {
        const views = Math.max(100, Math.round(followers * viewRatio * (0.5 + r())));
        const likes = Math.round(views * likeRate * (0.7 + r() * 0.6));
        return {
          views: platform === "instagram" && r() < 0.4 ? null : views,
          likes,
          comments: Math.round(likes * p.commentRate * (0.5 + r())),
        };
      });
      const country = region && r() < 0.55 ? region : pick(r, SAMPLE_COUNTRIES);
      out.push(
        buildCreator({
          platform,
          handle,
          name,
          url: "#sample",
          bio: pick(r, BIOS).replace("{q}", query.toLowerCase()),
          country: platform === "instagram" && r() < 0.5 ? null : country,
          countrySource: "sample",
          followers,
          posts,
          sample: true,
        }),
      );
    }
  }
  return out;
}
