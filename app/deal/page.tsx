"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import RangeBar from "../components/RangeBar.tsx";
import { BENCHMARKS, counterMessage, evaluate, valueFromFunnel, type DealInput } from "@/lib/deal.ts";
import { PLATFORM_LABEL, PLATFORMS, type Platform } from "@/lib/types.ts";

type Goal = "sale" | "signup";

const usd = (n: number | null) => {
  if (n === null || !Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  const s = abs >= 1000 ? Math.round(abs).toLocaleString("en-US") : abs >= 100 ? abs.toFixed(0) : abs.toFixed(2).replace(/\.00$/, "");
  return (n < 0 ? "−$" : "$") + s;
};
const atLeast = (n: number) => Math.ceil(n - 1e-9).toLocaleString("en-US");
const whole = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-US") : n >= 10 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, ""));
const kViews = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : Math.round(n).toString());
const pct = (n: number, d = 0) => (n * 100).toFixed(d) + "%";
const signedPct = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(Math.round(n * 100)) + "%";

function num(v: string | null, fallback: number): number {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
}

function NumberField({ id, label, value, onChange, prefix, suffix, step = 1, hint }: {
  id: string; label: string; value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; step?: number; hint?: string;
}) {
  return (
    <div className="dfield">
      <label htmlFor={id}>{label}</label>
      <span className="affix">
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <input id={id} type="number" inputMode="decimal" min={0} step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
        {suffix && <span aria-hidden="true">{suffix}</span>}
      </span>
      {hint && <p className="rh-hint">{hint}</p>}
    </div>
  );
}

