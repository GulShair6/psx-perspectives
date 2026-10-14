import { z } from "zod";
import { db, now, queue } from "./db";
import { today } from "./time";
import { windowBounds } from "./knowledge";
const channelId = z.string().regex(/^UC[\w-]{22}$/);
export type Channel = {
  id: string;
  name: string;
  handle: string;
  thumbnail: string;
  url: string;
  uploads: string;
};
async function youtube(resource: string, params: Record<string, string>) {
  const key = process.env.YOUTUBE_DATA_API_KEY;
  if (!key)
    throw new Error(
      "Add YOUTUBE_DATA_API_KEY to .env to search channels and collect full history",
    );
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url, {
    headers: { "X-Goog-Api-Key": key },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 429
        ? "YouTube access or quota unavailable; saved checkpoints are preserved. Resume after checking your API quota."
        : `YouTube request failed (${response.status})`,
    );
  const text = await response.text();
  if (Buffer.byteLength(text) > 2_000_000)
    throw new Error("YouTube response exceeds size limit");
  return JSON.parse(text) as {
    items?: Record<string, any>[];
    nextPageToken?: string;
  }; // API fields validated before storage.
}
export async function resolveChannel(idOrHandle: string): Promise<Channel> {
  const params: Record<string, string> = { part: "snippet,contentDetails" };
  if (idOrHandle.startsWith("UC")) params.id = channelId.parse(idOrHandle);
  else
    params.forHandle = z
      .string()
      .regex(/^@?[\p{L}\p{N}._-]{1,100}$/u)
      .parse(idOrHandle);
  const data = await youtube("channels", params),
    item = data.items?.[0];
  if (!item) throw new Error("Channel not found");
  const id = channelId.parse(item.id);
  return {
    id,
    name: z.string().min(1).max(200).parse(item.snippet?.title),
    handle: z
      .string()
      .max(150)
      .parse(item.snippet?.customUrl || ""),
    thumbnail: /^https:\/\/yt3\.(?:ggpht\.com|googleusercontent\.com)\//.test(
      item.snippet?.thumbnails?.default?.url || "",
    )
      ? item.snippet.thumbnails.default.url
      : "",
    url: `https://www.youtube.com/channel/${id}`,
    uploads: z
      .string()
      .regex(/^[\w-]{10,100}$/)
      .parse(item.contentDetails?.relatedPlaylists?.uploads),
  };
}
export async function searchChannels(input: string) {
  const query = z.string().trim().min(1).max(200).parse(input);
  if (/^\w+:\/\//.test(query)) {
    const u = new URL(query);
    if (
      u.protocol !== "https:" ||
      !["youtube.com", "www.youtube.com"].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.port
    )
      throw new Error("Use an HTTPS YouTube channel URL");
    const identity = decodeURIComponent(u.pathname).match(
      /^\/(?:channel\/(UC[\w-]{22})|(@[\p{L}\p{N}._-]+))\/?$/u,
    );
    if (!identity)
      throw new Error("Use /channel/UC… or /@handle, or search by name");
    return [await resolveChannel(identity[1] || identity[2])];
  }
  if (query.startsWith("@") || /^UC[\w-]{22}$/.test(query))
    return [await resolveChannel(query)];
  const results = await youtube("search", {
    part: "snippet",
    type: "channel",
    q: query,
    maxResults: "8",
  });
  return Promise.all(
    (results.items || []).map((item) =>
      resolveChannel(channelId.parse(item.id?.channelId)),
    ),
  );
}
export async function followChannel(id: string) {
  const c = await resolveChannel(channelId.parse(id));
  const source = db
    .transaction(() => {
      const old = db
        .prepare(
          "SELECT id FROM sources WHERE channel_id=? ORDER BY id LIMIT 1",
        )
        .get(c.id) as { id: number } | undefined;
      const source =
        old?.id ||
        Number(
          db
            .prepare(
              "INSERT INTO sources(name,url,channel_id,enabled,kind) VALUES(?,?,?,1,'expert')",
            )
            .run(c.name, c.url, c.id).lastInsertRowid,
        );
      db.prepare(
        "UPDATE sources SET name=?,handle=?,thumbnail=?,uploads_playlist=?,verified_at=?,enabled=1 WHERE id=?",
      ).run(c.name, c.handle, c.thumbnail, c.uploads, now(), source);
      return source;
    })
    .immediate();
  return { source_id: source, job: syncChannel(source) };
}
export function syncChannel(id: number, resume = false) {
  return db
    .transaction(() => {
      const source = db
        .prepare("SELECT id FROM sources WHERE id=? AND channel_id IS NOT NULL")
        .get(id);
      if (!source) throw new Error("Confirm a YouTube channel identity first");
      const active = db
        .prepare(
          "SELECT id FROM jobs WHERE type='channel_sync' AND status IN ('queued','running') AND json_extract(payload,'$.source_id')=?",
        )
        .get(id) as { id: number } | undefined;
      db.prepare("UPDATE sources SET enabled=1,next_check_at=? WHERE id=?").run(
        new Date(Date.now() + 6 * 3600000).toISOString(),
        id,
      );
      const checkpoint = db
        .prepare(
          "SELECT discovery_complete FROM channel_checkpoints WHERE source_id=?",
        )
        .get(id) as { discovery_complete: number } | undefined;
      if (!checkpoint || (!resume && checkpoint.discovery_complete)) {
        db.prepare(
          "INSERT INTO channel_checkpoints(source_id,since,until,updated_at) VALUES(?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET since=excluded.since,until=excluded.until,page_token=NULL,discovery_complete=0,paused=0,updated_at=excluded.updated_at",
        ).run(id, today(new Date(Date.now() - 90 * 86400000)), today(), now());
      } else
        db.prepare(
          "UPDATE channel_checkpoints SET paused=0 WHERE source_id=?",
        ).run(id);
      return active?.id || queue("channel_sync", { source_id: id });
    })
    .immediate();
}
export function pauseChannel(id: number) {
  db.transaction(() => {
    db.prepare("UPDATE channel_checkpoints SET paused=1 WHERE source_id=?").run(
      id,
    );
    if (!db.prepare("UPDATE sources SET enabled=0 WHERE id=?").run(id).changes)
      throw new Error("Channel not found");
  }).immediate();
}
export async function collectChannel(
  id: number,
  progress: (s: string) => void,
  collect: (id: string) => Promise<void>,
) {
  const source = db.prepare("SELECT * FROM sources WHERE id=?").get(id) as {
    channel_id: string;
    uploads_playlist: string | null;
    enabled: number;
    name: string;
  };
  if (!source?.channel_id) throw new Error("Channel identity missing");
  if (!source.uploads_playlist) {
    const c = await resolveChannel(source.channel_id);
    db.prepare(
      "UPDATE sources SET uploads_playlist=?,handle=?,thumbnail=?,verified_at=? WHERE id=?",
    ).run(c.uploads, c.handle, c.thumbnail, now(), id);
    source.uploads_playlist = c.uploads;
  }
  let complete = false;
  while (!complete) {
    const cp = db
      .prepare("SELECT * FROM channel_checkpoints WHERE source_id=?")
      .get(id) as {
      since: string;
      until: string;
      page_token: string | null;
      paused: number;
      discovery_complete: number;
    };
    if (cp.paused) return "Channel paused; discovery checkpoint preserved";
    if (cp.discovery_complete) break;
    const [start, end] = windowBounds(cp.since, cp.until);
    const params: Record<string, string> = {
      part: "contentDetails",
      playlistId: source.uploads_playlist,
      maxResults: "50",
    };
    if (cp.page_token) params.pageToken = cp.page_token;
    const page = await youtube("playlistItems", params);
    const ids = (page.items || []).map((item) =>
      z
        .string()
        .regex(/^[-\w]{11}$/)
        .parse(item.contentDetails?.videoId),
    );
    const details = ids.length
      ? await youtube("videos", {
          part: "snippet,status",
          id: ids.join(","),
          maxResults: "50",
        })
      : { items: [] };

    db.transaction(() => {
      for (const item of details.items || []) {
        const s = item.snippet;
        if (
          s?.channelId !== source.channel_id ||
          item.status?.privacyStatus !== "public"
        )
          continue;
        const date = z.iso.datetime({ offset: true }).parse(s.publishedAt);

        if (date < start || date > end) continue;
        db.prepare(
          "INSERT OR IGNORE INTO videos(id,source_id,title,speaker,published_at,url) VALUES(?,?,?,?,?,?)",
        ).run(
          z
            .string()
            .regex(/^[-\w]{11}$/)
            .parse(item.id),
          id,
          z.string().parse(s.title).slice(0, 200),
          source.name,
          date,
          `https://www.youtube.com/watch?v=${item.id}`,
        );
      }
      complete = !page.nextPageToken;
      db.prepare(
        "UPDATE channel_checkpoints SET page_token=?,discovery_complete=?,updated_at=? WHERE source_id=?",
      ).run(
        complete ? null : z.string().max(1000).parse(page.nextPageToken),
        +complete,
        now(),
        id,
      );
      db.prepare(
        "UPDATE sources SET last_checked_at=?,last_error=NULL WHERE id=?",
      ).run(now(), id);
    }).immediate();
    progress(
      `History ${complete ? "discovered" : "in progress"}; saved page checkpoint`,
    );
  }
  const cp = db
    .prepare("SELECT since,until FROM channel_checkpoints WHERE source_id=?")
    .get(id) as { since: string; until: string };
  const [start, end] = windowBounds(cp.since, cp.until);
  const pending = db
    .prepare(
      "SELECT id FROM videos WHERE source_id=? AND julianday(published_at)>=julianday(?) AND julianday(published_at)<=julianday(?) AND content_hash IS NULL AND (caption_attempted_at IS NULL OR caption_attempted_at<?) ORDER BY published_at DESC",
    )
    .all(id, start, end, new Date(Date.now() - 86400000).toISOString()) as {
    id: string;
  }[];
  let saved = 0;
  for (const v of pending) {
    if (
      (
        db
          .prepare("SELECT paused FROM channel_checkpoints WHERE source_id=?")
          .get(id) as { paused: number }
      ).paused
    )
      return `Paused; ${saved} captions collected`;
    progress(`Collecting captions ${saved + 1}/${pending.length}: ${v.id}`);
    await collect(v.id);
    saved++;
  }
  return `Discovery complete for ${cp.since}–${cp.until}; ${saved} caption attempts. Missing captions remain visible.`;
}
export function channelCoverage() {
  const sources = db
    .prepare(
      "SELECT s.*,cp.since,cp.until,cp.discovery_complete,cp.paused,cp.updated_at checkpoint_at FROM sources s LEFT JOIN channel_checkpoints cp ON cp.source_id=s.id WHERE s.channel_id IS NOT NULL ORDER BY s.name",
    )
    .all() as { id: number; since: string | null; until: string | null }[];
  return sources.map((s) => {
    const [start, end] = windowBounds(
      s.since || today(new Date(Date.now() - 90 * 86400000)),
      s.until || today(),
    );
    const counts = db
      .prepare(
        `SELECT COUNT(*) discovered,COALESCE(SUM(v.content_hash IS NOT NULL),0) saved,
    COALESCE(SUM(EXISTS(SELECT 1 FROM chunks c WHERE c.video_id=v.id)),0) AS "indexed",
    COALESCE(SUM(EXISTS(SELECT 1 FROM analysis_runs a WHERE a.video_id=v.id AND a.transcript_hash=v.content_hash AND a.status='done')),0) analyzed,
    COALESCE(SUM(v.content_hash IS NULL AND v.caption_attempted_at IS NOT NULL),0) missing
    FROM videos v WHERE v.source_id=? AND julianday(v.published_at)>=julianday(?) AND julianday(v.published_at)<=julianday(?)`,
      )
      .get(s.id, start, end) as object;
    return { ...s, ...counts };
  });
}
