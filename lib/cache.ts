/*
 * A week-long memory for search results, kept in a key-value store on the same Apify account.
 * Repeat searches and re-checked creators then cost nothing. The cache is optional:
 * if Apify's storage can't be reached, Scout just searches as normal.
 */
import type { Creator, Platform } from "./types.ts";

const API = "https://api.apify.com/v2";
const STORE_NAME = "scout-cache";
export const CACHE_DAYS = 7;
const MAX_AGE_MS = CACHE_DAYS * 86_400_000;

type Env = Record<string, string | undefined>;
let storeId: Promise<string> | null = null;

/** Apify record keys allow letters, digits and !-_.'() only. */
function safe(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "x";
}

export function scanKey(platform: Platform, query: string, region: string | null, limit: number): string {
  return `scan_${platform}_${region ?? "any"}_${limit}_${safe(query)}`;
}

export function profileKey(platform: Platform, handle: string): string {
  return `profile_${platform}_${safe(handle)}`;
}

async function store(env: Env): Promise<string> {
  // Creating a named store returns the existing one if it's already there.
  storeId ??= fetch(`${API}/key-value-stores?name=${STORE_NAME}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.APIFY_TOKEN}` },
    cache: "no-store",
  })
    .then((r) => r.json())
    .then((b) => {
      if (!b?.data?.id) throw new Error("No cache store");
      return b.data.id as string;
    })
    .catch((e) => {
      storeId = null;
      throw e;
    });
  return storeId;
}

interface Saved<T> { savedAt: number; data: T }

export async function cacheGet<T>(key: string, env: Env, now = Date.now()): Promise<Saved<T> | null> {
  if (!env.APIFY_TOKEN) return null;
  try {
    const id = await store(env);
    const res = await fetch(`${API}/key-value-stores/${id}/records/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${env.APIFY_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const saved = (await res.json()) as Saved<T>;
    return saved && typeof saved.savedAt === "number" && now - saved.savedAt <= MAX_AGE_MS ? saved : null;
  } catch {
    return null;
  }
}

export async function cachePut<T>(key: string, data: T, env: Env): Promise<void> {
  if (!env.APIFY_TOKEN) return;
  try {
    const id = await store(env);
    await fetch(`${API}/key-value-stores/${id}/records/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${env.APIFY_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ savedAt: Date.now(), data } satisfies Saved<T>),
      cache: "no-store",
    });
  } catch {
    /* saving is best-effort */
  }
}

/** Swap quick-scan previews for full profiles analyzed in the last week. */
export async function withSavedProfiles(creators: Creator[], env: Env): Promise<Creator[]> {
  return Promise.all(
    creators.map(async (c) => {
      if (!c.preview) return c;
      const saved = await cacheGet<Creator>(profileKey(c.platform, c.handle), env);
      if (!saved) return c;
      const full = saved.data;
      return !full.country && c.country ? { ...full, country: c.country, countrySource: c.countrySource } : full;
    }),
  );
}

export async function saveProfiles(creators: Creator[], env: Env): Promise<void> {
  await Promise.all(creators.filter((c) => !c.preview).map((c) => cachePut(profileKey(c.platform, c.handle), c, env)));
}
