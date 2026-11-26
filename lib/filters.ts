import { cpm } from "./metrics.ts";
import { countryName, languageName } from "./countries.ts";
import { RISING } from "./signals.ts";
import { PLATFORM_LABEL, type Creator, type Platform } from "./types.ts";
import type { Gender } from "./gender.ts";

export type ErBasis = "followers" | "views";
export type Metric = "followers" | "avgViews" | "er";
export type Scale = "log" | "linear";
export type SortKey = Metric | "avgLikes" | "breakout" | "brandDeals" | "cpm" | "name";

/** Slider positions as fractions of the metric's domain. 0 and 1 mean "no bound". */
export interface Range {
  lo: number;
  hi: number;
}

export interface Signals {
  /** Breakout score at or above RISING */
  rising: boolean;
  /** No sponsored posts among recent posts */
  noDeals: boolean;
  /** No manager or agency in the bio */
  noManager: boolean;
  /** Hide accounts that read like shops or companies */
  hideBusiness: boolean;
  /** Hide accounts under 1,000 followers */
  hideTiny: boolean;
  /** Hide accounts with no post in 60 days */
  hideInactive: boolean;
  /** Hide accounts whose views are tiny next to their followers */
  hideLowReach: boolean;
}

export interface Filters {
  ranges: Record<Metric, Range>;
  signals: Signals;
  countries: string[];
  includeUnknownCountry: boolean;
  /** "any", or only creators estimated as this gender */
  gender: "any" | Exclude<Gender, "unknown">;
  includeUnknownGender: boolean;
  /** ISO 639-1 codes; empty means any */
  languages: string[];
  platforms: Platform[];
  shortlistOnly: boolean;
}

export const METRICS: Metric[] = ["followers", "avgViews", "er"];
export const SCALE: Record<Metric, Scale> = { followers: "log", avgViews: "log", er: "linear" };
export const FULL: Range = { lo: 0, hi: 1 };
export const TINY = 1_000;
export const INACTIVE_DAYS = 60;

export const DEFAULT_SIGNALS: Signals = { rising: false, noDeals: false, noManager: false, hideBusiness: true, hideTiny: true, hideInactive: false, hideLowReach: false };

export function emptyFilters(platforms: Platform[]): Filters {
  return {
    ranges: { followers: { ...FULL }, avgViews: { ...FULL }, er: { ...FULL } },
    signals: { ...DEFAULT_SIGNALS },
    countries: [],
    includeUnknownCountry: true,
    gender: "any",
    // "Women" means women: creators Scout can't place are one checkbox away.
    includeUnknownGender: false,
    languages: [],
    platforms: [...platforms],
    shortlistOnly: false,
  };
}

export function metricValue(c: Creator, m: Metric, basis: ErBasis): number | null {
  if (m === "er") return basis === "followers" ? c.erFollowers : c.erViews;
  return c[m];
}

export type Domain = [number, number];

export function domainOf(values: number[], scale: Scale): Domain {
  const ok = values.filter((v) => Number.isFinite(v) && (scale === "linear" || v > 0));
  if (ok.length === 0) return scale === "log" ? [1, 1_000_000] : [0, 0.2];
  let min = Math.min(...ok);
  let max = Math.max(...ok);
  if (scale === "linear") min = 0;
  if (max <= min) max = scale === "log" ? min * 10 : min + 0.01;
  return [min, max];
}

export function fracToValue(f: number, [min, max]: Domain, scale: Scale): number {
  if (scale === "linear") return min + f * (max - min);
  return Math.exp(Math.log(min) + f * (Math.log(max) - Math.log(min)));
}

export function valueToFrac(v: number, [min, max]: Domain, scale: Scale): number {
  if (scale === "linear") return max === min ? 0 : (v - min) / (max - min);
  if (v <= 0) return 0;
  return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
}

export function isActive(r: Range): boolean {
  return r.lo > 0 || r.hi < 1;
}

export function inRange(v: number | null, r: Range, d: Domain, scale: Scale): boolean {
  if (!isActive(r)) return true;
  if (v === null) return false;
  if (r.lo > 0 && v < fracToValue(r.lo, d, scale)) return false;
  if (r.hi < 1 && v > fracToValue(r.hi, d, scale)) return false;
  return true;
}

export function passesSignals(c: Creator, s: Signals): boolean {
  if (s.rising && (c.breakout === null || c.breakout < RISING)) return false;
  if (s.noDeals && (c.postsSampled === 0 || c.brandDeals > 0)) return false;
  if (s.noManager && c.managed) return false;
  if (s.hideBusiness && c.business) return false;
  if (s.hideTiny && c.followers !== null && c.followers < TINY) return false;
  if (s.hideInactive && (c.daysSinceLastPost === null || c.daysSinceLastPost > INACTIVE_DAYS)) return false;
  if (s.hideLowReach && c.lowReach) return false;
  return true;
}

