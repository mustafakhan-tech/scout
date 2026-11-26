import type { Platform } from "./types.ts";

/*
 * Deal Check: is a creator deal worth it, and what's a fair fee?
 * Every number on the page comes from these functions, so they're kept pure and tested.
 */

export interface Benchmark {
  /** CPM in USD: cost per 1,000 views */
  low: number;
  mid: number;
  high: number;
  note: string;
}

/**
 * Fair-price CPM bands for one sponsored post. Published ranges disagree a lot, so these sit
 * across the main sources listed on the page; users can override with their own target.
 */
export const BENCHMARKS: Record<Platform, Benchmark> = {
  tiktok: { low: 5, mid: 10, high: 15, note: "Short videos are cheap to watch and quick to scroll past." },
  instagram: { low: 8, mid: 15, high: 30, note: "Reels sit at the low end; Stories and carousels cost more per view." },
  youtube: { low: 15, mid: 30, high: 50, note: "The most expensive per view, but videos keep getting views for months." },
};

export interface DealInput {
  platform: Platform;
  /** Creator's average views per post */
  avgViews: number;
  /** Number of sponsored posts in the deal */
  posts: number;
  /** Creator's fee for the whole deal */
  fee: number;
  /** Other costs: usage rights, product, agency fee, rush */
  extras: number;
  /** Share of views that click the link, 0–1 */
  ctr: number;
  /** Share of clicks that sign up or buy, 0–1 */
  cvr: number;
  /** What one conversion is worth. For B2B, set via valueFromFunnel */
  valuePerConversion: number;
  /** Views swing a lot post to post; the range uses ±this share, 0–1 */
  spread: number;
  /** Your own target CPM, overriding the benchmark mid, or null */
  targetCpm: number | null;
}

export interface Band {
  low: number;
  mid: number;
  high: number;
}

export interface DealResult {
  cost: number;
  views: Band;
  clicks: Band;
  conversions: Band;
  revenue: Band;
  /** (revenue - cost) / cost */
  roi: Band;
  cpm: number | null;
  cpc: number | null;
  cpa: number | null;
  breakEvenConversions: number | null;
  /** Click-through rate needed to break even at the current conversion rate */
  breakEvenCtr: number | null;
  /** Fair fee for the posts, from the benchmark CPM band (or target) */
  fairFee: Band;
  askVsFair: "below" | "within" | "above";
  /** Suggested counter-offer when the ask is above range, rounded to $25 */
  counter: number | null;
  verdict: "profitable" | "breakeven" | "unprofitable" | "unknown";
}

const band = (mid: number, spread: number): Band => ({ low: mid * (1 - spread), mid, high: mid * (1 + spread) });
const scale = (b: Band, k: number): Band => ({ low: b.low * k, mid: b.mid * k, high: b.high * k });
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** For B2B: a signup is worth (close rate × customer value). */
export function valueFromFunnel(closeRate: number, customerValue: number): number {
  return Math.max(0, closeRate) * Math.max(0, customerValue);
}

export function evaluate(i: DealInput): DealResult {
  const posts = Math.max(1, Math.round(i.posts));
  const cost = Math.max(0, i.fee) + Math.max(0, i.extras);
  const spread = Math.min(0.9, Math.max(0, i.spread));
  const views = band(Math.max(0, i.avgViews) * posts, spread);
  const clicks = scale(views, Math.max(0, i.ctr));
  const conversions = scale(clicks, Math.max(0, i.cvr));
  const value = Math.max(0, i.valuePerConversion);
  const revenue = scale(conversions, value);
  const roi: Band = cost > 0
    ? { low: (revenue.low - cost) / cost, mid: (revenue.mid - cost) / cost, high: (revenue.high - cost) / cost }
    : { low: 0, mid: 0, high: 0 };

  const cpm = views.mid > 0 ? (cost / views.mid) * 1000 : null;
  const cpc = clicks.mid > 0 ? cost / clicks.mid : null;
  const cpa = conversions.mid > 0 ? cost / conversions.mid : null;
  const breakEvenConversions = value > 0 ? cost / value : null;
  const breakEvenCtr =
    breakEvenConversions !== null && views.mid > 0 && i.cvr > 0 ? breakEvenConversions / (views.mid * i.cvr) : null;

  const b = BENCHMARKS[i.platform];
  const cpmBand: Band = i.targetCpm && i.targetCpm > 0
    ? { low: i.targetCpm * 0.75, mid: i.targetCpm, high: i.targetCpm * 1.25 }
    : { low: b.low, mid: b.mid, high: b.high };
  const viewsK = views.mid / 1000;
  const fairFee: Band = { low: viewsK * cpmBand.low, mid: viewsK * cpmBand.mid, high: viewsK * cpmBand.high };
  const fee = Math.max(0, i.fee);
  const askVsFair = fee > fairFee.high ? "above" : fee < fairFee.low ? "below" : "within";
  const counter = askVsFair === "above" ? Math.max(25, roundTo(fairFee.mid, 25)) : null;

  let verdict: DealResult["verdict"] = "unknown";
  if (value > 0 && cost > 0) {
    if (revenue.low >= cost) verdict = "profitable";
    else if (revenue.high < cost) verdict = "unprofitable";
    else verdict = "breakeven";
  }

  return { cost, views, clicks, conversions, revenue, roi, cpm, cpc, cpa, breakEvenConversions, breakEvenCtr, fairFee, askVsFair, counter, verdict };
}

/** A short, polite counter-offer the user can paste. */
export function counterMessage(name: string, platform: Platform, r: DealResult, posts: number): string {
  if (r.counter === null) return "";
  const who = name.trim() || "there";
  const views = Math.round(r.views.mid / 1000);
  const what = posts > 1 ? `${posts} posts` : "one post";
  return [
    `Hi ${who}, thanks for sending your rate.`,
    `For ${what}, we're planning around roughly ${views}K views based on your recent average, and our budget for ${platform === "youtube" ? "YouTube" : platform === "tiktok" ? "TikTok" : "Instagram"} works out to about $${r.counter.toLocaleString("en-US")}.`,
    "Would that work for you? We're also happy to talk about a performance bonus if the post beats your average.",
  ].join(" ");
}
