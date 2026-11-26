import { buildCreator, toNum, type PostInput } from "./metrics.ts";
import type { Creator } from "./types.ts";

const API = "https://www.googleapis.com/youtube/v3";
const RECENT_VIDEOS = 10;
const LOOKBACK_DAYS = 365;

async function yt<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${API}/${path}?${qs}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded") throw new Error("YouTube's daily quota is used up. It resets at midnight Pacific time.");
    throw new Error(body?.error?.message || `YouTube returned ${res.status}`);
  }
  return body as T;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface ChannelItem {
  id: string;
  snippet: { title: string; description: string; customUrl?: string; country?: string; defaultLanguage?: string; thumbnails?: { default?: { url: string } } };
  statistics: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

interface VideoItem {
  id: string;
  snippet?: { title?: string; description?: string; publishedAt?: string; defaultAudioLanguage?: string; defaultLanguage?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  paidProductPlacementDetails?: { hasPaidProductPlacement?: boolean };
}

/** Rank channels by how many recent niche videos they made, keeping first-seen order for ties. */
export function rankChannels(videoChannelIds: string[], limit: number): string[] {
  const counts = new Map<string, { n: number; first: number }>();
  videoChannelIds.forEach((id, i) => {
    const c = counts.get(id);
    if (c) c.n++;
    else counts.set(id, { n: 1, first: i });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .slice(0, limit)
    .map(([id]) => id);
}

async function videoDetails(ids: string[], key: string): Promise<VideoItem[]> {
  try {
    return (await yt<{ items: VideoItem[] }>("videos", { part: "snippet,statistics,paidProductPlacementDetails", id: ids.join(","), maxResults: "50" }, key)).items ?? [];
  } catch (e) {
    // Older API surfaces may not know paidProductPlacementDetails; captions still catch most paid posts.
    if (e instanceof Error && /part|paidProductPlacement/i.test(e.message)) {
      return (await yt<{ items: VideoItem[] }>("videos", { part: "snippet,statistics", id: ids.join(","), maxResults: "50" }, key)).items ?? [];
    }
    throw e;
  }
}

/**
 * Find channels that recently published videos about the niche, then measure their last 10 uploads.
 * Searching videos rather than channels surfaces active creators instead of accounts that just have
 * the keyword in their name.
 * Quota: 1 search (100 units) + channels + 1 playlistItems per channel + 1 videos call per 50 videos.
 */
export async function searchYouTube(query: string, limit: number, region: string | null, key: string): Promise<Creator[]> {
  const after = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const search = await yt<{ items: Array<{ snippet: { channelId: string } }> }>(
    "search",
    {
      part: "snippet",
      type: "video",
      q: query,
      order: "relevance",
      publishedAfter: after,
      maxResults: "50",
      ...(region ? { regionCode: region } : {}),
    },
    key,
  );
  const ids = rankChannels(search.items.map((i) => i.snippet.channelId).filter(Boolean), Math.min(Math.max(limit, 1), 50));
  if (ids.length === 0) return [];

  const channels: ChannelItem[] = [];
  for (const group of chunk(ids, 50)) {
    const res = await yt<{ items: ChannelItem[] }>("channels", { part: "snippet,statistics,contentDetails", id: group.join(","), maxResults: "50" }, key);
    channels.push(...(res.items ?? []));
  }
  channels.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  const uploadsByChannel = new Map<string, string[]>();
  await Promise.all(
    channels.map(async (ch) => {
      const playlist = ch.contentDetails?.relatedPlaylists?.uploads;
      if (!playlist) return;
      try {
        const res = await yt<{ items: Array<{ contentDetails: { videoId: string } }> }>(
          "playlistItems",
          { part: "contentDetails", playlistId: playlist, maxResults: String(RECENT_VIDEOS) },
          key,
        );
        uploadsByChannel.set(ch.id, res.items.map((i) => i.contentDetails.videoId));
      } catch {
        uploadsByChannel.set(ch.id, []);
      }
    }),
  );

  const byId = new Map<string, VideoItem>();
  for (const group of chunk([...uploadsByChannel.values()].flat(), 50)) {
    for (const v of await videoDetails(group, key)) byId.set(v.id, v);
  }

  return channels.map((ch) => {
    const handle = ch.snippet.customUrl?.replace(/^@/, "") || ch.id;
    const videos = (uploadsByChannel.get(ch.id) ?? []).map((id) => byId.get(id)).filter((v): v is VideoItem => Boolean(v));
    const posts: PostInput[] = videos.map((v) => ({
      views: toNum(v.statistics?.viewCount),
      likes: toNum(v.statistics?.likeCount),
      comments: toNum(v.statistics?.commentCount),
      date: v.snippet?.publishedAt ?? null,
      caption: [v.snippet?.title, v.snippet?.description].filter(Boolean).join("\n").slice(0, 1500),
      markedSponsored: v.paidProductPlacementDetails?.hasPaidProductPlacement === true,
      url: `https://www.youtube.com/watch?v=${v.id}`,
    }));
    const langs = videos.map((v) => v.snippet?.defaultAudioLanguage || v.snippet?.defaultLanguage).filter(Boolean);
    return buildCreator({
      platform: "youtube",
      handle,
      name: ch.snippet.title,
      url: ch.snippet.customUrl ? `https://www.youtube.com/${ch.snippet.customUrl}` : `https://www.youtube.com/channel/${ch.id}`,
      avatar: ch.snippet.thumbnails?.default?.url ?? null,
      bio: ch.snippet.description,
      country: ch.snippet.country ?? null,
      countrySource: "profile",
      language: (langs[0] as string | undefined) ?? ch.snippet.defaultLanguage ?? null,
      followers: ch.statistics.hiddenSubscriberCount ? null : toNum(ch.statistics.subscriberCount),
      posts,
    });
  });
}
