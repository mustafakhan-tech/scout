import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCreator, mean, mode, cpm } from "./metrics.ts";
import { normalizeTikTok, normalizeInstagram, buildInput } from "./apify.ts";
import { applyFilters, domainOf, emptyFilters, fracToValue, valueToFrac, toCsv, sortCreators } from "./filters.ts";
import { sampleCreators } from "./sample.ts";
import { access } from "./auth.ts";

test("mean skips hidden (-1) and null values", () => {
  assert.equal(mean([10, null, -1, 20]), 15);
  assert.equal(mean([null, -1]), null);
});

test("mode picks the most common country", () => {
  assert.equal(mode(["gb", "US", "GB", null]), "GB");
});

test("buildCreator computes both engagement rates", () => {
  const c = buildCreator({
    platform: "tiktok", handle: "a", url: "u", followers: 10_000,
    posts: [{ views: 1000, likes: 90, comments: 10 }, { views: 3000, likes: 190, comments: 10 }],
  });
  assert.equal(c.avgViews, 2000);
  assert.equal(c.avgLikes, 140);
  assert.equal(c.avgComments, 10);
  assert.equal(c.erFollowers, 150 / 10_000);
  assert.equal(c.erViews, 150 / 2000);
});

test("cpm = fee / views * 1000", () => {
  assert.equal(cpm(500, 25_000), 20);
  assert.equal(cpm(500, null), null);
});

test("normalizeTikTok groups videos by author and takes country from posts", () => {
  const meta = { name: "chef", nickName: "Chef", fans: 50_000, signature: "cooking", verified: false };
  const items = [
    { authorMeta: meta, playCount: 10_000, diggCount: 800, commentCount: 20, locationCreated: "CA" },
    { authorMeta: meta, playCount: 30_000, diggCount: 1200, commentCount: 40, locationCreated: "CA" },
    { authorMeta: { name: "other", fans: 9 }, playCount: 5, diggCount: 1, commentCount: 0, locationCreated: "US" },
  ];
  const out = normalizeTikTok(items);
  assert.equal(out.length, 2);
  const chef = out.find((c) => c.handle === "chef")!;
  assert.equal(chef.followers, 50_000);
  assert.equal(chef.avgViews, 20_000);
  assert.equal(chef.country, "CA");
  assert.equal(chef.postsSampled, 2);
  assert.equal(chef.url, "https://www.tiktok.com/@chef");
});

test("normalizeInstagram ignores hidden likes and non-profile items", () => {
  const out = normalizeInstagram([
    { username: "deco", fullName: "Deco", followersCount: 20_000, latestPosts: [{ likesCount: 400, commentsCount: 20 }, { likesCount: -1, commentsCount: 10 }] },
    { error: "not found" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].avgLikes, 400);
  assert.equal(out[0].avgComments, 15);
  assert.equal(out[0].avgViews, null);
  assert.equal(out[0].country, null);
});

test("actor inputs search profiles", () => {
  assert.equal(buildInput("tiktok", "x", 10).searchSection, "/user");
  assert.equal(buildInput("instagram", "x", 10).resultsType, "details");
});

test("log scale round-trips", () => {
  const d: [number, number] = [1000, 1_000_000];
  assert.ok(Math.abs(fracToValue(0.5, d, "log") - 31_622.78) < 1);
  assert.ok(Math.abs(valueToFrac(31_622.78, d, "log") - 0.5) < 1e-6);
});

test("filters: follower range, country and unknown-country toggle", () => {
  const a = buildCreator({ platform: "youtube", handle: "a", url: "", followers: 1_000, country: "CA", posts: [] });
  const b = buildCreator({ platform: "youtube", handle: "b", url: "", followers: 100_000, country: "US", posts: [] });
  const c = buildCreator({ platform: "youtube", handle: "c", url: "", followers: 50_000, country: null, posts: [] });
  const all = [a, b, c];
  const domains = {
    followers: domainOf([1_000, 100_000, 50_000], "log"), avgViews: domainOf([], "log"),
    avgLikes: domainOf([], "log"), er: domainOf([], "linear"),
  };
  const f = emptyFilters(["youtube"]);
  assert.equal(applyFilters(all, f, domains, "followers", new Set()).length, 3);
  f.ranges.followers.lo = valueToFrac(10_000, domains.followers, "log");
  assert.deepEqual(applyFilters(all, f, domains, "followers", new Set()).map((x) => x.handle), ["b", "c"]);
  f.countries = ["US"];
  assert.deepEqual(applyFilters(all, f, domains, "followers", new Set()).map((x) => x.handle), ["b", "c"]);
  f.includeUnknownCountry = false;
  assert.deepEqual(applyFilters(all, f, domains, "followers", new Set()).map((x) => x.handle), ["b"]);
});

test("sorting puts missing values last", () => {
  const a = buildCreator({ platform: "youtube", handle: "a", url: "", followers: null, posts: [] });
  const b = buildCreator({ platform: "youtube", handle: "b", url: "", followers: 5, posts: [] });
  const c = buildCreator({ platform: "youtube", handle: "c", url: "", followers: 9, posts: [] });
  assert.deepEqual(sortCreators([a, b, c], "followers", "desc", "followers", 0).map((x) => x.handle), ["c", "b", "a"]);
  assert.deepEqual(sortCreators([a, b, c], "followers", "asc", "followers", 0).map((x) => x.handle), ["b", "c", "a"]);
});

test("csv escapes quotes and blocks formula injection", () => {
  const c = buildCreator({ platform: "tiktok", handle: "q", name: '=HYPERLINK("x")', url: "", followers: 1, posts: [] });
  const line = toCsv([c], 0).split("\n")[1];
  assert.ok(line.includes(`"'=HYPERLINK(""x"")"`));
});

test("sample data is deterministic and marked as sample", () => {
  const one = sampleCreators("home espresso", ["tiktok", "youtube"], 5, "CA");
  const two = sampleCreators("home espresso", ["tiktok", "youtube"], 5, "CA");
  assert.equal(one.length, 10);
  assert.deepEqual(one, two);
  assert.ok(one.every((c) => c.sample && c.url === "#sample"));
});

test("access levels", () => {
  assert.equal(access(null, { SCOUT_PASSWORD: "pw" }), "sample");
  assert.equal(access("pw", { SCOUT_PASSWORD: "pw" }), "live");
  assert.equal(access("nope", { SCOUT_PASSWORD: "pw" }), "denied");
  assert.equal(access("pw", {}), "denied");
});
