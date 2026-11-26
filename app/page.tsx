"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RangeHistogram from "./components/RangeHistogram.tsx";
import CreatorPanel from "./components/CreatorPanel.tsx";
import { COUNTRIES, countryName, flag, languageName } from "@/lib/countries.ts";
import { cpm, dedupe } from "@/lib/metrics.ts";
import { RISING } from "@/lib/signals.ts";
import { COST_PER_CREATOR } from "@/lib/apify.ts";
import type { Gender } from "@/lib/gender.ts";
import {
  GENDER_LABEL, GENDER_SOURCE_LABEL,
  applyFilters, baseFilter, compact, domainOf, emptyFilters, INACTIVE_DAYS, METRICS, metricValue, money, passesSignals, pct, SCALE,
  sortCreators, toCsv, type Domain, type ErBasis, type Filters, type Metric, type Signals, type SortKey,
} from "@/lib/filters.ts";
import { PLATFORM_LABEL, PLATFORMS, type Creator, type Job, type JobResponse, type Platform, type SearchResponse } from "@/lib/types.ts";

const KEY_STORE = "scout-key";
const SHORTLIST_STORE = "scout-shortlist";
const GENDER_STORE = "scout-gender";
const POLL_MS = 5000;
const POLL_LIMIT_MS = 8 * 60 * 1000;

type Access = "sample" | "live" | "denied";
interface JobState extends Job { status: "running" | "done" | "failed"; message?: string; startedAt: number }
interface ProviderNote { platform: Platform; message: string }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

const METRIC_LABEL: Record<Metric, string> = { followers: "Followers", avgViews: "Average views", er: "Engagement rate" };

const SIGNAL_LABEL: Record<keyof Signals, { label: string; hint: string }> = {
  rising: { label: "Rising", hint: `Breakout score of ${RISING} or more` },
  noDeals: { label: "No brand deals yet", hint: "None of their recent posts are sponsored" },
  noManager: { label: "No manager listed", hint: "Bio doesn't mention a manager or agency" },
  hideInactive: { label: "Posted recently", hint: `Posted in the last ${INACTIVE_DAYS} days` },
  hideBusiness: { label: "Hide shops and companies", hint: "Bio or account type reads like a store or business" },
  hideTiny: { label: "Hide accounts under 1K followers", hint: "Filters out brand-new and dormant accounts" },
  hideLowReach: { label: "Hide low views for size", hint: "Views under 2% of followers, which often means bought or long-gone followers" },
};
const SIGNAL_ORDER: (keyof Signals)[] = ["rising", "noDeals", "noManager", "hideInactive", "hideBusiness", "hideTiny", "hideLowReach"];

function stageText(j: JobState): string {
  if (j.status === "failed") return j.message || "search failed.";
  if (j.status === "done") return j.message || "results are in.";
  return j.stage === "discover"
    ? "is finding creators who post about this niche. This takes about a minute."
    : "is reading their recent posts. Results appear here as soon as they're ready.";
}

