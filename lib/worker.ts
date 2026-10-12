import { YoutubeTranscript } from "youtube-transcript";
import { db, now, saveSnapshot } from "./db";
import { collectPsx, fetchText, parseFeed } from "./sources";
import { importTranscript } from "./transcripts";
import { extractVideo } from "./ai";
import { symbolSchema, videoId } from "./validation";
import { createHash } from "node:crypto";
export function normalizeCaptions(
  segments: { text: string; offset: number; duration: number; lang?: string }[],
  milliseconds: boolean,
) {
  return segments.map((s) => ({
    ...s,
    offset: s.offset / (milliseconds ? 1000 : 1),
    duration: s.duration / (milliseconds ? 1000 : 1),
  }));
}
export async function captions(id: string) {
  let milliseconds = false;
  const segments = await YoutubeTranscript.fetchTranscript(id, {
    fetch: async (input, init) => {
      const u = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.port ||
        !["www.youtube.com", "youtube.com"].includes(u.hostname)
      )
        throw new Error("Unsupported caption host");
      const response = await fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.text();
      if (Buffer.byteLength(body) > 3_000_000)
        throw new Error("Caption response exceeds size limit");
      if (/<p\s+t="\d+"\s+d="\d+"/.test(body)) milliseconds = true;
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      });
    },
  });
  if (!segments.length)
    throw new Error("No usable captions; import TXT/SRT/VTT instead");
  return normalizeCaptions(segments, milliseconds);
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
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const relevant = entries
    .filter(
      (v) =>
        v.published_at >= cutoff &&
        v.published_at <= now() &&
        (s.kind === "institutional" ||
          /psx|stock|invest|market|dividend|earnings|سٹاک|سرمایہ|شیئر/i.test(
            v.title,
          )),
    )
    .slice(0, 10);
  let captionCount = 0;
  for (const v of relevant) {
    progress(`Checking ${v.title.slice(0, 80)}`);
    const existing = db
      .prepare("SELECT content_hash FROM videos WHERE id=?")
      .get(v.id) as { content_hash: string | null } | undefined;
    if (existing?.content_hash) continue;
    videoId(v.url);
    db.prepare(
      "INSERT OR IGNORE INTO videos(id,source_id,title,speaker,published_at,url) VALUES(?,?,?,?,?,?)",
    ).run(v.id, s.id, v.title, s.name, v.published_at, v.url);
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
      captionCount++;
      if (process.env.OPENAI_API_KEY) {
        try {
          await extractVideo(v.id);
        } catch (e) {
          db.prepare("UPDATE videos SET error=? WHERE id=?").run(
            String(e instanceof Error ? e.message : e),
            v.id,
          );
        }
      }
    } catch (e) {
      db.prepare(
        "UPDATE videos SET status='needs_transcript',error=? WHERE id=?",
      ).run(String(e instanceof Error ? e.message : e), v.id);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return `Discovered ${relevant.length} videos; ${captionCount} caption imports. Videos without captions need manual transcripts.`;
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
    progress(
      r.duplicate ? "Existing transcript preserved" : "Transcript saved",
    );
    if (process.env.OPENAI_API_KEY) {
      await extractVideo(r.id);
      return "Transcript imported; extracted opinions await review";
    }
    return r.duplicate
      ? "Duplicate skipped"
      : "Transcript imported. Add an API key to extract opinions.";
  }
  if (job.type === "extract") {
    await extractVideo(p.id);
    return "Opinions extracted and awaiting review";
  }
  if (job.type === "discover") return discover(p.source_id, progress);
  throw new Error("Unknown job type");
}
export function claimJob() {
  return db
    .transaction(() => {
      const j = db
        .prepare(
          "SELECT id,type,payload FROM jobs WHERE status='queued' ORDER BY id LIMIT 1",
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
