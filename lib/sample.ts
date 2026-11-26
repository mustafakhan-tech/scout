import { buildCreator, type PostInput } from "./metrics.ts";
import type { Creator, Platform } from "./types.ts";

/*
 * Sample data for the public demo. Every creator here is invented: names are built from
 * random syllables and numbers come from plausible distributions, so no real account's
 * stats are ever shown or misrepresented. Generation is seeded by the query, so the same
 * search always returns the same sample creators.
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

// Common first names only: no surnames, no photos, so no sample creator stands for a real person.
const FIRST_NAMES = [
  "maya", "zanele", "lerato", "chioma", "sofia", "amara", "jade", "priya", "nadia", "leah", "naledi", "ngozi", "elena", "grace",
  "thabo", "marcus", "daniel", "kwame", "omar", "ethan", "sipho", "lucas", "ryan", "emeka",
  "thando", "alex", "jordan", "sam", "mpho", "riley",
];
const SUFFIX = ["daily", "hq", "studio", "notes", "lab", "club", "diaries", "talks", "works"];
const SAMPLE_COUNTRIES = ["US", "US", "US", "CA", "CA", "GB", "GB", "AU", "ZA", "NG", "IN", "AE", "DE", "PH"];
const BIOS = [
  "Weekly videos on {q}. Collabs in DMs.",
  "Making {q} less confusing, one post at a time.",
  "{q} tips, honest reviews, no fluff.",
  "Documenting my {q} journey. New post every Tuesday.",
  "Former agency person talking {q}.",
  "Short, useful takes on {q}.",
];
const MANAGED_BIOS = ["{q} creator. Mgmt: hello@northlinetalent.co", "Talking {q} daily. Managed by Brightside Management.", "{q} explained simply. Partnerships via my manager, link below."];
const SHOP_BIOS = ["Handmade {q} goods. Free shipping on orders $50+", "Official shop. {q} essentials, order below."];
const CAPTIONS = [
  "3 things I wish I knew about {q} when I started",
  "The {q} mistake almost everyone makes",
  "Answering your {q} questions, part {n}",
  "What a week of {q} actually looks like",
  "I tried the viral {q} advice so you don't have to",
  "Unpopular opinion about {q}",
  "{q} for complete beginners",
  "Reacting to your {q} setups",
];
const AD_CAPTIONS = ["#ad Big thanks to our sponsor for making this {q} video possible", "Use my code for 20% off. #sponsored {q}", "Paid partnership: my honest take on a {q} tool"];

function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

function logNormal(r: () => number, median: number, spread: number): number {
  const u = Math.max(r(), 1e-9);
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  return Math.round(median * Math.exp(z * spread));
}

function slug(query: string): string {
  const words = query.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  return (words.sort((a, b) => b.length - a.length)[0] || "creator").slice(0, 10);
}

const PROFILE: Record<Platform, { followerMedian: number; viewRatio: [number, number]; likeRate: [number, number]; commentRate: number; postEveryDays: number }> = {
  youtube: { followerMedian: 60_000, viewRatio: [0.03, 0.3], likeRate: [0.02, 0.05], commentRate: 0.08, postEveryDays: 7 },
  instagram: { followerMedian: 45_000, viewRatio: [0.08, 0.5], likeRate: [0.03, 0.09], commentRate: 0.04, postEveryDays: 3 },
  tiktok: { followerMedian: 80_000, viewRatio: [0.08, 1.0], likeRate: [0.05, 0.14], commentRate: 0.02, postEveryDays: 2 },
};

/** Start of today (UTC), so sample data is stable for a whole day but never looks stale. */
export function sampleNow(): number {
  return Math.floor(Date.now() / 86_400_000) * 86_400_000;
}

export function sampleCreators(query: string, platforms: Platform[], perPlatform: number, region: string | null, now = sampleNow()): Creator[] {
  const out: Creator[] = [];
  const topic = slug(query);
  const q = query.toLowerCase().trim();
  for (const platform of platforms) {
    const r = seededRandom(`${q}|${platform}`);
    const p = PROFILE[platform];
    const used = new Set<string>();
    for (let i = 0; i < perPlatform; i++) {
      const first = pick(r, FIRST_NAMES);
      const name = first[0].toUpperCase() + first.slice(1);
      let handle = r() < 0.5 ? `${topic}with${first}` : `${first}.${pick(r, SUFFIX)}`;
      if (used.has(handle)) handle = `${handle}${i}`;
      used.add(handle);

      const followers = Math.max(1_200, logNormal(r, p.followerMedian, 1.3));
      const viewRatio = p.viewRatio[0] + r() * (p.viewRatio[1] - p.viewRatio[0]);
      const likeRate = p.likeRate[0] + r() * (p.likeRate[1] - p.likeRate[0]);
      // Trend: some accounts are taking off, some are fading, most are flat.
      const roll = r();
      const trend = roll < 0.18 ? 1.25 + r() * 0.35 : roll < 0.38 ? 0.78 + r() * 0.12 : 0.96 + r() * 0.08;
      const quiet = r() < 0.12 ? 50 + Math.floor(r() * 60) : Math.floor(r() * 6);
      const adRate = r() < 0.45 ? 0 : r() * 0.4;

      const posts: PostInput[] = Array.from({ length: 8 }, (_, k) => {
        const age = k; // 0 = newest
        const views = Math.max(80, Math.round(followers * viewRatio * Math.pow(trend, (7 - age) / 2 - 2) * (0.75 + r() * 0.5)));
        const likes = Math.round(views * likeRate * (0.7 + r() * 0.6));
        const sponsored = r() < adRate;
        const days = quiet + Math.round(age * p.postEveryDays * (0.6 + r() * 0.8));
        return {
          views: platform === "instagram" && r() < 0.4 ? null : views,
          likes,
          comments: Math.round(likes * p.commentRate * (0.5 + r())),
          date: new Date(now - days * 86_400_000).toISOString(),
          caption: (sponsored ? pick(r, AD_CAPTIONS) : pick(r, CAPTIONS)).replace("{q}", q).replace("{n}", String(1 + Math.floor(r() * 5))),
          url: null,
        };
      });

      const bioRoll = r();
      const pronounRoll = r();
      const pronouns = pronounRoll < 0.12 ? " she/her" : pronounRoll < 0.18 ? " he/him" : "";
      const bioTemplate = (bioRoll < 0.18 ? pick(r, MANAGED_BIOS) : bioRoll < 0.26 ? pick(r, SHOP_BIOS) : pick(r, BIOS)) + pronouns;
      const country = region && r() < 0.55 ? region : pick(r, SAMPLE_COUNTRIES);
      out.push(
        buildCreator({
          platform,
          handle,
          name,
          url: "#sample",
          bio: bioTemplate.replace("{q}", q.charAt(0).toUpperCase() + q.slice(1)),
          country: platform === "instagram" && r() < 0.5 ? null : country,
          countrySource: "sample",
          language: "en",
          followers,
          posts,
          sample: true,
          now,
        }),
      );
    }
  }
  return out;
}
