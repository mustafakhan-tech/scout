import { timingSafeEqual } from "node:crypto";

export type Access = "sample" | "live" | "denied";

/**
 * No password sent -> sample mode.
 * Correct password -> live mode.
 * Wrong password, or a password sent when none is configured -> denied.
 */
export function access(sent: string | null, env: Record<string, string | undefined> = process.env): Access {
  if (!sent) return "sample";
  const expected = env.SCOUT_PASSWORD;
  if (!expected) return "denied";
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? "live" : "denied";
}

export const KEY_HEADER = "x-scout-key";
