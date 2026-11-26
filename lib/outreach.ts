import { compact } from "./filters.ts";
import { PLATFORM_LABEL, type Creator, type Post } from "./types.ts";

export interface Sender {
  name: string;
  company: string;
}

/** First line of a caption, without hashtags, mentions or links, cut to a short quote. */
export function excerpt(caption: string, max = 60): string {
  const line = caption
    .split("\n")[0]
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#@][\w.]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : max).trim() + "…";
}

/** The creator's best recent non-sponsored post, by views (or likes when views are missing). */
export function standoutPost(c: Creator): Post | null {
  const score = (p: Post) => p.views ?? p.likes ?? -1;
  const organic = c.posts.filter((p) => !p.sponsored && excerpt(p.caption).length >= 8);
  return [...organic].sort((a, b) => score(b) - score(a))[0] ?? null;
}

function firstName(c: Creator): string {
  const n = c.name.trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}'-]{2,}$/u.test(n) ? n : "there";
}

/** A short first DM. It sticks to facts Scout actually measured, so nothing in it is made up. */
export function outreachMessage(c: Creator, niche: string, sender: Sender): string {
  const post = standoutPost(c);
  const lines: string[] = [];
  lines.push(`Hi ${firstName(c)}, I came across your ${PLATFORM_LABEL[c.platform]} while looking for ${niche.trim().toLowerCase()} creators.`);
  if (post) {
    const quote = `Your post "${excerpt(post.caption)}" caught my eye`;
    lines.push(post.views !== null ? `${quote}, and so did the ${compact(post.views)} views it got.` : `${quote}.`);
  }
  const who = [sender.name.trim(), sender.company.trim() ? `from ${sender.company.trim()}` : ""].filter(Boolean).join(" ");
  lines.push(`${who ? `I'm ${who}, and ` : ""}I think your audience could be a great fit for a paid partnership.`);
  lines.push("Are you taking on brand deals right now? If so, what's the best email to send details to?");
  if (c.managed) lines.push("Happy to go through your manager if that's easier.");
  return lines.join(" ");
}
