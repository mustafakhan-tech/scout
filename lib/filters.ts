import { cpm } from "./metrics.ts";
import { countryName } from "./countries.ts";
import { PLATFORM_LABEL, type Creator, type Platform } from "./types.ts";

export type ErBasis = "followers" | "views";
export type Metric = "followers" | "avgViews" | "avgLikes" | "er";
export type Scale = "log" | "linear";
export type SortKey = Metric | "cpm" | "name";

/** Slider positions as fractions of the metric's domain. 0 and 1 mean "no bound". */
export interface Range {
  lo: number;
  hi: number;
}

export interface Filters {
  ranges: Record<Metric, Range>;
  countries: string[];
  includeUnknownCountry: boolean;
  platforms: Platform[];
  shortlistOnly: boolean;
}

export const METRICS: Metric[] = ["followers", "avgViews", "avgLikes", "er"];
export const SCALE: Record<Metric, Scale> = { followers: "log", avgViews: "log", avgLikes: "log", er: "linear" };

export const FULL: Range = { lo: 0, hi: 1 };

export function emptyFilters(platforms: Platform[]): Filters {
  return {
    ranges: { followers: { ...FULL }, avgViews: { ...FULL }, avgLikes: { ...FULL }, er: { ...FULL } },
    countries: [],
    includeUnknownCountry: true,
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

export function applyFilters(
  creators: Creator[],
  f: Filters,
  domains: Record<Metric, Domain>,
  basis: ErBasis,
  shortlist: Set<string>,
): Creator[] {
  return creators.filter((c) => {
    if (!f.platforms.includes(c.platform)) return false;
    if (f.shortlistOnly && !shortlist.has(c.id)) return false;
    if (f.countries.length > 0 || !f.includeUnknownCountry) {
      if (c.country === null) {
        if (!f.includeUnknownCountry) return false;
      } else if (f.countries.length > 0 && !f.countries.includes(c.country)) return false;
    }
    return METRICS.every((m) => inRange(metricValue(c, m, basis), f.ranges[m], domains[m], SCALE[m]));
  });
}

export function sortValue(c: Creator, key: SortKey, basis: ErBasis, fee: number): number | string | null {
  if (key === "name") return c.name.toLowerCase();
  if (key === "cpm") return cpm(fee, c.avgViews);
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
    "Platform", "Handle", "Name", "Profile URL", "Country", "Followers", "Avg views", "Avg likes",
    "Avg comments", "ER (by followers)", "ER (by views)", "Posts sampled", "CPM at fee", "Bio",
  ];
  const rows = list.map((c) => {
    const r = (n: number | null, d = 0) => (n === null ? "" : n.toFixed(d));
    return [
      PLATFORM_LABEL[c.platform], c.handle, c.name, c.url, c.country ? countryName(c.country) : "",
      r(c.followers), r(c.avgViews), r(c.avgLikes), r(c.avgComments),
      c.erFollowers === null ? "" : (c.erFollowers * 100).toFixed(2) + "%",
      c.erViews === null ? "" : (c.erViews * 100).toFixed(2) + "%",
      c.postsSampled, fee ? r(cpm(fee, c.avgViews), 2) : "", c.bio.replace(/\s+/g, " "),
    ].map(csvCell).join(",");
  });
  return [head.map(csvCell).join(","), ...rows].join("\n");
}

/* ---------- formatting ---------- */

export function compact(n: number | null): string {
  if (n === null) return "–";
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return Math.round(n).toString();
}

export function pct(n: number | null): string {
  if (n === null) return "–";
  const p = n * 100;
  return (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + "%";
}

export function money(n: number | null): string {
  if (n === null) return "–";
  return "$" + (n >= 100 ? n.toFixed(0) : n.toFixed(2));
}
