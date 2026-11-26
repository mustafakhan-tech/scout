import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCreator, mean, mode, cpm, toNum } from "./metrics.ts";
import { normalizeTikTok, normalizeInstagram, buildInput, discoverTikTok, discoverInstagram } from "./apify.ts";
import { rankChannels } from "./youtube.ts";
import { applyFilters, domainOf, emptyFilters, fracToValue, valueToFrac, toCsv, sortCreators, passesSignals, DEFAULT_SIGNALS } from "./filters.ts";
import { sampleCreators } from "./sample.ts";
import { access } from "./auth.ts";
import { bioMentionsManager, breakoutScore, captionLooksSponsored, looksLikeBusiness, momentumOf } from "./signals.ts";
import { excerpt, outreachMessage } from "./outreach.ts";
import type { Post } from "./types.ts";

const NOW = Date.parse("2026-11-20T00:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const post = (views: number, d: number, extra: Partial<Post> = {}): Post => ({ views, likes: views / 10, comments: 1, date: day(d), sponsored: false, caption: "", url: null, ...extra });

test("mean and toNum skip hidden (-1) and null values", () => {
  assert.equal(mean([10, null, -1, 20]), 15);
  assert.equal(mean([null, -1]), null);
  assert.equal(toNum(-1), null);
});

test("mode picks the most common country", () => {
  assert.equal(mode(["gb", "US", "GB", null]), "GB");
});

test("buildCreator computes engagement rates and sorts posts newest first", () => {
  const c = buildCreator({
    platform: "tiktok", handle: "a", url: "u", followers: 10_000, now: NOW,
    posts: [{ views: 1000, likes: 90, comments: 10, date: day(9) }, { views: 3000, likes: 190, comments: 10, date: day(1) }],
  });
  assert.equal(c.avgViews, 2000);
  assert.equal(c.erFollowers, 150 / 10_000);
  assert.equal(c.erViews, 150 / 2000);
  assert.equal(c.posts[0].views, 3000);
  assert.equal(c.daysSinceLastPost, 1);
  assert.equal(c.reach, 0.2);
});

test("cpm = fee / views * 1000", () => {
  assert.equal(cpm(500, 25_000), 20);
  assert.equal(cpm(500, null), null);
});

/* ---------- signals ---------- */

test("sponsored captions are detected, ordinary ones are not", () => {
  for (const s of ["#ad loving this", "Paid partnership with X", "Use code SAVE20", "this video is sponsored by Notion", "#gifted"]) assert.ok(captionLooksSponsored(s), s);
  for (const s of ["my adventure in Ghana", "I added a new budget", "partnered with my brother", "address the issue"]) assert.ok(!captionLooksSponsored(s), s);
});

test("manager mentions are detected", () => {
  assert.ok(bioMentionsManager("Mgmt: jo@brightside.co"));
  assert.ok(bioMentionsManager("contact sam@northtalent.com"));
  assert.ok(bioMentionsManager("Managed by Big Agency"));
  assert.ok(!bioMentionsManager("Personal finance tips. DM for collabs"));
  assert.ok(!bioMentionsManager("I manage my money better now"));
  assert.ok(!bioMentionsManager("Business loan and Money management. Business credit and management."));
  assert.ok(!bioMentionsManager("Wealth management tips for founders"));
  assert.ok(bioMentionsManager("Management: hello@bright.co"));
  assert.ok(bioMentionsManager("Partnerships via my manager, link below."));
});

test("shop-like bios are detected, creators are not", () => {
  assert.ok(looksLikeBusiness("FREE SHIPPING ON ORDERS $35+ ORDER BELLOW"));
  assert.ok(looksLikeBusiness("anything", { seller: true }));
  assert.ok(!looksLikeBusiness("Helping entrepreneurs make smarter money moves"));
  assert.ok(!looksLikeBusiness("Bookkeeper. Book a call to clean up your books"));
});

test("momentum uses one measure: likes when most posts have no views", () => {
  const ig = [post(0, 1, { views: null, likes: 300 }), post(0, 2, { views: null, likes: 300 }), post(9000, 3, { likes: 300 }), post(0, 4, { views: null, likes: 100 }), post(0, 5, { views: null, likes: 100 })];
  assert.equal(momentumOf(ig), 3);
});

test("posts still collecting views are left out of momentum", async () => {
  const { maturePosts } = await import("./signals.ts");
  const fresh = [post(500, 0), post(800, 1), post(9000, 4), post(9000, 6), post(9000, 8), post(9000, 10), post(9000, 12)];
  assert.equal(maturePosts(fresh, "tiktok", NOW).length, 5);
  const c = buildCreator({ platform: "tiktok", handle: "f", url: "", followers: 20_000, now: NOW, posts: fresh.map((p) => ({ views: p.views, likes: p.likes, comments: 1, date: p.date })) });
  assert.equal(c.momentum, 1);
});

test("low views for size flags likely inflated followers", () => {
  const c = buildCreator({ platform: "tiktok", handle: "x", url: "", followers: 983_000, posts: [{ views: 170, likes: 2, comments: 0 }] });
  assert.equal(c.lowReach, true);
  const ok = buildCreator({ platform: "tiktok", handle: "y", url: "", followers: 983_000, posts: [{ views: 90_000, likes: 2, comments: 0 }] });
  assert.equal(ok.lowReach, false);
});

test("one viral post doesn't make an account rising", () => {
  const spike = [post(90_000, 1), post(1000, 3), post(1000, 5), post(1000, 7), post(1000, 9), post(1000, 11)];
  assert.equal(momentumOf(spike), 1);
});

test("momentum compares newest 3 posts with the older ones", () => {
  const rising = [post(3000, 1), post(3000, 3), post(3000, 5), post(1000, 7), post(1000, 9), post(1000, 11)];
  assert.equal(momentumOf(rising), 3);
  assert.equal(momentumOf(rising.slice(0, 3)), null);
});

test("breakout score: 50 at par, higher when rising, lower when inactive", () => {
  assert.equal(breakoutScore({ platform: "tiktok", momentum: 1, reach: 0.3, followers: 50_000, daysSinceLastPost: 2 }), 50);
  const up = breakoutScore({ platform: "tiktok", momentum: 3, reach: 1.2, followers: 50_000, daysSinceLastPost: 2 })!;
  const quiet = breakoutScore({ platform: "tiktok", momentum: 3, reach: 1.2, followers: 50_000, daysSinceLastPost: 90 })!;
  assert.ok(up > 75, String(up));
  assert.ok(quiet < up);
  assert.equal(breakoutScore({ platform: "youtube", momentum: null, reach: null, followers: 1, daysSinceLastPost: 1 }), null);
});

/* ---------- providers ---------- */

test("normalizeTikTok groups videos, reads ad flags, captions, language and country", () => {
  const meta = { name: "chef", nickName: "Chef", fans: 50_000, signature: "cooking. mgmt@chefmgmt.com", verified: false };
  const items = [
    { authorMeta: meta, playCount: 10_000, diggCount: 800, commentCount: 20, locationCreated: "CA", text: "pasta night", createTimeISO: day(2), textLanguage: "en", isAd: false },
    { authorMeta: meta, playCount: 30_000, diggCount: 1200, commentCount: 40, text: "#ad my favourite pan", createTimeISO: day(1), textLanguage: "en", isAd: false },
    { authorMeta: { name: "other", fans: 9 }, playCount: 5, diggCount: 1, commentCount: 0, locationCreated: "US" },
  ];
  const out = normalizeTikTok(items, {}, NOW);
  assert.equal(out.length, 2);
  const chef = out.find((c) => c.handle === "chef")!;
  assert.equal(chef.avgViews, 20_000);
  assert.equal(chef.country, "CA");
  assert.equal(chef.language, "en");
  assert.equal(chef.brandDeals, 1);
  assert.equal(chef.managed, true);
  assert.equal(chef.posts[0].caption, "#ad my favourite pan");
});

test("normalizeTikTok uses discovery country hints when profile videos lack location", () => {
  const out = normalizeTikTok([{ authorMeta: { name: "x", fans: 10 }, playCount: 1, diggCount: 1, commentCount: 0 }], { x: "GB" });
  assert.equal(out[0].country, "GB");
});

test("normalizeInstagram ignores hidden likes, private accounts and non-profile items; flags shops", () => {
  const out = normalizeInstagram([
    { username: "deco", fullName: "Deco", followersCount: 20_000, latestPosts: [{ likesCount: 400, commentsCount: 20, videoViewCount: 9000, timestamp: day(1) }, { likesCount: -1, commentsCount: 10, timestamp: day(4) }] },
    { username: "store", followersCount: 5_000, isBusinessAccount: true, businessCategoryName: "Clothing (Brand)", latestPosts: [] },
    { username: "hidden", followersCount: 5_000, private: true },
    { error: "not found" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].avgLikes, 400);
  assert.equal(out[0].avgViews, 9000);
  assert.equal(out[1].business, true);
});

test("discovery ranks authors by niche videos posted, then plays", () => {
  const v = (name: string, plays: number, loc?: string) => ({ authorMeta: { name }, playCount: plays, locationCreated: loc });
  const d = discoverTikTok([v("a", 10), v("b", 500, "US"), v("a", 10, "CA"), v("c", 9999), v("b", 1, "US")], 2);
  assert.deepEqual(d.handles, ["b", "a"]);
  assert.equal(d.countries.b, "US");
  assert.deepEqual(discoverInstagram([{ ownerUsername: "x", likesCount: 5 }, { ownerUsername: "y", likesCount: 50 }], 5).handles, ["y", "x"]);
});

test("hashtags from a niche", async () => {
  const { hashtagsFor } = await import("./apify.ts");
  assert.deepEqual(hashtagsFor("Home Espresso!"), ["homeespresso"]);
  assert.deepEqual(hashtagsFor("café recipes"), ["caférecipes"]);
  assert.deepEqual(hashtagsFor("  "), []);
});

test("youtube channels are ranked by how many niche videos they made", () => {
  assert.deepEqual(rankChannels(["a", "b", "b", "c", "a", "b"], 2), ["b", "a"]);
});

test("actor inputs: discovery searches posts, profiles scrape handles, Instagram falls back to account search", () => {
  assert.equal(buildInput("tiktok", "discover", { query: "x", limit: 10 }).searchSection, "/video");
  assert.deepEqual(buildInput("tiktok", "profiles", { limit: 10, handles: ["a"] }).profiles, ["a"]);
  assert.deepEqual(buildInput("instagram", "discover", { query: "small business finance", limit: 10 }).directUrls, [
    "https://www.instagram.com/explore/tags/smallbusinessfinance/",
    "https://www.instagram.com/explore/tags/businessfinance/",
    "https://www.instagram.com/explore/tags/smallbusiness/",
  ]);
  assert.deepEqual(buildInput("instagram", "profiles", { limit: 10, handles: ["a"] }).directUrls, ["https://www.instagram.com/a/"]);
  assert.equal(buildInput("instagram", "profiles", { query: "x", limit: 10, handles: [] }).searchType, "user");
});

/* ---------- filtering ---------- */

test("log scale round-trips", () => {
  const d: [number, number] = [1000, 1_000_000];
  assert.ok(Math.abs(fracToValue(0.5, d, "log") - 31_622.78) < 1);
  assert.ok(Math.abs(valueToFrac(31_622.78, d, "log") - 0.5) < 1e-6);
});

test("filters: follower range, country and unknown-country toggle", () => {
  const mk = (h: string, f: number, country: string | null) => buildCreator({ platform: "youtube", handle: h, url: "", followers: f, country, posts: [] });
  const all = [mk("a", 1_500, "CA"), mk("b", 100_000, "US"), mk("c", 50_000, null)];
  const domains = { followers: domainOf([1_500, 100_000, 50_000], "log"), avgViews: domainOf([], "log"), er: domainOf([], "linear") };
  const f = emptyFilters(["youtube"]);
  assert.equal(applyFilters(all, f, domains, "followers", new Set()).length, 3);
  f.ranges.followers.lo = valueToFrac(10_000, domains.followers, "log");
  assert.deepEqual(applyFilters(all, f, domains, "followers", new Set()).map((x) => x.handle), ["b", "c"]);
  f.countries = ["US"];
  f.includeUnknownCountry = false;
  assert.deepEqual(applyFilters(all, f, domains, "followers", new Set()).map((x) => x.handle), ["b"]);
});

test("signal filters", () => {
  const base = { platform: "tiktok" as const, url: "", now: NOW };
  const tiny = buildCreator({ ...base, handle: "t", followers: 300, posts: [] });
  const shop = buildCreator({ ...base, handle: "s", followers: 9000, bio: "Free shipping over $50", posts: [] });
  const deal = buildCreator({ ...base, handle: "d", followers: 9000, posts: [{ views: 1, likes: 1, comments: 0, caption: "#ad", date: day(1) }] });
  const clean = buildCreator({ ...base, handle: "c", followers: 9000, posts: [{ views: 1, likes: 1, comments: 0, caption: "hello", date: day(1) }] });
  assert.ok(!passesSignals(tiny, DEFAULT_SIGNALS));
  assert.ok(!passesSignals(shop, DEFAULT_SIGNALS));
  assert.ok(passesSignals(deal, DEFAULT_SIGNALS));
  assert.ok(!passesSignals(deal, { ...DEFAULT_SIGNALS, noDeals: true }));
  assert.ok(passesSignals(clean, { ...DEFAULT_SIGNALS, noDeals: true, hideInactive: true }));
});

test("sorting puts missing values last", () => {
  const mk = (h: string, f: number | null) => buildCreator({ platform: "youtube", handle: h, url: "", followers: f, posts: [] });
  const list = [mk("a", null), mk("b", 5), mk("c", 9)];
  assert.deepEqual(sortCreators(list, "followers", "desc", "followers", 0).map((x) => x.handle), ["c", "b", "a"]);
  assert.deepEqual(sortCreators(list, "followers", "asc", "followers", 0).map((x) => x.handle), ["b", "c", "a"]);
});

test("csv escapes quotes and blocks formula injection", () => {
  const c = buildCreator({ platform: "tiktok", handle: "q", name: '=HYPERLINK("x")', url: "", followers: 1, posts: [] });
  const line = toCsv([c], 0).split("\n")[1];
  assert.ok(line.includes(`"'=HYPERLINK(""x"")"`));
});

/* ---------- outreach ---------- */

test("outreach message uses the creator's best organic post and only measured facts", () => {
  const c = buildCreator({
    platform: "tiktok", handle: "maya", name: "Maya Lee", url: "", followers: 40_000, bio: "mgmt: a@b.co", now: NOW,
    posts: [
      { views: 90_000, likes: 1, comments: 0, caption: "#ad Big thanks to Brand", date: day(1) },
      { views: 52_000, likes: 1, comments: 0, caption: "How I pay myself as a freelancer\n#money", date: day(3) },
      { views: 4_000, likes: 1, comments: 0, caption: "quick one", date: day(5) },
    ],
  });
  const msg = outreachMessage(c, "Freelance Finance", { name: "Mustafa", company: "Nexus Partners" });
  assert.ok(msg.startsWith("Hi Maya,"));
  assert.ok(msg.includes('"How I pay myself as a freelancer"'));
  assert.ok(msg.includes("the 52K views it got"));
  assert.ok(msg.includes("Mustafa from Nexus Partners"));
  assert.ok(msg.includes("manager"));
  assert.ok(!msg.includes("Brand"));
});

test("excerpt strips hashtags and links and cuts at a word", () => {
  assert.equal(excerpt("Check this https://x.co #fyp @me"), "Check this");
  assert.ok(excerpt("word ".repeat(30)).endsWith("…"));
});

/* ---------- sample + access ---------- */

test("sample data is deterministic, marked as sample, and exercises every signal", () => {
  const one = sampleCreators("home espresso", ["tiktok", "youtube", "instagram"], 20, "CA");
  assert.deepEqual(one, sampleCreators("home espresso", ["tiktok", "youtube", "instagram"], 20, "CA"));
  assert.ok(one.every((c) => c.sample && c.url === "#sample"));
  assert.ok(one.some((c) => c.managed));
  assert.ok(one.some((c) => c.business));
  assert.ok(one.some((c) => c.brandDeals > 0));
  const rising = one.filter((c) => (c.breakout ?? 0) >= 70).length;
  assert.ok(rising > 0 && rising < one.length * 0.3, `rising ${rising} of ${one.length}`);
  assert.ok(one.some((c) => (c.daysSinceLastPost ?? 0) > 45));
});

test("country names cover every ISO code", async () => {
  const { countryName } = await import("./countries.ts");
  assert.equal(countryName("NO"), "Norway");
  const { languageName } = await import("./countries.ts");
  assert.equal(languageName("pt"), "Portuguese");
  assert.equal(countryName("CA"), "Canada");
  assert.equal(countryName(null), "Unknown");
});

test("access levels", () => {
  assert.equal(access(null, { SCOUT_PASSWORD: "pw" }), "sample");
  assert.equal(access("pw", { SCOUT_PASSWORD: "pw" }), "live");
  assert.equal(access("nope", { SCOUT_PASSWORD: "pw" }), "denied");
  assert.equal(access("pw", {}), "denied");
});

test("region: TikTok searches through that country, Instagram adds local hashtags", async () => {
  const { hashtagsFor } = await import("./apify.ts");
  assert.equal(buildInput("tiktok", "discover", { query: "fashion", limit: 10, region: "ZA" }).proxyCountryCode, "ZA");
  assert.equal(buildInput("tiktok", "profiles", { limit: 10, handles: ["a"], region: "ZA" }).proxyCountryCode, "ZA");
  assert.equal(buildInput("tiktok", "discover", { query: "fashion", limit: 10 }).proxyCountryCode, undefined);
  assert.deepEqual(hashtagsFor("fashion", "ZA"), ["fashionsouthafrica", "southafricafashion", "fashionsa", "safashion"]);
});

test("spend cap grows with the search but never passes the ceiling", async () => {
  const { runCap } = await import("./apify.ts");
  assert.ok(runCap("tiktok", "profiles", 10, 2) < runCap("tiktok", "profiles", 50, 2));
  assert.ok(runCap("tiktok", "profiles", 50, 2) <= 2);
  assert.equal(runCap("tiktok", "profiles", 500, 2), 2);
  assert.ok(runCap("instagram", "discover", 1, 2) >= 0.1);
});

test("TikTok creators get a country from their bio when the platform gives none", () => {
  const out = normalizeTikTok([{ authorMeta: { name: "lebo", nickName: "Lerato", fans: 20_000, signature: "Joburg 🇿🇦 | she/her" }, playCount: 9000, diggCount: 500, commentCount: 9 }]);
  assert.equal(out[0].country, "ZA");
  assert.equal(out[0].countrySource, "bio");
  assert.equal(out[0].gender, "woman");
  assert.equal(out[0].genderSource, "pronouns");
});