function DealCheck() {
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [avgViews, setAvgViews] = useState(50_000);
  const [posts, setPosts] = useState(1);
  const [fee, setFee] = useState(750);
  const [extras, setExtras] = useState(0);
  const [goal, setGoal] = useState<Goal>("sale");
  const [ctrPct, setCtrPct] = useState(1);
  const [cvrPct, setCvrPct] = useState(2);
  const [orderValue, setOrderValue] = useState(60);
  const [closePct, setClosePct] = useState(5);
  const [customerValue, setCustomerValue] = useState(4000);
  const [spreadPct, setSpreadPct] = useState(50);
  const [targetCpm, setTargetCpm] = useState(0);
  const [copied, setCopied] = useState(false);

  // Prefill from Scout: /deal?platform=tiktok&views=136000&name=Ben
  useEffect(() => {
    const p = params.get("platform");
    if (p && (PLATFORMS as string[]).includes(p)) setPlatform(p as Platform);
    setAvgViews((v) => num(params.get("views"), v));
    setFee((v) => num(params.get("fee"), v));
    setPosts((v) => Math.max(1, num(params.get("posts"), v)));
    const n = params.get("name");
    if (n) setName(n.slice(0, 60));
  }, [params]);

  const valuePerConversion = goal === "sale" ? orderValue : valueFromFunnel(closePct / 100, customerValue);
  const input: DealInput = {
    platform, avgViews, posts, fee, extras,
    ctr: ctrPct / 100, cvr: cvrPct / 100, valuePerConversion,
    spread: spreadPct / 100, targetCpm: targetCpm > 0 ? targetCpm : null,
  };
  const r = useMemo(() => evaluate(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const unit = goal === "sale" ? "sales" : "signups";
  const who = name.trim() || "this creator";
  const msg = counterMessage(name, platform, r, posts);
  useEffect(() => setCopied(false), [msg]);

  let headline = "";
  let sub = "";
  if (r.verdict === "unknown") {
    headline = "Add what a conversion is worth.";
    sub = `Then Deal Check can tell you whether ${who} pays off.`;
  } else if (r.verdict === "profitable") {
    headline = "Worth it.";
    sub = "Even a below-average post should earn back what you spend.";
  } else if (r.verdict === "unprofitable") {
    headline = "Not at this price.";
    sub = "Even a strong post won't earn back what you spend.";
  } else if (r.revenue.mid >= r.cost) {
    headline = "Probably worth it.";
    sub = "An average post pays off, but a weak one would lose money.";
  } else {
    headline = "Risky.";
    sub = `It only pays off if the post beats ${name.trim() ? `${name.trim()}'s` : "their"} average.`;
  }

  async function copy() {
    try { await navigator.clipboard.writeText(msg); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div className="shell deal">
      <nav className="crumbs"><a href="/">Scout</a> <span aria-hidden="true">/</span> Deal Check</nav>
      <header className="deal-head">
        <h1>Deal Check</h1>
        <p>Is a creator deal worth it, and what&rsquo;s a fair price? Put in the creator&rsquo;s numbers and their ask, and see the range of results you can expect, where you break even, and a counter-offer if they&rsquo;re charging too much.</p>
      </header>

      <div className="deal-grid">
        <form className="deal-form" onSubmit={(e) => e.preventDefault()} aria-label="Deal details">
          <fieldset>
            <legend>The creator</legend>
            <div className="dfield">
              <label htmlFor="name">Name <span className="muted">(optional)</span></label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ben" maxLength={60} />
            </div>
            <div className="dfield">
              <span className="dlabel" id="plat-label">Platform</span>
              <div className="seg" role="radiogroup" aria-labelledby="plat-label">
                {PLATFORMS.map((p) => (
                  <label key={p} className={platform === p ? "on" : undefined}>
                    <input type="radio" name="platform" checked={platform === p} onChange={() => setPlatform(p)} />
                    {PLATFORM_LABEL[p]}
                  </label>
                ))}
              </div>
            </div>
            <NumberField id="views" label="Average views per post" value={avgViews} onChange={setAvgViews} step={1000} hint="Use their recent average, not their follower count. Scout shows it for every creator." />
          </fieldset>

          <fieldset>
            <legend>The deal</legend>
            <div className="dpair">
              <NumberField id="posts" label="Sponsored posts" value={posts} onChange={(n) => setPosts(Math.max(1, Math.round(n)))} />
              <NumberField id="fee" label="Their fee, total" value={fee} onChange={setFee} prefix="$" step={50} />
            </div>
            <NumberField id="extras" label="Other costs" value={extras} onChange={setExtras} prefix="$" step={50} hint="Product you send, usage rights, agency fees." />
          </fieldset>

          <fieldset>
            <legend>What you&rsquo;re paying for</legend>
            <div className="seg" role="radiogroup" aria-label="Conversion type">
              <label className={goal === "sale" ? "on" : undefined}><input type="radio" name="goal" checked={goal === "sale"} onChange={() => setGoal("sale")} />Sales</label>
              <label className={goal === "signup" ? "on" : undefined}><input type="radio" name="goal" checked={goal === "signup"} onChange={() => setGoal("signup")} />Signups (B2B)</label>
            </div>
            <div className="dpair">
              <NumberField id="ctr" label="Viewers who click" value={ctrPct} onChange={setCtrPct} suffix="%" step={0.1} />
              <NumberField id="cvr" label={goal === "sale" ? "Clicks that buy" : "Clicks that sign up"} value={cvrPct} onChange={setCvrPct} suffix="%" step={0.1} />
            </div>
            {goal === "sale" ? (
              <NumberField id="aov" label="Profit per sale" value={orderValue} onChange={setOrderValue} prefix="$" hint="Use profit, not price, if you want a true return." />
            ) : (
              <>
                <div className="dpair">
                  <NumberField id="close" label="Signups that become customers" value={closePct} onChange={setClosePct} suffix="%" step={0.5} />
                  <NumberField id="ltv" label="Value of a customer" value={customerValue} onChange={setCustomerValue} prefix="$" step={100} />
                </div>
                <p className="rh-hint">So each signup is worth {usd(valuePerConversion)}.</p>
              </>
            )}
            <p className="rh-hint">Click and conversion rates vary hugely by product and by where the link sits. Start with these defaults, then replace them with numbers from your own past campaigns.</p>
          </fieldset>

          <details className="deal-more">
            <summary>More settings</summary>
            <NumberField id="spread" label="How much views swing post to post" value={spreadPct} onChange={(n) => setSpreadPct(Math.min(90, n))} prefix="±" suffix="%" step={5} hint="Sets the width of every range on this page. ±50% suits most creators." />
            <NumberField id="target" label="Your target CPM" value={targetCpm} onChange={setTargetCpm} prefix="$" step={1} hint={`Leave at 0 to use the ${PLATFORM_LABEL[platform]} benchmark of $${BENCHMARKS[platform].low}–$${BENCHMARKS[platform].high}.`} />
          </details>
        </form>

        <section className="deal-out" aria-live="polite" aria-label="Result">
          <p className={`verdict verdict-${r.verdict === "breakeven" ? (r.revenue.mid >= r.cost ? "lean-good" : "lean-bad") : r.verdict}`}>{headline}</p>
          <p className="verdict-sub">{sub}</p>

          {r.breakEvenConversions !== null && (
            <div className="deal-block">
              <h2>{unit[0].toUpperCase() + unit.slice(1)} you can expect</h2>
              <p className="deal-line">
                You need <strong>{atLeast(r.breakEvenConversions)} {unit}</strong> to break even. Expect about <strong>{whole(r.conversions.mid)}</strong>, somewhere between {whole(r.conversions.low)} and {whole(r.conversions.high)}.
              </p>
              <RangeBar label={`${unit} expected`} low={r.conversions.low} mid={r.conversions.mid} high={r.conversions.high} marker={r.breakEvenConversions} markerLabel="Break-even" format={whole} tone="good-above" />
              {r.conversions.high > r.breakEvenConversions && <p className="rh-hint">Blue is the part of the range that makes money.</p>}
            </div>
          )}

          <dl className="deal-stats">
            <div><dt>Total cost</dt><dd>{usd(r.cost)}</dd></div>
            <div><dt>Return</dt><dd className={r.roi.mid >= 0 ? "pos" : "neg"}>{signedPct(r.roi.mid)}</dd><dd className="range">{signedPct(r.roi.low)} to {signedPct(r.roi.high)}</dd></div>
            <div><dt>Cost per 1,000 views</dt><dd>{usd(r.cpm)}</dd></div>
            <div><dt>Cost per click</dt><dd>{usd(r.cpc)}</dd></div>
            <div><dt>Cost per {goal === "sale" ? "sale" : "signup"}</dt><dd>{usd(r.cpa)}</dd></div>
            <div><dt>Click rate to break even</dt><dd>{r.breakEvenCtr === null ? "–" : pct(r.breakEvenCtr, r.breakEvenCtr < 0.1 ? 1 : 0)}</dd></div>
          </dl>

          <div className="deal-block">
            <h2>Is the price fair?</h2>
            <p className="deal-line">
              For about {kViews(r.views.mid)} views on {PLATFORM_LABEL[platform]}, a fair fee is <strong>{usd(r.fairFee.low)}–{usd(r.fairFee.high)}</strong>
              {targetCpm > 0 ? <> at your target CPM of {usd(targetCpm)}.</> : <> at the usual ${BENCHMARKS[platform].low}–${BENCHMARKS[platform].high} per 1,000 views.</>}{" "}
              {r.askVsFair === "above" && <>Their ask of {usd(fee)} is above that. Counter at <strong>{usd(r.counter)}</strong>.</>}
              {r.askVsFair === "within" && <>Their ask of {usd(fee)} is in range.</>}
              {r.askVsFair === "below" && <>Their ask of {usd(fee)} is below it, so it&rsquo;s a good price.</>}
            </p>
            <RangeBar label="Fair fee" low={r.fairFee.low} mid={r.fairFee.mid} high={r.fairFee.high} marker={fee} markerLabel="Their ask" format={usd} tone="neutral" midLabel="fair" markerState={r.askVsFair === "above" ? "over" : "ok"} />
            {msg && (
              <div className="counter">
                <textarea className="msg" readOnly value={msg} rows={4} aria-label="Counter-offer message" />
                <button type="button" className="btn" onClick={copy}>{copied ? "Copied" : "Copy counter-offer"}</button>
              </div>
            )}
          </div>

          <details className="deal-more">
            <summary>How this is worked out</summary>
            <ol className="math">
              <li>{kViews(avgViews)} average views × {posts} post{posts > 1 ? "s" : ""} = <strong>{kViews(r.views.mid)} views</strong> (range ±{spreadPct}%).</li>
              <li>{kViews(r.views.mid)} views × {ctrPct}% click = <strong>{whole(r.clicks.mid)} clicks</strong>.</li>
              <li>{whole(r.clicks.mid)} clicks × {cvrPct}% convert = <strong>{whole(r.conversions.mid)} {unit}</strong>.</li>
              <li>{whole(r.conversions.mid)} {unit} × {usd(valuePerConversion)} each = <strong>{usd(r.revenue.mid)}</strong>, against {usd(r.cost)} spent.</li>
              <li>Break-even: {usd(r.cost)} ÷ {usd(valuePerConversion)} = <strong>{r.breakEvenConversions === null ? "–" : `${whole(r.breakEvenConversions)}, so ${atLeast(r.breakEvenConversions)} ${unit}`}</strong>.</li>
              <li>Fair fee: {kViews(r.views.mid)} views ÷ 1,000 × the CPM range = <strong>{usd(r.fairFee.low)}–{usd(r.fairFee.high)}</strong>.</li>
            </ol>
          </details>
        </section>
      </div>

      <footer className="deal-sources">
        <h2>Where the price ranges come from</h2>
        <p>
          Published CPM benchmarks for creator posts disagree a lot, because format, niche and audience change the price. Deal Check uses a middle band from these sources: TikTok $5–$15, Instagram $8–$30, YouTube $15–$50 per 1,000 views. If you have your own numbers, set a target CPM under More settings.
        </p>
        <ul>
          <li><a href="https://mysocial.io/blog/how-to-price-influencers-on-youtube-instagram-and-snapchat/" target="_blank" rel="noopener noreferrer">Mysocial: How to price influencers on YouTube, Instagram and TikTok (2026)</a></li>
          <li><a href="https://www.modash.io/blog/influencer-marketing-cpm" target="_blank" rel="noopener noreferrer">Modash: Influencer CPM benchmarks by channel and deliverable</a></li>
          <li><a href="https://www.hubfluence.io/resources/tiktok-cpm-rates" target="_blank" rel="noopener noreferrer">Hubfluence: TikTok CPM rates, 2026 benchmark</a></li>
          <li><a href="https://iqfluence.io/public/blog/cpm-influencer-marketing" target="_blank" rel="noopener noreferrer">IQFluence: CPM in influencer marketing, 2026 benchmarks</a></li>
        </ul>
        <p className="muted">Results are estimates from the numbers you enter, not a guarantee. Views, clicks and sales swing a lot from post to post.</p>
      </footer>
    </div>
  );
}

export default function DealPage() {
  return (
    <Suspense fallback={null}>
      <DealCheck />
    </Suspense>
  );
}
