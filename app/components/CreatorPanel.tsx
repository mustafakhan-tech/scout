"use client";

import { useEffect, useRef, useState } from "react";
import { countryName, flag, languageName } from "@/lib/countries.ts";
import { ago, compact, pct, times, type ErBasis } from "@/lib/filters.ts";
import { outreachMessage, type Sender } from "@/lib/outreach.ts";
import { MATURE_DAYS, maturePosts, performanceMetric, REACH_PAR, RISING } from "@/lib/signals.ts";
import { PLATFORM_LABEL, type Creator } from "@/lib/types.ts";

const SENDER_STORE = "scout-sender";

export function explainBreakout(c: Creator): string[] {
  const out: string[] = [];
  const unit = performanceMetric(c.posts) ?? "views";
  if (c.momentum !== null) {
    if (c.momentum >= 1.15) out.push(`Their most recent posts are getting ${times(c.momentum)} the ${unit} of the posts before them.`);
    else if (c.momentum <= 0.85) out.push(`Their most recent posts are getting ${times(c.momentum)} the ${unit} of the posts before them, so things are cooling off.`);
    else out.push(`Their newest posts are performing about the same as the ones before.`);
  }
  if (c.reach !== null) {
    const par = REACH_PAR[c.platform];
    out.push(`Average views equal ${pct(c.reach)} of followers. For ${PLATFORM_LABEL[c.platform]}, around ${pct(par)} is typical.`);
  }
  if (c.daysSinceLastPost !== null && c.daysSinceLastPost > 45) out.push(`They last posted ${ago(c.daysSinceLastPost)}, which pulls the score down.`);
  if (c.followers !== null && c.followers > 1_000_000) out.push("They already have over a million followers, so they count as established, not up-and-coming.");
  if (c.lowReach) out.push("Their views are under 2% of their follower count. That often means bought followers, or an audience that has moved on.");
  if (c.momentum !== null) out.push(`Posts from the last ${MATURE_DAYS[c.platform]} days are left out of this comparison, because they're still collecting views.`);
  return out;
}

interface Props {
  creator: Creator;
  niche: string;
  basis: ErBasis;
  starred: boolean;
  onToggleStar: () => void;
  onClose: () => void;
}