export default function Home() {
  // --- access ---
  const [key, setKey] = useState<string>("");
  const [access, setAccess] = useState<Access>("sample");
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockDraft, setUnlockDraft] = useState("");
  const [unlockError, setUnlockError] = useState("");

  // --- search ---
  const [query, setQuery] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([...PLATFORMS]);
  const [region, setRegion] = useState("");
  const [limit, setLimit] = useState(20);
  const [searching, setSearching] = useState(false);
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [mode, setMode] = useState<"sample" | "live">("sample");
  const [creators, setCreators] = useState<Creator[]>([]);
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [notes, setNotes] = useState<ProviderNote[]>([]);
  const [formError, setFormError] = useState("");

  // --- refine ---
  const [filters, setFilters] = useState<Filters>(emptyFilters(PLATFORMS));
  const [basis, setBasis] = useState<ErBasis>("followers");
  const [fee, setFee] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "breakout", dir: "desc" });
  const [shortlist, setShortlist] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [genderFix, setGenderFix] = useState<Record<string, Gender>>({});
  const searchSeq = useRef(0);
  const [railOpen, setRailOpen] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setRailOpen(false);
  }, []);

  const headers = useCallback((k = key): HeadersInit => (k ? { "x-scout-key": k } : {}), [key]);

  const checkAccess = useCallback(async (k: string) => {
    const res = await fetch("/api/config", { headers: k ? { "x-scout-key": k } : {} });
    const body = await res.json();
    setLiveAvailable(Boolean(body.liveAvailable));
    return body.access as Access;
  }, []);

  useEffect(() => {
    const stored = load<string>(KEY_STORE, "");
    setShortlist(new Set(load<string[]>(SHORTLIST_STORE, [])));
    setGenderFix(load<Record<string, Gender>>(GENDER_STORE, {}));
    checkAccess(stored).then((a) => {
      if (a === "live") { setKey(stored); setAccess("live"); }
      else if (stored) save(KEY_STORE, "");
    }).catch(() => {});
  }, [checkAccess]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlockError("");
    const a = await checkAccess(unlockDraft).catch(() => "denied" as Access);
    if (a === "live") {
      setKey(unlockDraft); setAccess("live"); save(KEY_STORE, unlockDraft);
      setUnlockOpen(false); setUnlockDraft("");
    } else {
      setUnlockError("That password isn't right.");
    }
  }

  function lock() {
    setKey(""); setAccess("sample"); save(KEY_STORE, "");
  }

  function togglePlatform(p: Platform) {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : PLATFORMS.filter((x) => x === p || cur.includes(x))));
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!query.trim()) return setFormError("Type a niche to search for, like “home espresso”.");
    if (platforms.length === 0) return setFormError("Pick at least one platform.");
    const seq = ++searchSeq.current;
    setSearching(true);
    setCreators([]); setJobs([]); setNotes([]); setOpenId(null);
    setFilters((f) => ({
      ...emptyFilters(platforms),
      signals: f.signals,
      gender: f.gender,
      includeUnknownGender: f.includeUnknownGender,
      countries: region ? [region] : [],
    }));
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ query, platforms, region: region || null, limit }),
      });
      const body = await res.json();
      if (seq !== searchSeq.current) return;
      if (!res.ok) {
        if (res.status === 401) lock();
        return setFormError(body.message || "Search failed. Try again.");
      }
      const data = body as SearchResponse;
      setMode(data.mode);
      setCreators(data.creators);
      setNotes(data.errors);
      setJobs(data.jobs.map((j) => ({ ...j, status: "running", startedAt: Date.now() })));
      setSearchedFor(query.trim());
    } catch {
      if (seq === searchSeq.current) setFormError("Couldn't reach the server. Check your connection and search again.");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  // Poll Apify runs for Instagram and TikTok. A discovery run hands off to a profiles run.
  const running = jobs.filter((j) => j.status === "running");
  const runningKey = running.map((j) => j.runId).join(",");
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!runningKey) return;
    const seq = searchSeq.current;
    const timer = setTimeout(async () => {
      for (const job of jobsRef.current.filter((j) => j.status === "running")) {
        if (Date.now() - job.startedAt > POLL_LIMIT_MS) {
          setJobs((cur) => cur.map((j) => (j.runId === job.runId ? { ...j, status: "failed", message: "is taking longer than 8 minutes. Check the run in your Apify console." } : j)));
          continue;
        }
        try {
          const qs = new URLSearchParams({ stage: job.stage, limit: String(job.limit), q: job.query, ...(job.from ? { from: job.from } : {}), ...(job.region ? { region: job.region } : {}) });
          const res = await fetch(`/api/jobs/${job.platform}/${job.runId}?${qs}`, { headers: headers() });
          const body = (await res.json()) as JobResponse;
          if (seq !== searchSeq.current) return;
          if (body.creators?.length) setCreators((cur) => dedupe([...cur, ...body.creators]));
          if (body.next) {
            const next = body.next;
            setJobs((cur) => cur.map((j) => (j.runId === job.runId ? { ...next, status: "running", startedAt: j.startedAt } : j)));
          } else if (body.status !== "running") {
            setJobs((cur) => cur.map((j) => (j.runId === job.runId ? { ...j, status: body.status, message: body.message } : j)));
          }
        } catch {
          /* transient: try again next tick */
        }
      }
      if (seq === searchSeq.current) setTick((t) => t + 1);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [runningKey, tick, headers]);

  // --- derived ---
  // Your own gender corrections win over Scout's estimate.
  const all = useMemo(
    () => creators.map((c) => (genderFix[c.id] ? { ...c, gender: genderFix[c.id], genderSource: "you" as const } : c)),
    [creators, genderFix],
  );
  const genderCounts = useMemo(() => {
    const n = { woman: 0, man: 0, unknown: 0 };
    for (const c of all) if (filters.platforms.includes(c.platform) && passesSignals(c, filters.signals)) n[c.gender]++;
    return n;
  }, [all, filters.platforms, filters.signals]);
  const estCost = (platforms.includes("tiktok") ? limit * COST_PER_CREATOR.tiktok : 0) + (platforms.includes("instagram") ? limit * COST_PER_CREATOR.instagram : 0);

  const domains = useMemo(() => {
    const d = {} as Record<Metric, Domain>;
    for (const m of METRICS) d[m] = domainOf(all.map((c) => metricValue(c, m, basis)).filter((v): v is number => v !== null), SCALE[m]);
    return d;
  }, [all, basis]);

  const visible = useMemo(
    () => sortCreators(applyFilters(all, filters, domains, basis, shortlist), sort.key, sort.dir, basis, fee),
    [all, filters, domains, basis, shortlist, sort, fee],
  );

  // What the sliders and counts are drawn from: everything except the sliders themselves.
  const pool = useMemo(() => baseFilter(all, filters, shortlist), [all, filters, shortlist]);

  const signalCounts = useMemo(() => {
    const out = {} as Record<keyof Signals, number>;
    const others = all.filter((c) => filters.platforms.includes(c.platform));
    for (const s of SIGNAL_ORDER) {
      out[s] = others.filter((c) => passesSignals(c, { ...filters.signals, [s]: true })).length;
    }
    return out;
  }, [all, filters.platforms, filters.signals]);

  const countryCounts = useMemo(() => {
    const m = new Map<string, number>();
    let unknown = 0;
    for (const c of all) {
      if (!filters.platforms.includes(c.platform) || !passesSignals(c, filters.signals)) continue;
      if (c.country) m.set(c.country, (m.get(c.country) ?? 0) + 1);
      else unknown++;
    }
    return { list: [...m.entries()].sort((a, b) => b[1] - a[1]), unknown };
  }, [creators, filters.platforms, filters.signals]);

  const languageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of all) {
      if (!filters.platforms.includes(c.platform) || !passesSignals(c, filters.signals) || !c.language) continue;
      m.set(c.language, (m.get(c.language) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [creators, filters.platforms, filters.signals]);

  const resultPlatforms = PLATFORMS.filter((p) => creators.some((c) => c.platform === p));
  const open = openId ? all.find((c) => c.id === openId) ?? null : null;

  function setRange(m: Metric, r: { lo: number; hi: number }) {
    setFilters((f) => ({ ...f, ranges: { ...f.ranges, [m]: r } }));
  }
  function setSignal(s: keyof Signals, on: boolean) {
    setFilters((f) => ({ ...f, signals: { ...f.signals, [s]: on } }));
  }
  function toggleCountry(code: string) {
    setFilters((f) => ({ ...f, countries: f.countries.includes(code) ? f.countries.filter((c) => c !== code) : [...f.countries, code] }));
  }
  function toggleLanguage(code: string) {
    setFilters((f) => ({ ...f, languages: f.languages.includes(code) ? f.languages.filter((c) => c !== code) : [...f.languages, code] }));
  }
  function toggleShortlist(id: string) {
    setShortlist((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      save(SHORTLIST_STORE, [...next]);
      return next;
    });
  }
  function sortBy(k: SortKey) {
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "desc" ? "asc" : "desc" } : { key: k, dir: k === "name" || k === "cpm" || k === "brandDeals" ? "asc" : "desc" }));
  }
  function exportCsv() {
    const blob = new Blob([toCsv(visible, fee)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scout-${(searchedFor ?? "creators").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const fmt: Record<Metric, (n: number) => string> = { followers: compact, avgViews: compact, er: pct };
  const anyFilter =
    METRICS.some((m) => filters.ranges[m].lo > 0 || filters.ranges[m].hi < 1) ||
    filters.countries.length > 0 || filters.languages.length > 0 || !filters.includeUnknownCountry || filters.shortlistOnly ||
    filters.platforms.length < resultPlatforms.length || SIGNAL_ORDER.some((s) => s !== "hideBusiness" && s !== "hideTiny" && filters.signals[s]);

  const sortHeader = (k: SortKey, label: string, numeric = true) => (
    <th scope="col" className={numeric ? "num" : undefined} aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => sortBy(k)}>
        {label}
        <span className="sort-mark" aria-hidden="true">{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>Scout</h1>
          <p>Find creators before they break out. Search YouTube, Instagram and TikTok by niche, then rank creators by momentum, brand-deal history and engagement.</p>
        </div>
        <div className="access">
          <a className="link-btn" href="/deal">Deal Check</a>
          {access === "live" ? (
            <>
              <span className="mode mode-live">Live search</span>
              <button type="button" className="link-btn" onClick={lock}>Lock</button>
            </>
          ) : (
            <>
              <span className="mode">Sample data</span>
              {liveAvailable && (
                <button type="button" className="link-btn" onClick={() => setUnlockOpen((o) => !o)} aria-expanded={unlockOpen}>
                  Unlock live search
                </button>
              )}
            </>
          )}
          {unlockOpen && access !== "live" && (
            <form className="unlock" onSubmit={unlock}>
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" autoComplete="current-password" value={unlockDraft} onChange={(e) => setUnlockDraft(e.target.value)} />
              <button type="submit" className="btn">Unlock</button>
              {unlockError && <p className="err" role="alert">{unlockError}</p>}
            </form>
          )}
        </div>
      </header>

      <form className="searchbar" onSubmit={search} aria-label="Search for creators">
        <div className="field grow">
          <label htmlFor="q">Niche</label>
          <input id="q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="small business finance, home espresso, modest fashion…" maxLength={100} />
        </div>
        <fieldset className="field">
          <legend>Platforms</legend>
          <div className="toggles">
            {PLATFORMS.map((p) => (
              <label key={p} className={`toggle${platforms.includes(p) ? " on" : ""}`}>
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => togglePlatform(p)} />
                {PLATFORM_LABEL[p]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="region">Region</label>
          <select id="region" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">Anywhere</option>
            {Object.entries(COUNTRIES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="limit">Per platform</label>
          <select id="limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[10, 20, 30, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={searching}>{searching ? "Searching…" : "Search"}</button>
        {access === "live" && estCost > 0 && (
          <p className={`cost-note${estCost > 1 ? " cost-high" : ""}`}>
            Estimated Apify cost for this search: about ${estCost.toFixed(2)}
            {estCost > 1 ? `, roughly ${Math.round((estCost / 5) * 100)}% of the free $5 a month. Try 10–20 per platform first.` : "."}
            {region && platforms.includes("tiktok") ? ` TikTok searches from ${countryName(region)}.` : ""}
            {region && platforms.includes("instagram") ? " Instagram adds local hashtags." : ""}
          </p>
        )}
        {formError && <p className="err form-err" role="alert">{formError}</p>}
      </form>

      {(jobs.length > 0 || notes.length > 0) && (
        <ul className="status" aria-live="polite">
          {jobs.map((j) => (
            <li key={`${j.platform}-${j.stage}`} className={`status-${j.status}`}>
              <strong>{PLATFORM_LABEL[j.platform]}</strong> {stageText(j)}
            </li>
          ))}
          {notes.map((n) => (
            <li key={n.platform} className="status-failed"><strong>{PLATFORM_LABEL[n.platform]}</strong> {n.message}</li>
          ))}
        </ul>
      )}

      {creators.length === 0 && !searching && running.length === 0 ? (
        <section className="empty">
          {searchedFor ? (
            <p>No creators came back for &ldquo;{searchedFor}&rdquo;. Try a broader niche, or another platform.</p>
          ) : (
            <>
              <p className="empty-lead">Search a niche to start a shortlist.</p>
              <p>
                Scout finds people who are actively posting about your niche, reads their latest posts and scores each one on the things a big database won&rsquo;t show you:
              </p>
              <dl className="empty-signals">
                <div><dt>Breakout score</dt><dd>Are their newest posts beating their older ones, and are views running ahead of their follower count?</dd></div>
                <div><dt>Brand deals</dt><dd>How many recent posts are sponsored, so you can be someone&rsquo;s first partner.</dd></div>
                <div><dt>Manager</dt><dd>Whether the bio lists a manager or agency, so you know who you&rsquo;ll be talking to.</dd></div>
              </dl>
              {access !== "live" && <p className="muted">You&rsquo;re seeing sample data. The creators are invented, but the scoring and filters work exactly as they do on live results.</p>}
            </>
          )}
        </section>
      ) : (
        <div className="workspace">
          <aside className="rail" aria-label="Filters">
            <details open={railOpen} onToggle={(e) => setRailOpen((e.target as HTMLDetailsElement).open)} className="rail-inner">
              <summary>Filters{anyFilter ? " (on)" : ""}</summary>

              <fieldset className="rail-group">
                <legend>Scout for</legend>
                <ul className="signal-list">
                  {SIGNAL_ORDER.map((s) => (
                    <li key={s}>
                      <label className="check">
                        <input type="checkbox" checked={filters.signals[s]} onChange={(e) => setSignal(s, e.target.checked)} />
                        <span>
                          {SIGNAL_LABEL[s].label} <span className="chip-n">{signalCounts[s]}</span>
                          <span className="check-hint">{SIGNAL_LABEL[s].hint}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>

              <fieldset className="rail-group">
                <legend>Gender</legend>
                <div className="seg seg-wide">
                  {(["any", "woman", "man"] as const).map((g) => (
                    <label key={g} className={filters.gender === g ? "on" : undefined}>
                      <input type="radio" name="gender" checked={filters.gender === g} onChange={() => setFilters((f) => ({ ...f, gender: g }))} />
                      {g === "any" ? "Any" : g === "woman" ? `Women ${genderCounts.woman}` : `Men ${genderCounts.man}`}
                    </label>
                  ))}
                </div>
                {filters.gender !== "any" && (
                  <label className="check">
                    <input type="checkbox" checked={filters.includeUnknownGender} onChange={(e) => setFilters((f) => ({ ...f, includeUnknownGender: e.target.checked }))} />
                    <span>Include creators Scout can&rsquo;t tell ({genderCounts.unknown})</span>
                  </label>
                )}
                <p className="rh-hint">Estimated from pronouns or words in the bio, then the first name. Never from photos. Open a creator to correct it.</p>
              </fieldset>

              {resultPlatforms.length > 1 && (
                <fieldset className="rail-group">
                  <legend>Show</legend>
                  <div className="toggles">
                    {resultPlatforms.map((p) => (
                      <label key={p} className={`toggle small${filters.platforms.includes(p) ? " on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={filters.platforms.includes(p)}
                          onChange={() => setFilters((f) => ({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] }))}
                        />
                        {PLATFORM_LABEL[p]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {METRICS.map((m) => (
                <RangeHistogram
                  key={m}
                  label={METRIC_LABEL[m]}
                  hint={m === "er" ? (basis === "followers" ? "Likes and comments per post, divided by followers." : "Likes and comments per post, divided by views.") : m === "avgViews" ? "Instagram photos have no view count, so some creators show none." : undefined}
                  values={pool.map((c) => metricValue(c, m, basis)).filter((v): v is number => v !== null)}
                  domain={domains[m]}
                  scale={SCALE[m]}
                  range={filters.ranges[m]}
                  onChange={(r) => setRange(m, r)}
                  format={fmt[m]}
                />
              ))}

              <fieldset className="rail-group">
                <legend>Country</legend>
                <div className="chips">
                  {countryCounts.list.map(([code, n]) => (
                    <button key={code} type="button" className={`chip${filters.countries.includes(code) ? " on" : ""}`} aria-pressed={filters.countries.includes(code)} onClick={() => toggleCountry(code)}>
                      <span aria-hidden="true">{flag(code)}</span> {countryName(code)} <span className="chip-n">{n}</span>
                    </button>
                  ))}
                </div>
                <label className="check">
                  <input type="checkbox" checked={filters.includeUnknownCountry} onChange={(e) => setFilters((f) => ({ ...f, includeUnknownCountry: e.target.checked }))} />
                  <span>Include creators with no country listed ({countryCounts.unknown})</span>
                </label>
                <p className="rh-hint">YouTube countries come from the channel profile. TikTok and Instagram rarely share one, so Scout reads flags and places from the bio (marked &ldquo;from bio&rdquo;).</p>
              </fieldset>

              {languageCounts.length > 1 && (
                <fieldset className="rail-group">
                  <legend>Posts in</legend>
                  <div className="chips">
                    {languageCounts.map(([code, n]) => (
                      <button key={code} type="button" className={`chip${filters.languages.includes(code) ? " on" : ""}`} aria-pressed={filters.languages.includes(code)} onClick={() => toggleLanguage(code)}>
                        {languageName(code)} <span className="chip-n">{n}</span>
                      </button>
                    ))}
                  </div>
                  <p className="rh-hint">The language of their recent captions. Useful on TikTok, which doesn&rsquo;t share a country.</p>
                </fieldset>
              )}

              {anyFilter && (
                <button type="button" className="link-btn" onClick={() => setFilters(emptyFilters(resultPlatforms))}>Clear all filters</button>
              )}
            </details>
          </aside>

          <main className="results">
            <div className="toolbar">
              <p className="count">
                <strong>{visible.length}</strong> of {creators.length} creators
                {searchedFor && <> for &ldquo;{searchedFor}&rdquo;</>}
                {mode === "sample" && <span className="tag">sample</span>}
              </p>
              <div className="toolbar-controls">
                <fieldset className="seg">
                  <legend>Engagement by</legend>
                  {(["followers", "views"] as ErBasis[]).map((b) => (
                    <label key={b} className={basis === b ? "on" : undefined}>
                      <input type="radio" name="basis" value={b} checked={basis === b} onChange={() => { setBasis(b); setRange("er", { lo: 0, hi: 1 }); }} />
                      {b === "followers" ? "Followers" : "Views"}
                    </label>
                  ))}
                </fieldset>
                <div className="field inline">
                  <label htmlFor="fee">Fee per post</label>
                  <span className="money-input">
                    <span aria-hidden="true">$</span>
                    <input id="fee" type="number" min={0} step={50} inputMode="numeric" value={fee || ""} placeholder="0" onChange={(e) => setFee(Math.max(0, Number(e.target.value) || 0))} />
                  </span>
                </div>
                <label className="check">
                  <input type="checkbox" checked={filters.shortlistOnly} onChange={(e) => setFilters((f) => ({ ...f, shortlistOnly: e.target.checked }))} />
                  <span>Shortlist only ({creators.filter((c) => shortlist.has(c.id)).length})</span>
                </label>
                <button type="button" className="btn" onClick={exportCsv} disabled={visible.length === 0}>Export CSV</button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="col-star"><span className="sr-only">Shortlist</span></th>
                    {sortHeader("name", "Creator", false)}
                    <th scope="col">Country</th>
                    {sortHeader("followers", "Followers")}
                    {sortHeader("avgViews", "Avg views")}
                    {sortHeader("er", "Engagement")}
                    {sortHeader("breakout", "Breakout")}
                    {sortHeader("brandDeals", "Brand deals")}
                    {fee > 0 && sortHeader("cpm", "CPM")}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => {
                    const er = basis === "followers" ? c.erFollowers : c.erViews;
                    const starred = shortlist.has(c.id);
                    const rising = c.breakout !== null && c.breakout >= RISING;
                    return (
                      <tr key={c.id} className={starred ? "starred" : undefined}>
                        <td className="col-star">
                          <button type="button" className={`star${starred ? " on" : ""}`} aria-pressed={starred} aria-label={`${starred ? "Remove" : "Add"} ${c.name} ${starred ? "from" : "to"} shortlist`} onClick={() => toggleShortlist(c.id)}>
                            {starred ? "★" : "☆"}
                          </button>
                        </td>
                        <td className="who">
                          <button type="button" className="who-open" onClick={() => setOpenId(c.id)}>
                            <span className="name">{c.name}</span>
                            {c.verified && <span className="verified" aria-label="Verified">✓</span>}
                            <span className="sr-only">, open details</span>
                          </button>
                          <div className="who-sub">
                            <span className={`plat plat-${c.platform}`}>{PLATFORM_LABEL[c.platform]}</span>
                            <span className="handle">@{c.handle}</span>
                          </div>
                          <div className="flags">
                            {rising && <span className="tag tag-rise">Rising</span>}
                            {c.managed && <span className="tag">Manager listed</span>}
                            {c.business && <span className="tag">Shop or company</span>}
                            {c.daysSinceLastPost !== null && c.daysSinceLastPost > INACTIVE_DAYS && <span className="tag">Inactive</span>}
                            {c.lowReach && <span className="tag tag-warn">Low views for size</span>}
                          </div>
                        </td>
                        <td className="country">
                          {c.country ? <><span aria-hidden="true">{flag(c.country)}</span> {countryName(c.country)}</> : <span className="muted">Not listed</span>}
                          {c.countrySource === "bio" && <span className="lang">from bio</span>}
                          {c.language && c.language !== "en" && <span className="lang">Posts in {languageName(c.language)}</span>}
                          {c.gender !== "unknown" && <span className="lang">{GENDER_LABEL[c.gender]}{c.genderSource ? ` · ${c.genderSource === "you" ? "set by you" : `from ${c.genderSource === "name" ? "name" : "bio"}`}` : ""}</span>}
                        </td>
                        <td className="num">{compact(c.followers)}</td>
                        <td className="num">{compact(c.avgViews)}</td>
                        <td className="num">{pct(er)}</td>
                        <td className="num">
                          {c.breakout === null ? "–" : (
                            <span className={`meter${rising ? " meter-rise" : ""}`}>
                              <span className="meter-bar" aria-hidden="true"><span style={{ width: `${c.breakout}%` }} /></span>
                              {c.breakout}
                            </span>
                          )}
                        </td>
                        <td className="num">{c.postsSampled ? <>{c.brandDeals}<span className="muted"> / {c.postsSampled}</span></> : "–"}</td>
                        {fee > 0 && <td className="num">{money(cpm(fee, c.avgViews))}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visible.length === 0 && creators.length > 0 && <p className="none">No creators match these filters. Turn off a &ldquo;Scout for&rdquo; filter or widen a range.</p>}
            </div>
            <p className="footnote">
              Averages use each creator&rsquo;s most recent posts (up to 10 on YouTube, 8 on Instagram, 6 on TikTok). Breakout compares their 3 newest posts with the ones before and checks views against followers. 50 means typical, {RISING} or more means rising. Brand deals counts posts marked as ads or with sponsor language in the caption. CPM is your fee divided by average views, per thousand views.
            </p>
          </main>
        </div>
      )}

      {open && (
        <CreatorPanel
          creator={open}
          niche={searchedFor ?? query}
          basis={basis}
          starred={shortlist.has(open.id)}
          onToggleStar={() => toggleShortlist(open.id)}
          onSetGender={(g) => {
            setGenderFix((cur) => {
              const next = { ...cur };
              if (g === null) delete next[open.id]; else next[open.id] = g;
              save(GENDER_STORE, next);
              return next;
            });
          }}
          estimated={creators.find((c) => c.id === open.id)?.gender ?? "unknown"}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
