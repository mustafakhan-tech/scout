export type Platform = "youtube" | "instagram" | "tiktok";

export const PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

/** Where a creator's country came from. */
export type CountrySource = "profile" | "posts" | "sample";

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
  followers: number | null;
  /** How many recent posts the averages are based on */
  postsSampled: number;
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  /** (avg likes + avg comments) / followers */
  erFollowers: number | null;
  /** (avg likes + avg comments) / avg views */
  erViews: number | null;
  verified: boolean;
  /** True for generated demo data */
  sample: boolean;
}

export interface SearchRequest {
  query: string;
  platforms: Platform[];
  /** ISO-2 code used to bias results where the platform supports it */
  region: string | null;
  /** Creators to fetch per platform */
  limit: number;
}

export interface Job {
  platform: Platform;
  runId: string;
}

export interface ProviderError {
  platform: Platform;
  message: string;
}

export interface SearchResponse {
  mode: "sample" | "live";
  creators: Creator[];
  jobs: Job[];
  errors: ProviderError[];
}

export interface JobResponse {
  status: "running" | "done" | "failed";
  creators: Creator[];
  message?: string;
}
