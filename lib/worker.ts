import { YoutubeTranscriptTooManyRequestError } from "youtube-transcript";
import { db, now, saveSnapshot, queue } from "./db";
import { collectPsx, fetchText, parseFeed } from "./sources";
import { importTranscript } from "./transcripts";
import { extractVideo } from "./ai";
import { symbolSchema, videoId } from "./validation";
import OpenAI from "openai";
import { z } from "zod";
import { createHash } from "node:crypto";
import { collectChannel, syncChannel, extendHistory } from "./channels";
import { sixMonthsAgo } from "./time";
import { indexVideo, refreshCatalog } from "./knowledge";
import { analyzeInsights, scheduleInsights, pipeline } from "./expert";
import { translateJob, youtubeCaptionJob } from "./translations";
import { captions, CAPTION_RETRY_INTERVAL } from "./youtube-captions";
export { captions, normalizeCaptions } from "./youtube-captions";
export const DISCOVERY_INTERVAL = 6 * 60 * 60 * 1000;
export { CAPTION_RETRY_INTERVAL } from "./youtube-captions";

export const extractionIds = z
  .array(z.string().regex(/^[-\w]{11}$/))
  .min(1)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, "Choose unique videos");
export function queueExtraction(ids: string[], single = false) {
  const valid = extractionIds.parse(ids);
  return db
    .transaction(() => {
      for (const id of valid) {
        if (!db.prepare("SELECT 1 FROM passages WHERE video_id=?").get(id))
          throw new Error("Import a transcript before analysis");
        if (
          db
            .prepare(
              "SELECT 1 FROM videos WHERE id=? AND status='extracted' UNION SELECT 1 FROM opinions WHERE video_id=?",
            )
            .get(id, id)
        )
          throw new Error(
            "This transcript has already been analyzed; review its opinions instead",
          );
        if (
          db
            .prepare(
              "SELECT 1 FROM jobs j WHERE j.status IN ('queued','running') AND ((j.type='extract' AND json_extract(j.payload,'$.id')=?) OR (j.type='extract_batch' AND EXISTS(SELECT 1 FROM json_each(j.payload,'$.ids') WHERE value=?)))",
            )
            .get(id, id)
        )
          throw new Error("Transcript analysis is already queued or running");
      }
      return queue(
        single ? "extract" : "extract_batch",
        single ? { id: valid[0] } : { ids: valid },
      );
    })
    .immediate();
}
export function videos() {
  return db
    .prepare(
      `SELECT v.*,
    (SELECT COUNT(*) FROM passages WHERE video_id=v.id) passage_count,
    (SELECT COUNT(*) FROM opinions WHERE video_id=v.id) opinion_count,
    (SELECT COUNT(*) FROM opinions WHERE video_id=v.id AND status='pending') pending_count,
    CASE WHEN EXISTS(SELECT 1 FROM jobs j WHERE status IN ('queued','running') AND ((type='extract' AND json_extract(payload,'$.id')=v.id) OR (type='extract_batch' AND EXISTS(SELECT 1 FROM json_each(j.payload,'$.ids') WHERE value=v.id)))) THEN 'Analyzing'
    WHEN v.content_hash IS NULL THEN 'Captions missing'
    WHEN EXISTS(SELECT 1 FROM opinions WHERE video_id=v.id AND status='pending') OR EXISTS(SELECT 1 FROM statements WHERE video_id=v.id AND status IN ('unreviewed','quarantined')) THEN 'Needs review'
    WHEN EXISTS(SELECT 1 FROM statements WHERE video_id=v.id AND status='reviewed') THEN 'Reviewed'
    WHEN EXISTS(SELECT 1 FROM analysis_runs WHERE video_id=v.id AND status='done') THEN 'No supported opinions found'
    WHEN EXISTS(SELECT 1 FROM analysis_runs WHERE video_id=v.id AND status='failed') THEN 'Analysis failed'
    WHEN v.status='extracted' OR EXISTS(SELECT 1 FROM opinions WHERE video_id=v.id) THEN 'Reviewed'
    WHEN v.error IS NOT NULL THEN 'Analysis failed'
    ELSE 'Ready to analyze' END analysis_state
    FROM videos v ORDER BY published_at DESC LIMIT 200`,
    )
    .all();
}
export async function analyzeBatch(
  ids: string[],
  progress: (s: string) => void,
  analyze = extractVideo,
) {
  extractionIds.parse(ids);
  let successful = 0,
    failed = 0;
  const errors: string[] = [];
  for (const id of ids) {
    progress(
      `${successful} successful, ${failed} failed, ${ids.length - successful - failed} remaining; analyzing ${id}`,
    );
    try {
      await analyze(id);
      db.prepare("UPDATE videos SET error=NULL WHERE id=?").run(id);
      successful++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      db.prepare("UPDATE videos SET error=? WHERE id=?").run(message, id);
      errors.push(`${id}: ${message}`);
      if (
        (e instanceof OpenAI.APIError &&
          [401, 403, 429].includes(e.status || 0)) ||
        /Set OLLAMA_API_KEY/i.test(message)
      )
        break;
    }
  }
  const result = `${successful} successful, ${failed} failed, ${ids.length - successful - failed} unprocessed`;
  progress(result);
  if (errors.length) throw new Error(result + "; " + errors.join("; "));
  const count = (
    db
      .prepare(
        `SELECT COUNT(*) n FROM opinions WHERE video_id IN (${ids.map(() => "?").join(",")})`,
      )
      .get(...ids) as { n: number }
  ).n;
  return (
    result +
    (count
      ? `; ${count} supported opinions await review`
      : "; No supported opinions found")
  );
}
export function queueDiscovery(sourceId: number, time = Date.now()) {
  return db
    .transaction(() => {
      if (
        !db
          .prepare("SELECT 1 FROM sources WHERE id=? AND enabled=1")
          .get(sourceId)
      )
        throw new Error("Source not found or disabled");
      const active = db
        .prepare(
          "SELECT id FROM jobs WHERE type='discover' AND status IN ('queued','running') AND json_extract(payload,'$.source_id')=? ORDER BY id LIMIT 1",
        )
        .get(sourceId) as { id: number } | undefined;
      if (active) return active.id;
      const stamp = new Date(time).toISOString();
      const job = Number(
        db
          .prepare(
            "INSERT INTO jobs(type,payload,created_at,updated_at) VALUES('discover',?,?,?)",
          )
          .run(JSON.stringify({ source_id: sourceId }), stamp, stamp)
          .lastInsertRowid,
      );
      db.prepare("UPDATE sources SET next_check_at=? WHERE id=?").run(
        new Date(time + DISCOVERY_INTERVAL).toISOString(),
        sourceId,
      );
      return job;
    })
    .immediate();
}

