import type { Gender, GenderSource } from "./gender.ts";

export type Platform = "youtube" | "instagram" | "tiktok";

export const PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

/** Where a creator's country came from. */
export type CountrySource = "profile" | "posts" | "bio" | "sample";

export interface Post {
  /** ISO date, when the platform gives one */
  date: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** Marked as an ad by the platform, or the caption reads like a paid post */
  sponsored: boolean;
  caption: string;
  url: string | null;
}

export interface Creator {
  /** platform:handle, unique across a result set */
  id: string;
  platform: Platform;
  handle: string;
  name: string;
  url: string;
  avatar: string | null;
  bio: string;
  /** ISO 3166-1 alpha-2, or null when the platform doesn't expose it */
  country: string | null;
  countrySource: CountrySource | null;
  /** ISO 639-1 language of recent posts, when known */
  language: string | null;
  followers: number | null;
  /** Recent posts, newest first */
  posts: Post[];
  postsSampled: number;
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  /** (avg likes + avg comments) / followers */
  erFollowers: number | null;
  /** (avg likes + avg comments) / avg views */
  erViews: number | null;

  /* ---- scouting signals ---- */
  /** Newest posts' performance divided by older posts' */
  momentum: number | null;
  /** Average views divided by followers */
  reach: number | null;
  /** 0–100: how strongly the account looks like it's on the rise */
  breakout: number | null;
  /** Sponsored posts among the recent posts */
  brandDeals: number;
  /** Bio mentions a manager, agency or management email */
  managed: boolean;
  /** Bio or account type reads like a shop or company, not a creator */
  business: boolean;
  /** Average views are tiny next to follower count */
  lowReach: boolean;
  /** Estimated from pronouns, bio words or first name; never from photos */
  gender: Gender;
  genderSource: GenderSource;
  daysSinceLastPost: number | null;
  postsPerWeek: number | null;

  verified: boolean;
  /** True for generated demo data */
  sample: boolean;
  /** From a quick scan: followers and views of the niche posts found, not yet their latest posts */
  preview: boolean;
}

export interface SearchRequest {
  query: string;
  platforms: Platform[];
  /** ISO-2 code used to bias results where the platform supports it */
  region: string | null;
  /** Creators to fetch per platform */
  limit: number;
}

export type JobStage = "discover" | "profiles";

export interface Job {
  platform: Platform;
  runId: string;
  stage: JobStage;
  /** Discovery run this profile run came from, used for country hints */
  from?: string;
  limit: number;
  query: string;
  /** ISO-2 region the search is aimed at */
  region?: string | null;
}

export interface ProviderError {
  platform: Platform;
  message: string;
}

export interface SavedResult {
  platform: Platform;
  /** When the saved results were fetched, ms since epoch */
  savedAt: number;
}

export interface SearchResponse {
  mode: "sample" | "live";
  creators: Creator[];
  jobs: Job[];
  errors: ProviderError[];
  /** Platforms answered from results saved in the last week, at no cost */
  saved?: SavedResult[];
}

export interface JobResponse {
  status: "running" | "done" | "failed";
  creators: Creator[];
  /** Set when one stage finished and the next has started */
  next?: Job;
  message?: string;
}