export default function CreatorPanel({ creator: c, niche, basis, starred, onToggleStar, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [sender, setSender] = useState<Sender>({ name: "", company: "" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    try {
      const s = JSON.parse(localStorage.getItem(SENDER_STORE) || "null");
      if (s) setSender(s);
    } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => setCopied(false), [c.id, sender]);

  function updateSender(next: Sender) {
    setSender(next);
    try { localStorage.setItem(SENDER_STORE, JSON.stringify(next)); } catch { /* ignore */ }
  }

  const message = outreachMessage(c, niche, sender);
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // Chart: oldest to newest, so momentum reads left to right.
  const chartPosts = [...c.posts].reverse();
  const settled = maturePosts(c.posts, c.platform);
  const compared = new Set(c.momentum === null ? [] : settled.slice(0, 3));
  const fresh = new Set(c.posts.filter((p) => !settled.includes(p)));
  const useViews = performanceMetric(c.posts) !== "likes";
  const val = (p: (typeof chartPosts)[number]) => (useViews ? p.views : p.likes) ?? 0;
  const peak = Math.max(1, ...chartPosts.map(val));
  const er = basis === "followers" ? c.erFollowers : c.erViews;
  const rising = c.breakout !== null && c.breakout >= RISING;

  return (
    <div className="panel-scrim" onClick={onClose}>
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <div>
            <h2 id="panel-title">{c.name}</h2>
            <p className="who-sub">
              <span className={`plat plat-${c.platform}`}>{PLATFORM_LABEL[c.platform]}</span>
              <span className="handle">@{c.handle}</span>
              {c.country && <span>{flag(c.country)} {countryName(c.country)}</span>}
            </p>
          </div>
          <button ref={closeRef} type="button" className="panel-close" onClick={onClose} aria-label="Close creator details">✕</button>
        </header>

        {c.bio && <p className="panel-bio">{c.bio}</p>}

        <div className="panel-actions">
          <button type="button" className={`btn${starred ? " btn-on" : ""}`} onClick={onToggleStar} aria-pressed={starred}>
            {starred ? "★ On shortlist" : "☆ Add to shortlist"}
          </button>
          {c.avgViews !== null && (
            <a className="btn" href={`/deal?${new URLSearchParams({ platform: c.platform, views: String(Math.round(c.avgViews)), name: c.name.split(/\s+/)[0] ?? "" })}`}>
              Check a deal
            </a>
          )}
          {c.sample ? (
            <span className="muted">Sample creator: no real profile to open</span>
          ) : (
            <a className="btn" href={c.url} target="_blank" rel="noopener noreferrer">Open on {PLATFORM_LABEL[c.platform]}<span className="sr-only"> (new tab)</span></a>
          )}
        </div>

        <section className="panel-score" aria-label="Breakout score">
          <div className={`score${rising ? " score-rising" : ""}`}>
            <span className="score-n">{c.breakout ?? "–"}</span>
            <span className="score-label">{c.breakout === null ? "Not enough posts to score" : rising ? "Breakout score: rising" : "Breakout score"}</span>
          </div>
          <ul className="explain">
            {explainBreakout(c).map((s) => <li key={s}>{s}</li>)}
          </ul>
        </section>

        <dl className="facts">
          <div><dt>Followers</dt><dd>{compact(c.followers)}</dd></div>
          <div><dt>Avg views</dt><dd>{compact(c.avgViews)}</dd></div>
          <div><dt>Avg likes</dt><dd>{compact(c.avgLikes)}</dd></div>
          <div><dt>Engagement</dt><dd>{pct(er)}</dd></div>
          <div><dt>Brand deals</dt><dd>{c.postsSampled ? `${c.brandDeals} of ${c.postsSampled} posts` : "–"}</dd></div>
          <div><dt>Manager</dt><dd>{c.managed ? "Listed in bio" : "None listed"}</dd></div>
          <div><dt>Last post</dt><dd>{ago(c.daysSinceLastPost)}</dd></div>
          <div><dt>Posting</dt><dd>{c.postsPerWeek === null ? "–" : `${c.postsPerWeek.toFixed(1)} a week`}</dd></div>
          {c.language && <div><dt>Posts in</dt><dd>{languageName(c.language)}</dd></div>}
        </dl>

        {chartPosts.length > 0 && (
          <section className="panel-section">
            <h3>Recent posts</h3>
            <p className="rh-hint">
              {useViews ? "Views" : "Likes"} per post, oldest to newest. Blue bars are the posts the breakout score compares against the older ones
              {fresh.size > 0 && `, pale bars are under ${MATURE_DAYS[c.platform]} days old and still collecting ${useViews ? "views" : "likes"}`}. Outlined bars are sponsored.
            </p>
            <div className="post-chart" role="img" aria-label={`${useViews ? "Views" : "Likes"} on the last ${chartPosts.length} posts, oldest to newest: ${chartPosts.map((p) => compact(val(p))).join(", ")}`}>
              {chartPosts.map((p, i) => (
                <span
                  key={i}
                  className={[p.sponsored && "ad", compared.has(p) && "recent", fresh.has(p) && "fresh"].filter(Boolean).join(" ") || undefined}
                  style={{ height: `${Math.max(3, (val(p) / peak) * 100)}%` }}
                />
              ))}
            </div>
            <ol className="post-list">
              {c.posts.map((p, i) => (
                <li key={i}>
                  <div className="post-meta">
                    <span>{ago(p.date ? Math.floor((Date.now() - Date.parse(p.date)) / 86_400_000) : null)}</span>
                    {p.views !== null && <span>{compact(p.views)} views</span>}
                    {p.likes !== null && <span>{compact(p.likes)} likes</span>}
                    {p.sponsored && <span className="tag tag-ad">Sponsored</span>}
                  </div>
                  <p className="post-cap">
                    {p.caption ? p.caption.split("\n")[0] : <span className="muted">No caption</span>}
                    {p.url && <> <a href={p.url} target="_blank" rel="noopener noreferrer">View<span className="sr-only"> post (new tab)</span></a></>}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="panel-section">
          <h3>First message</h3>
          <p className="rh-hint">Written from what Scout measured, so it only mentions things that are true. Edit it before you send.</p>
          <div className="sender">
            <label>Your name<input value={sender.name} onChange={(e) => updateSender({ ...sender, name: e.target.value })} /></label>
            <label>Company<input value={sender.company} onChange={(e) => updateSender({ ...sender, company: e.target.value })} /></label>
          </div>
          <textarea className="msg" readOnly value={message} rows={6} aria-label="Outreach message" />
          <button type="button" className="btn" onClick={copy}>{copied ? "Copied" : "Copy message"}</button>
        </section>
      </aside>
    </div>
  );
}