export function scheduleDiscovery(time = Date.now()) {
  extendHistory();
  db.transaction(() => {
    const due = db
      .prepare(
        "SELECT id FROM sources WHERE enabled=1 AND (next_check_at IS NULL OR next_check_at<=?) ORDER BY id",
      )
      .all(new Date(time).toISOString()) as { id: number }[];
    for (const source of due) {
      if (process.env.YOUTUBE_DATA_API_KEY) {
        const row = db
          .prepare("SELECT channel_id FROM sources WHERE id=?")
          .get(source.id) as { channel_id: string | null };
        if (row.channel_id) {
          const cp = db
            .prepare(
              "SELECT discovery_complete FROM channel_checkpoints WHERE source_id=?",
            )
            .get(source.id) as { discovery_complete: number } | undefined;
          syncChannel(source.id, !cp?.discovery_complete);
        }
      } else {
        queueDiscovery(source.id, time);
      }
    }
  }).immediate();
  scheduleInsights();
  if (
    !pipeline().catalog_checked_at &&
    !db
      .prepare(
        "SELECT 1 FROM jobs WHERE type='catalog' AND status IN ('queued','running','failed')",
      )
      .get()
  )
    queue("catalog", {});
}
export function groupCaptions(segments: { text: string; offset: number }[]) {
  const result: { text: string; offset: number }[] = [];
  for (const segment of segments) {
    const last = result.at(-1);
    if (last && last.text.length + segment.text.length < 1800)
      last.text += " " + segment.text;
    else result.push({ ...segment });
  }
  return result;
}
export async function discover(
  sourceId: number,
  progress: (s: string) => void,
) {
  const s = db
    .prepare("SELECT * FROM sources WHERE id=? AND enabled=1")
    .get(sourceId) as
    | {
        id: number;
        url: string;
        channel_id: string | null;
        name: string;
        kind: string;
      }
    | undefined;
  if (!s) throw new Error("Source is missing or disabled");
  db.prepare(
    "UPDATE sources SET last_checked_at=?,last_error=NULL WHERE id=?",
  ).run(now(), s.id);
  const html = await fetchText(s.url);
  const ids = [
    ...html.matchAll(
      /(?:youtube\.com\/channel\/|"channelId"\s*:\s*")(UC[\w-]{22})/g,
    ),
  ].map((m) => m[1]);
  const channel = s.channel_id || ids[0];
  if (!channel || !ids.includes(channel))
    throw new Error(
      "Channel identity could not be verified on the official source page. Edit its website/channel ID or import video transcripts.",
    );
  db.prepare("UPDATE sources SET channel_id=?,verified_at=? WHERE id=?").run(
    channel,
    now(),
    s.id,
  );
  const entries = parseFeed(
    await fetchText(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`,
    ),
  );
  const cutoff = new Date(sixMonthsAgo() + "T00:00:00+05:00").toISOString();
  const relevant = entries.filter(
    (v) => v.published_at >= cutoff && v.published_at <= now(),
  );
  let captionCount = 0;
  for (const v of relevant) {
    if (
      !db
        .prepare("SELECT 1 FROM sources WHERE id=? AND enabled=1")
        .get(sourceId)
    )
      return "Paused after current caption request; saved evidence preserved";
    progress(`Checking ${v.title.slice(0, 80)}`);
    const existing = db
      .prepare(
        "SELECT content_hash,caption_attempted_at FROM videos WHERE id=?",
      )
      .get(v.id) as
      | { content_hash: string | null; caption_attempted_at: string | null }
      | undefined;
    if (existing?.content_hash) continue;
    if (
      existing?.caption_attempted_at &&
      Date.now() - Date.parse(existing.caption_attempted_at) <
        CAPTION_RETRY_INTERVAL
    )
      continue;
    if (videoId(v.url) !== v.id)
      throw new Error("Feed video identity mismatch");
    db.prepare(
      "INSERT OR IGNORE INTO videos(id,source_id,title,speaker,published_at,url) VALUES(?,?,?,?,?,?)",
    ).run(v.id, s.id, v.title, s.name, v.published_at, v.url);
    db.prepare("UPDATE videos SET caption_attempted_at=? WHERE id=?").run(
      now(),
      v.id,
    );
    try {
      const segments = await captions(v.id);
      const text = segments.map((x) => x.text).join(" ");
      if (text.length > 120000)
        throw new Error("Transcript exceeds import limit");
      db.transaction(() => {
        for (const p of groupCaptions(segments))
          db.prepare(
            "INSERT INTO passages(video_id,start_seconds,text) VALUES(?,?,?)",
          ).run(v.id, p.offset, p.text);
        db.prepare(
          "UPDATE videos SET language=?,status='imported',content_hash=?,error=NULL WHERE id=?",
        ).run(
          segments[0]?.lang || "unknown",
          createHash("sha256").update(text).digest("hex"),
          v.id,
        );
      }).immediate();
      indexVideo(
        v.id,
        segments.map((s) => ({
          text: s.text,
          start_seconds: s.offset,
          end_seconds: s.duration > 0 ? s.offset + s.duration : null,
        })),
        segments[0]?.lang || "unknown",
        segments[0]?.provenance || "YouTube captions",
      );
      scheduleInsights();
      captionCount++;
    } catch (e) {
      db.prepare(
        "UPDATE videos SET status='needs_transcript',error=? WHERE id=?",
      ).run(String(e instanceof Error ? e.message : e), v.id);
      if (e instanceof YoutubeTranscriptTooManyRequestError) throw e;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return `Recent feed only; full-period discovery incomplete. Discovered ${relevant.length} videos; ${captionCount} caption imports. Videos without captions need manual transcripts.`;
}
export async function runJob(job: {
  id: number;
  type: string;
  payload: string;
}) {
  const p = JSON.parse(job.payload);
  const progress = (text: string) =>
    db
      .prepare("UPDATE jobs SET progress=?,updated_at=? WHERE id=?")
      .run(text, now(), job.id);
  if (job.type === "local_translate")
    throw new Error("Local model translation has been removed.");
  if (job.type === "catalog") return refreshCatalog();
  if (job.type === "translate") return translateJob(p, progress);
  if (job.type === "youtube_captions") return youtubeCaptionJob(p, progress);
  if (job.type === "insights") return analyzeInsights(p.id, progress);
  if (job.type === "channel_sync") {
    try {
      return await collectChannel(p.source_id, progress, async (id) => {
        db.prepare("UPDATE videos SET caption_attempted_at=? WHERE id=?").run(
          now(),
          id,
        );
        try {
          const segments = await captions(id);
          const text = segments.map((s) => s.text).join(" ");
          if (text.length > 120000)
            throw new Error("Transcript exceeds import limit");
          db.transaction(() => {
            if (
              db
                .prepare(
                  "SELECT 1 FROM videos WHERE id=? AND content_hash IS NOT NULL",
                )
                .get(id)
            )
              return;
            for (const s of groupCaptions(segments))
              db.prepare(
                "INSERT INTO passages(video_id,start_seconds,text) VALUES(?,?,?)",
              ).run(id, s.offset, s.text);
            db.prepare(
              "UPDATE videos SET content_hash=?,language=?,status='imported',error=NULL WHERE id=?",
            ).run(
              createHash("sha256").update(text).digest("hex"),
              segments[0]?.lang || "unknown",
              id,
            );
            indexVideo(
              id,
              segments.map((s) => ({
                text: s.text,
                start_seconds: s.offset,
                end_seconds: s.duration > 0 ? s.offset + s.duration : null,
              })),
              segments[0]?.lang || "unknown",
              segments[0]?.provenance || "YouTube captions",
            );
          }).immediate();
          scheduleInsights();
        } catch (e) {
          db.prepare(
            "UPDATE videos SET status='needs_transcript',error=? WHERE id=? AND content_hash IS NULL",
          ).run(
            e instanceof Error ? e.message : "Caption collection failed",
            id,
          );
          if (e instanceof YoutubeTranscriptTooManyRequestError) throw e;
        }
        await new Promise((r) => setTimeout(r, 1500));
      });
    } catch (e) {
      db.prepare("UPDATE sources SET last_error=? WHERE id=?").run(
        e instanceof Error ? e.message : "Collection failed",
        p.source_id,
      );
      throw e;
    }
  }
  if (job.type === "refresh") {
    const list = (p.symbols as string[]).map((s) => symbolSchema.parse(s));
    const failures: string[] = [];
    for (const symbol of list) {
      progress(`Refreshing ${symbol}`);
      try {
        saveSnapshot(symbol, await collectPsx(symbol));
      } catch (e) {
        failures.push(
          `${symbol}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (failures.length) throw new Error(failures.join("; "));
    return `${list.length} companies refreshed from PSX`;
  }
  if (job.type === "import") {
    const r = importTranscript(p);
    indexVideo(r.id, undefined, p.language, "User-supplied transcript");
    scheduleInsights();
    progress(
      r.duplicate ? "Existing transcript preserved" : "Transcript saved",
    );
    return r.duplicate
      ? "Duplicate skipped"
      : "Transcript indexed and searchable. Automatic insights queued when Ollama is available.";
  }
  if (job.type === "extract" || job.type === "extract_batch") {
    return analyzeBatch(job.type === "extract" ? [p.id] : p.ids, progress);
  }

  if (job.type === "discover") {
    try {
      const result = await discover(p.source_id, progress);
      db.prepare("UPDATE sources SET last_error=NULL WHERE id=?").run(
        p.source_id,
      );
      return result;
    } catch (e) {
      db.prepare("UPDATE sources SET last_error=? WHERE id=?").run(
        e instanceof Error ? e.message : String(e),
        p.source_id,
      );
      throw e;
    }
  }
  throw new Error("Unknown job type");
}
export function claimJob() {
  return db
    .transaction(() => {
      const j = db
        .prepare(
          "SELECT id,type,payload FROM jobs WHERE status='queued' ORDER BY CASE WHEN type='insights' THEN 1 ELSE 0 END,CASE WHEN type='insights' THEN (SELECT julianday(published_at) FROM videos WHERE id=json_extract(jobs.payload,'$.id')) END DESC,id LIMIT 1",
        )
        .get() as { id: number; type: string; payload: string } | undefined;
      if (j)
        db.prepare(
          "UPDATE jobs SET status='running',updated_at=? WHERE id=? AND status='queued'",
        ).run(now(), j.id);
      return j;
    })
    .immediate();
}
