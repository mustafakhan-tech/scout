import { test } from "node:test";
import assert from "node:assert/strict";
import { counterMessage, evaluate, valueFromFunnel, type DealInput } from "./deal.ts";

const base: DealInput = {
  platform: "tiktok", avgViews: 50_000, posts: 1, fee: 750, extras: 0,
  ctr: 0.01, cvr: 0.02, valuePerConversion: 60, spread: 0.5, targetCpm: null,
};
const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} vs ${b}`);

test("funnel: views → clicks → conversions → revenue", () => {
  const r = evaluate(base);
  close(r.views.mid, 50_000);
  close(r.clicks.mid, 500);
  close(r.conversions.mid, 10);
  close(r.revenue.mid, 600);
  close(r.roi.mid, -0.2);
});

test("unit costs", () => {
  const r = evaluate(base);
  close(r.cpm, 15);
  close(r.cpc, 1.5);
  close(r.cpa, 75);
  close(r.breakEvenConversions, 12.5);
  close(r.breakEvenCtr, 0.0125);
});

test("range uses the spread around the expected views", () => {
  const r = evaluate(base);
  close(r.views.low, 25_000);
  close(r.views.high, 75_000);
  close(r.revenue.high, 900);
  assert.equal(r.verdict, "breakeven");
});

test("verdicts", () => {
  assert.equal(evaluate({ ...base, fee: 200 }).verdict, "profitable");
  assert.equal(evaluate({ ...base, fee: 5000 }).verdict, "unprofitable");
  assert.equal(evaluate({ ...base, valuePerConversion: 0 }).verdict, "unknown");
});

test("fair fee from the TikTok band, and a counter when the ask is above it", () => {
  const r = evaluate({ ...base, fee: 1200 });
  close(r.fairFee.low, 250);
  close(r.fairFee.mid, 500);
  close(r.fairFee.high, 750);
  assert.equal(r.askVsFair, "above");
  assert.equal(r.counter, 500);
  assert.equal(evaluate(base).askVsFair, "within");
  assert.equal(evaluate({ ...base, fee: 100 }).askVsFair, "below");
  assert.equal(evaluate(base).counter, null);
});

test("target CPM overrides the benchmark", () => {
  const r = evaluate({ ...base, targetCpm: 20, fee: 2000 });
  close(r.fairFee.mid, 1000);
  assert.equal(r.counter, 1000);
});

test("extras add to cost; multiple posts multiply views", () => {
  const r = evaluate({ ...base, posts: 3, extras: 250 });
  close(r.cost, 1000);
  close(r.views.mid, 150_000);
});

test("B2B value per signup", () => {
  close(valueFromFunnel(0.05, 4000), 200);
});

test("bad inputs don't produce NaN", () => {
  const r = evaluate({ ...base, avgViews: 0, fee: 0, ctr: -1, posts: 0 });
  assert.equal(r.cpm, null);
  assert.equal(r.cpc, null);
  assert.ok(Number.isFinite(r.roi.mid));
});

test("counter message", () => {
  const r = evaluate({ ...base, fee: 1200 });
  const msg = counterMessage("Ben", "tiktok", r, 1);
  assert.ok(msg.startsWith("Hi Ben,"));
  assert.ok(msg.includes("$500"));
  assert.ok(msg.includes("50K views"));
  assert.equal(counterMessage("Ben", "tiktok", evaluate(base), 1), "");
});
