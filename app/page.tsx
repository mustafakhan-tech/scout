"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RangeHistogram from "./components/RangeHistogram.tsx";
import { COUNTRIES, countryName, flag } from "@/lib/countries.ts";
import { cpm, dedupe } from "@/lib/metrics.ts";
import {
  applyFilters, compact, domainOf, emptyFilters, METRICS, metricValue, money, pct, SCALE, sortCreators, toCsv,
  type Domain, type ErBasis, type Filters, type Metric, type SortKey,
} from "@/lib/filters.ts";
import { PLATFORM_LABEL, PLATFORMS, type Creator, type Job, type JobResponse, type Platform, type SearchResponse } from "@/lib/types.ts";

const KEY_STORE = "scout-key";
const SHORTLIST_STORE = "scout-shortlist";
const POLL_MS = 5000;
const POLL_LIMIT_MS = 6 * 60 * 1000;

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

const METRIC_LABEL: Record<Metric, string> = {
  followers: "Followers",
  avgViews: "Average views",
  avgLikes: "Average likes",
  er: "Engagement rate",
};

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
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "followers", dir: "desc" });
  const [shortlist, setShortlist] = useState<Set<string>>(new Set());
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
    setCreators([]); setJobs([]); setNotes([]);
    setFilters(emptyFilters(platforms));
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

  // Poll Apify runs for Instagram and TikTok
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
          setJobs((cur) => cur.map((j) => (j.runId === job.runId ? { ...j, status: "failed", message: "This is taking longer than 6 minutes. Check the run in your Apify console." } : j)));
          continue;
        }
        try {
          const res = await fetch(`/api/jobs/${job.platform}/${job.runId}`, { headers: headers() });
          const body = (await res.json()) as JobResponse;
          if (seq !== searchSeq.current) return;
          if (body.status === "done") setCreators((cur) => dedupe([...cur, ...body.creators]));
          if (body.status !== "running") {
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
  const domains = useMemo(() => {
    const d = {} as Record<Metric, Domain>;
    for (const m of METRICS) {
      d[m] = domainOf(creators.map((c) => metricValue(c, m, basis)).filter((v): v is number => v !== null), SCALE[m]);
    }
    return d;
  }, [creators, basis]);

  const visible = useMemo(
    () => sortCreators(applyFilters(creators, filters, domains, basis, shortlist), sort.key, sort.dir, basis, fee),
    [creators, filters, domains, basis, shortlist, sort, fee],
  );

  const countryCounts = useMemo(() => {
    const m = new Map<string, number>();
    let unknown = 0;
    for (const c of creators) {
      if (!filters.platforms.includes(c.platform)) continue;
      if (c.country) m.set(c.country, (m.get(c.country) ?? 0) + 1);
      else unknown++;
    }
    return { list: [...m.entries()].sort((a, b) => b[1] - a[1]), unknown };
  }, [creators, filters.platforms]);

  const resultPlatforms = PLATFORMS.filter((p) => creators.some((c) => c.platform === p));

  function setRange(m: Metric, r: { lo: number; hi: number }) {
    setFilters((f) => ({ ...f, ranges: { ...f.ranges, [m]: r } }));
  }
  function toggleCountry(code: string) {
    setFilters((f) => ({ ...f, countries: f.countries.includes(code) ? f.countries.filter((c) => c !== code) : [...f.countries, code] }));
  }
  function toggleShortlist(id: string) {
    setShortlist((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      save(SHORTLIST_STORE, [...next]);
      return next;
    });
  }
  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "name" || key === "cpm" ? "asc" : "desc" }));
  }
  function exportCsv() {
    const blob = new Blob([toCsv(visible, fee)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scout-${(searchedFor ?? "creators").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const fmt: Record<Metric, (n: number) => string> = { followers: compact, avgViews: compact, avgLikes: compact, er: pct };
  const anyFilter = METRICS.some((m) => filters.ranges[m].lo > 0 || filters.ranges[m].hi < 1) || filters.countries.length > 0 || !filters.includeUnknownCountry || filters.shortlistOnly || filters.platforms.length < resultPlatforms.length;

  const sortHeader = (key: SortKey, label: string, numeric = true) => (
    <th scope="col" className={numeric ? "num" : undefined} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => sortBy(key)}>
        {label}
        <span className="sort-mark" aria-hidden="true">{sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>Scout</h1>
          <p>Find creators on YouTube, Instagram and TikTok, then narrow them down by reach, engagement and country.</p>
        </div>
        <div className="access">
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
        {formError && <p className="err form-err" role="alert">{formError}</p>}
      </form>

      {(jobs.length > 0 || notes.length > 0) && (
        <ul className="status" aria-live="polite">
          {jobs.map((j) => (
            <li key={j.runId} className={`status-${j.status}`}>
              <strong>{PLATFORM_LABEL[j.platform]}</strong>{" "}
              {j.status === "running" && "is still searching. This usually takes 1 to 3 minutes, and results appear here as soon as they're ready."}
              {j.status === "done" && "results are in."}
              {j.status === "failed" && (j.message || "search failed.")}
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
                Scout pulls each creator&rsquo;s recent posts and works out their average views, likes and engagement, so you can compare accounts by how they perform now, not just by follower count.
                {access !== "live" && " You're seeing sample data: the creators are invented, but the filters and math work exactly as they do on live results."}
              </p>
            </>
          )}
        </section>
      ) : (
        <div className="workspace">
          <aside className="rail" aria-label="Filters">
            <details open={railOpen} onToggle={(e) => setRailOpen((e.target as HTMLDetailsElement).open)} className="rail-inner">
              <summary>Filters{anyFilter ? " (on)" : ""}</summary>

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
                  values={creators.filter((c) => filters.platforms.includes(c.platform)).map((c) => metricValue(c, m, basis)).filter((v): v is number => v !== null)}
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
                  Include creators with no country listed ({countryCounts.unknown})
                </label>
                <p className="rh-hint">YouTube countries come from the channel profile and TikTok countries from where recent videos were posted. Instagram only shows a country for business accounts.</p>
              </fieldset>

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
                  Shortlist only ({creators.filter((c) => shortlist.has(c.id)).length})
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
                    {sortHeader("avgLikes", "Avg likes")}
                    {sortHeader("er", "Engagement")}
                    {fee > 0 && sortHeader("cpm", "CPM")}
                    <th scope="col"><span className="sr-only">Profile</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => {
                    const er = basis === "followers" ? c.erFollowers : c.erViews;
                    const starred = shortlist.has(c.id);
                    return (
                      <tr key={c.id} className={starred ? "starred" : undefined}>
                        <td className="col-star">
                          <button type="button" className={`star${starred ? " on" : ""}`} aria-pressed={starred} aria-label={`${starred ? "Remove" : "Add"} ${c.name} ${starred ? "from" : "to"} shortlist`} onClick={() => toggleShortlist(c.id)}>
                            {starred ? "★" : "☆"}
                          </button>
                        </td>
                        <td className="who">
                          <div className="who-top">
                            <span className="name">{c.name}</span>
                            {c.verified && <span className="verified" title="Verified">✓</span>}
                          </div>
                          <div className="who-sub">
                            <span className={`plat plat-${c.platform}`}>{PLATFORM_LABEL[c.platform]}</span>
                            <span className="handle">@{c.handle}</span>
                          </div>
                          {c.bio && <p className="bio" title={c.bio}>{c.bio}</p>}
                        </td>
                        <td className="country">{c.country ? <><span aria-hidden="true">{flag(c.country)}</span> {countryName(c.country)}</> : <span className="muted">Not listed</span>}</td>
                        <td className="num">{compact(c.followers)}</td>
                        <td className="num">{compact(c.avgViews)}</td>
                        <td className="num">{compact(c.avgLikes)}</td>
                        <td className="num">{pct(er)}</td>
                        {fee > 0 && <td className="num">{money(cpm(fee, c.avgViews))}</td>}
                        <td className="open">
                          {c.sample ? <span className="muted">Sample</span> : <a href={c.url} target="_blank" rel="noopener noreferrer">Open profile<span className="sr-only"> for {c.name} (new tab)</span></a>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visible.length === 0 && creators.length > 0 && <p className="none">No creators match these filters. Widen a range or clear the country filter.</p>}
            </div>
            <p className="footnote">Averages use each creator&rsquo;s most recent posts (up to 10 on YouTube, 8 on Instagram and TikTok). CPM is your fee divided by average views, per thousand views.</p>
          </main>
        </div>
      )}
    </div>
  );
}