/** Filters that apply before the sliders: platform, shortlist, signals and country. */
export function baseFilter(creators: Creator[], f: Filters, shortlist: Set<string>): Creator[] {
  return creators.filter((c) => {
    if (!f.platforms.includes(c.platform)) return false;
    if (f.shortlistOnly && !shortlist.has(c.id)) return false;
    if (!passesSignals(c, f.signals)) return false;
    if (f.languages.length > 0 && (c.language === null || !f.languages.includes(c.language))) return false;
    if (f.gender !== "any") {
      if (c.gender === "unknown") { if (!f.includeUnknownGender) return false; }
      else if (c.gender !== f.gender) return false;
    }
    if (c.country === null) return f.includeUnknownCountry;
    return f.countries.length === 0 || f.countries.includes(c.country);
  });
}

export function applyFilters(creators: Creator[], f: Filters, domains: Record<Metric, Domain>, basis: ErBasis, shortlist: Set<string>): Creator[] {
  return baseFilter(creators, f, shortlist).filter((c) =>
    METRICS.every((m) => inRange(metricValue(c, m, basis), f.ranges[m], domains[m], SCALE[m])),
  );
}

export function sortValue(c: Creator, key: SortKey, basis: ErBasis, fee: number): number | string | null {
  if (key === "name") return c.name.toLowerCase();
  if (key === "cpm") return cpm(fee, c.avgViews);
  if (key === "avgLikes") return c.avgLikes;
  if (key === "breakout") return c.breakout;
  if (key === "brandDeals") return c.postsSampled ? c.brandDeals : null;
  return metricValue(c, key, basis);
}

/** Sort with nulls always last. */
export function sortCreators(list: Creator[], key: SortKey, dir: "asc" | "desc", basis: ErBasis, fee: number): Creator[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, key, basis, fee);
    const vb = sortValue(b, key, basis, fee);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -1 * sign;
    if (va > vb) return 1 * sign;
    return 0;
  });
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // stop spreadsheet formula injection from bios
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(list: Creator[], fee: number): string {
  const head = [
    "Platform", "Handle", "Name", "Profile URL", "Country", "Followers", "Avg views", "Avg likes", "Avg comments",
    "ER (by followers)", "ER (by views)", "Breakout score", "Momentum", "Brand deals in recent posts", "Posts sampled",
    "Manager listed", "Gender (estimated)", "Gender based on", "Language", "Low views for size", "Days since last post", "Posts per week", "CPM at fee", "Bio",
  ];
  const rows = list.map((c) => {
    const r = (n: number | null, d = 0) => (n === null ? "" : n.toFixed(d));
    const p = (n: number | null) => (n === null ? "" : (n * 100).toFixed(2) + "%");
    return [
      PLATFORM_LABEL[c.platform], c.handle, c.name, c.url, c.country ? countryName(c.country) : "",
      r(c.followers), r(c.avgViews), r(c.avgLikes), r(c.avgComments), p(c.erFollowers), p(c.erViews),
      r(c.breakout), c.momentum === null ? "" : c.momentum.toFixed(2) + "x", c.brandDeals, c.postsSampled,
      c.managed ? "Yes" : "No", GENDER_LABEL[c.gender], c.genderSource ? GENDER_SOURCE_LABEL[c.genderSource] : "", c.language ? languageName(c.language) : "", c.lowReach ? "Yes" : "No", r(c.daysSinceLastPost), r(c.postsPerWeek, 1), fee ? r(cpm(fee, c.avgViews), 2) : "",
      c.bio.replace(/\s+/g, " "),
    ].map(csvCell).join(",");
  });
  return [head.map(csvCell).join(","), ...rows].join("\n");
}

export const GENDER_LABEL: Record<Gender, string> = { woman: "Woman", man: "Man", unknown: "Unknown" };
export const GENDER_SOURCE_LABEL: Record<string, string> = { pronouns: "pronouns in bio", bio: "words in bio", name: "first name", you: "set by you" };

/* ---------- formatting ---------- */

export function compact(n: number | null): string {
  if (n === null) return "–";
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  if (n > 0 && n < 10) return n.toFixed(1).replace(/\.0$/, "");
  return Math.round(n).toString();
}

export function pct(n: number | null): string {
  if (n === null) return "–";
  const p = n * 100;
  if (p >= 1000) return ">999%";
  return (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + "%";
}

export function money(n: number | null): string {
  if (n === null) return "–";
  return "$" + (n >= 100 ? n.toFixed(0) : n.toFixed(2));
}

export function times(n: number | null): string {
  if (n === null) return "–";
  return (n >= 10 ? n.toFixed(0) : n.toFixed(1)) + "×";
}

export function ago(days: number | null): string {
  if (days === null) return "unknown";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
