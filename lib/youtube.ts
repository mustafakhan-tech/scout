import { buildCreator, toNum, type PostStats } from "./metrics.ts";
import type { Creator } from "./types.ts";

const API = "https://www.googleapis.com/youtube/v3";
const RECENT_VIDEOS = 10;

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
  snippet: { title: string; description: string; customUrl?: string; country?: string; thumbnails?: { default?: { url: string } } };
  statistics: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

/**
 * Search channels by keyword, then average each channel's last 10 uploads.
 * Quota: 1 search call + 1 channels call + 1 playlistItems call per channel + 1 videos call per 50 videos.
 */
export async function searchYouTube(query: string, limit: number, region: string | null, key: string): Promise<Creator[]> {
  const search = await yt<{ items: Array<{ id: { channelId: string } }> }>(
    "search",
    {
      part: "snippet",
      type: "channel",
      q: query,
      maxResults: String(Math.min(Math.max(limit, 1), 50)),
      ...(region ? { regionCode: region } : {}),
    },
    key,
  );
  const ids = [...new Set(search.items.map((i) => i.id.channelId).filter(Boolean))];
  if (ids.length === 0) return [];

  const channels: ChannelItem[] = [];
  for (const group of chunk(ids, 50)) {
    const res = await yt<{ items: ChannelItem[] }>(
      "channels",
      { part: "snippet,statistics,contentDetails", id: group.join(","), maxResults: "50" },
      key,
    );
    channels.push(...(res.items ?? []));
  }

  // Recent upload ids per channel
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

  const allVideoIds = [...uploadsByChannel.values()].flat();
  const statsById = new Map<string, PostStats>();
  for (const group of chunk(allVideoIds, 50)) {
    const res = await yt<{ items: Array<{ id: string; statistics: { viewCount?: string; likeCount?: string; commentCount?: string } }> }>(
      "videos",
      { part: "statistics", id: group.join(","), maxResults: "50" },
      key,
    );
    for (const v of res.items ?? []) {
      statsById.set(v.id, {
        views: toNum(v.statistics.viewCount),
        likes: toNum(v.statistics.likeCount),
        comments: toNum(v.statistics.commentCount),
      });
    }
  }

  return channels.map((ch) => {
    const handle = ch.snippet.customUrl?.replace(/^@/, "") || ch.id;
    const posts = (uploadsByChannel.get(ch.id) ?? []).map((id) => statsById.get(id)).filter((p): p is PostStats => Boolean(p));
    return buildCreator({
      platform: "youtube",
      handle,
      name: ch.snippet.title,
      url: ch.snippet.customUrl ? `https://www.youtube.com/${ch.snippet.customUrl}` : `https://www.youtube.com/channel/${ch.id}`,
      avatar: ch.snippet.thumbnails?.default?.url ?? null,
      bio: ch.snippet.description,
      country: ch.snippet.country ?? null,
      countrySource: "profile",
      followers: ch.statistics.hiddenSubscriberCount ? null : toNum(ch.statistics.subscriberCount),
      posts,
    });
  });
}
