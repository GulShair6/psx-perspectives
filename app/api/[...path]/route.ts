import { today } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, companies, opinions, gate, consensus, queue, now } from "@/lib/db";
import { research, aiSettings } from "@/lib/ai";
import {
  queueDiscovery,
  queueExtraction,
  videos,
  extractionIds,
} from "@/lib/worker";
import { recordReview } from "@/lib/transcripts";
import {
  importSchema,
  reviewSchema,
  chatSchema,
  symbolSchema,
  videoId,
  officialUrl,
} from "@/lib/validation";
import {
  searchChannels,
  followChannel,
  syncChannel,
  pauseChannel,
  channelCoverage,
} from "@/lib/channels";
import {
  expertChatSchema,
  expertResearch,
  insights,
  pipeline,
  resumeInsights,
  reviewStatement,
  scopeCoverage,
} from "@/lib/expert";
import { catalog } from "@/lib/knowledge";
import { getTranslations, queueTranslation } from "@/lib/translations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function local(request: NextRequest, mutation = false) {
  const host = request.headers.get("host");
  if (!host || !/^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(host))
    throw new Error("Only localhost access is supported");
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (
    (origin && origin !== `http://${host}`) ||
    (site && !["same-origin", "none"].includes(site))
  )
    throw new Error("Same-origin requests are required");
  if (mutation) {
    if (request.headers.get("origin") !== `http://${host}`)
      throw new Error("Same-origin requests are required");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new Error("Use application/json");
  }
}
function response(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
async function json(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > 600000)
    throw new Error("Request too large");
  const text = await request.text();
  if (Buffer.byteLength(text) > 600000) throw new Error("Request too large");
  return JSON.parse(text);
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    local(request);
    const path = (await params).path.join("/");
    if (path === "translations") {
      const query = request.nextUrl.searchParams;
      return response(
        getTranslations({
          videoId: query.get("videoId"),
          target: query.get("target"),
          ...(query.has("method") ? { method: query.get("method") } : {}),
          ...(query.has("segmentIds")
            ? { segmentIds: query.get("segmentIds")!.split(",").map(Number) }
            : {}),
        }),
      );
    }
    if (path === "channels/search")
      return response({
        channels: await searchChannels(
          z.string().parse(request.nextUrl.searchParams.get("q")),
        ),
      });
    if (path === "channels")
      return response({
        channels: channelCoverage(),
        youtubeConfigured: !!process.env.YOUTUBE_DATA_API_KEY,
        pipeline: pipeline(),
        catalog: catalog(),
      });
    if (path === "channels/evidence") {
      const p = expertChatSchema.parse({
        question: "coverage",
        channelIds: (request.nextUrl.searchParams.get("ids") || "")
          .split(",")
          .map(Number),
        since: request.nextUrl.searchParams.get("since"),
        until: request.nextUrl.searchParams.get("until"),
      });
      return response(scopeCoverage(p));
    }
    if (path === "channels/insights") {
      const id = z.coerce
        .number()
        .int()
        .positive()
        .parse(request.nextUrl.searchParams.get("id"));
      const since = z.iso
        .date()
        .parse(request.nextUrl.searchParams.get("since"));
      const until = z.iso
        .date()
        .parse(request.nextUrl.searchParams.get("until"));
      if (since > until) throw new Error("Invalid date range");
      return response(
        insights(
          id,
          since,
          until,
          request.nextUrl.searchParams.get("symbol") || undefined,
          request.nextUrl.searchParams.get("topic")?.slice(0, 100) || undefined,
        ),
      );
    }
    if (path === "state") {
      const since =
        request.nextUrl.searchParams.get("since") ||
        today(new Date(Date.now() - 90 * 86400000));
      z.iso.date().parse(since);
      const classification = db
        .prepare("SELECT * FROM classifications")
        .all() as {
        symbol: string;
        status: "compliant" | "noncompliant";
        as_of: string;
        source_url: string;
      }[];
      const list = companies().map((c) => {
        const s = classification.find((s) => s.symbol === c.symbol);
        const fresh = s && Date.now() - Date.parse(s.as_of) <= 180 * 86400000;
        return {
          ...c,
          classification: s
            ? { ...s, status: fresh ? s.status : "unverified" }
            : null,
          consensus: consensus(c.symbol, since),
        };
      });
      return response({
        companies: list,
        opinions: opinions(),
        videos: videos(),
        sources: db.prepare("SELECT * FROM sources ORDER BY id").all(),
        jobs: db
          .prepare(
            "SELECT id,type,status,progress,created_at,updated_at,error FROM jobs ORDER BY (status='running') DESC,id DESC LIMIT 30",
          )
          .all(),
        gate: gate(),
        aiConfigured: aiSettings().configured,
        aiProvider: aiSettings().provider,
        aiModel: aiSettings().model,
        workerOnline: !!db
          .prepare("SELECT 1 FROM worker_lock WHERE heartbeat>?")
          .get(Date.now() - 30000),
      });
    }
    if (path === "video") {
      const id = z
        .string()
        .regex(/^[-\w]{11}$/)
        .parse(request.nextUrl.searchParams.get("id"));
      const video = db.prepare("SELECT * FROM videos WHERE id=?").get(id);
      if (!video) return response({ error: "Video not found" }, 404);
      return response({
        video,
        segments: db
          .prepare(
            "SELECT * FROM caption_segments WHERE video_id=? ORDER BY ordinal",
          )
          .all(id),
        chunks: db
          .prepare(
            "SELECT c.id,c.text,c.start_seconds,c.end_seconds,(SELECT json_group_array(segment_id) FROM chunk_segments WHERE chunk_id=c.id) segment_ids FROM chunks c WHERE video_id=? ORDER BY ordinal",
          )
          .all(id)
          .map((row) => {
            const { segment_ids, ...c } = row as {
              id: number;
              text: string;
              start_seconds: number | null;
              end_seconds: number | null;
              segment_ids: string;
            };
            return { ...c, segmentIds: JSON.parse(segment_ids) as number[] };
          }),
        passages: db
          .prepare(
            "SELECT id,start_seconds,text FROM passages WHERE video_id=? ORDER BY id",
          )
          .all(id),
      });
    }
    if (path === "export") {
      const format =
        request.nextUrl.searchParams.get("format") === "markdown"
          ? "markdown"
          : "csv";
      const rows = companies();
      const csv = (v: unknown) =>
        `"${String(v ?? "")
          .replace(/"/g, '""')
          .replace(/^[=+@-]/, "'$&")}"`;
      const content =
        format === "csv"
          ? [
              "Symbol,Company,Price PKR,PE TTM,Price return 1y excluding payouts %,Retrieved at,Source",
              ...rows.map((c) =>
                [
                  c.symbol,
                  c.name,
                  c.snapshot?.price,
                  c.snapshot?.pe,
                  c.snapshot?.priceReturn,
                  c.retrieved_at,
                  c.source_url,
                ]
                  .map(csv)
                  .join(","),
              ),
            ].join("\n")
          : `# PSX Perspectives scorecard\n\n${rows.map((c) => `## ${c.symbol} — ${c.name}\n\n${c.snapshot ? `Price: PKR ${c.snapshot.price}; P/E: ${c.snapshot.pe ?? "unavailable"}; price return excluding payouts: ${c.snapshot.priceReturn ?? "unavailable"}%.\n\nRetrieved: ${c.retrieved_at}. Source: ${c.source_url}\n\n${c.snapshot.notes.join("\n")}` : "No saved observations."}`).join("\n\n")}\n\n# Approved commentary\n\n${opinions()
              .filter((o) => o.status === "approved")
              .map(
                (o) =>
                  `${o.symbol}: ${o.speaker}, ${o.stance} (${o.published_at}).\n${o.quote}\n${o.url}${o.start_seconds !== null ? `&t=${Math.floor(o.start_seconds)}` : ""}`,
              )
              .join("\n\n")}\n\nResearch evidence, not an investment ranking.`;
      return new NextResponse(content, {
        headers: {
          "Content-Type":
            format === "csv"
              ? "text/csv; charset=utf-8"
              : "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="psx-perspectives.${format === "csv" ? "csv" : "md"}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return response({ error: "Endpoint not found" }, 404);
  } catch (e) {
    return response(
      { error: e instanceof Error ? e.message : "Request failed" },
      400,
    );
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    local(request, true);
    const path = (await params).path.join("/");
    const input = await json(request);
    if (path === "translations") {
      const result = queueTranslation(input);
      return response(result, result.job === null ? 200 : 202);
    }
    if (path === "channels/follow") {
      const p = z
        .object({
          id: z.string().regex(/^UC[\w-]{22}$/),
          confirmed: z.literal(true),
        })
        .strict()
        .parse(input);
      return response(await followChannel(p.id), 202);
    }
    if (["channels/sync", "channels/pause", "channels/resume"].includes(path)) {
      const p = z
        .object({ source_id: z.number().int().positive() })
        .strict()
        .parse(input);
      if (path === "channels/pause") {
        pauseChannel(p.source_id);
        return response({ ok: true });
      }
      return response(
        { job: syncChannel(p.source_id, path === "channels/resume") },
        202,
      );
    }
    if (path === "statements/review") {
      reviewStatement(input);
      return response({ ok: true });
    }
    if (path === "insights/resume") {
      z.object({}).strict().parse(input);
      resumeInsights();
      return response({ ok: true });
    }
    if (path === "catalog/refresh") {
      z.object({}).strict().parse(input);
      return response({ job: queue("catalog", {}) }, 202);
    }
    if (path === "catalog/aliases") {
      const p = z
        .object({
          symbol: z.string().regex(/^[A-Z0-9-]{1,20}$/),
          aliases: z.array(z.string().trim().min(1).max(100)).max(30),
        })
        .strict()
        .parse(input);
      if (
        !db
          .prepare("UPDATE stock_catalog SET aliases=? WHERE symbol=?")
          .run(JSON.stringify([...new Set(p.aliases)]), p.symbol).changes
      )
        throw new Error("Unknown stock symbol");
      return response({ ok: true });
    }
    if (path === "refresh") {
      const p = z
        .object({ symbols: z.array(symbolSchema).min(1).max(10) })
        .strict()
        .parse(input);
      return response({ job: queue("refresh", p) }, 202);
    }
    if (path === "import") {
      const p = importSchema.parse(input);
      videoId(p.url);
      return response({ job: queue("import", p) }, 202);
    }
    if (path === "extract") {
      const p = z
        .object({ id: z.string().regex(/^[-\w]{11}$/) })
        .strict()
        .parse(input);
      return response({ job: queueExtraction([p.id], true) }, 202);
    }
    if (path === "extract-batch") {
      const p = z.object({ ids: extractionIds }).strict().parse(input);
      return response({ job: queueExtraction(p.ids) }, 202);
    }
    if (path === "discover") {
      const p = z
        .object({ source_id: z.number().int().positive() })
        .strict()
        .parse(input);
      if (
        !db
          .prepare("SELECT 1 FROM sources WHERE id=? AND enabled=1")
          .get(p.source_id)
      )
        throw new Error("Source not found or disabled");
      return response({ job: queueDiscovery(p.source_id) }, 202);
    }
    if (path === "review") {
      recordReview(reviewSchema.parse(input));
      return response({ ok: true });
    }
    if (path === "watchlist") {
      const p = z
        .object({ symbol: symbolSchema, watched: z.boolean() })
        .strict()
        .parse(input);
      if (p.watched)
        db.prepare("INSERT OR IGNORE INTO watchlist VALUES(?)").run(p.symbol);
      else db.prepare("DELETE FROM watchlist WHERE symbol=?").run(p.symbol);
      return response({ ok: true });
    }
    if (path === "chat") {
      if (input.channelIds)
        return response(await expertResearch(expertChatSchema.parse(input)));
      const p = chatSchema.parse(input);
      return response(await research(p.question, p.symbols, p.since));
    }
    if (path === "sources") {
      const p = z
        .object({
          id: z.number().int().positive().optional(),
          name: z.string().trim().min(1).max(100),
          url: z.string().url().max(300),
          channel_id: z
            .string()
            .regex(/^UC[\w-]{22}$/)
            .nullable(),
          enabled: z.boolean(),
          kind: z.enum(["expert", "institutional"]),
        })
        .strict()
        .parse(input);
      const u = new URL(p.url);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.port ||
        ![
          "investkaar.com",
          "scstrade.com",
          "www.scstrade.com",
          "psx.com.pk",
          "www.psx.com.pk",
          "dps.psx.com.pk",
          "www.youtube.com",
          "youtube.com",
        ].includes(u.hostname)
      )
        throw new Error(
          "Use an official pilot website or HTTPS YouTube channel page",
        );
      if (
        p.channel_id &&
        db
          .prepare("SELECT 1 FROM sources WHERE channel_id=? AND id<>?")
          .get(p.channel_id, p.id || 0)
      )
        throw new Error(
          "That channel is already followed; edit its existing source.",
        );
      if (p.id) {
        const existing = db
          .prepare("SELECT channel_id FROM sources WHERE id=?")
          .get(p.id) as { channel_id: string | null } | undefined;
        if (
          existing?.channel_id &&
          existing.channel_id !== p.channel_id &&
          db.prepare("SELECT 1 FROM videos WHERE source_id=?").get(p.id)
        )
          throw new Error(
            "Follow the new channel in Expert research; changing this identity would mix saved histories.",
          );
        if (
          !db
            .prepare(
              "UPDATE sources SET name=?,url=?,channel_id=?,enabled=?,kind=?,verified_at=NULL,next_check_at=NULL,last_error=NULL WHERE id=?",
            )
            .run(p.name, p.url, p.channel_id, +p.enabled, p.kind, p.id).changes
        )
          throw new Error("Source not found");
      } else
        db.prepare(
          "INSERT INTO sources(name,url,channel_id,enabled,kind) VALUES(?,?,?,?,?)",
        ).run(p.name, p.url, p.channel_id, +p.enabled, p.kind);
      return response({ ok: true });
    }
    if (path === "classification") {
      const p = z
        .object({
          symbol: symbolSchema,
          status: z.enum(["compliant", "noncompliant"]),
          as_of: z.iso.date(),
          source_url: z.string().url(),
          confirmed: z.literal(true),
        })
        .strict()
        .parse(input);
      if (p.as_of > today())
        throw new Error("Classification date cannot be in the future");
      const url = officialUrl(p.source_url);
      db.prepare(
        "INSERT INTO classifications VALUES(?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET status=excluded.status,as_of=excluded.as_of,source_url=excluded.source_url,reviewed_at=excluded.reviewed_at",
      ).run(p.symbol, p.status, p.as_of, url, now());
      return response({ ok: true });
    }
    if (path === "retry") {
      const p = z
        .object({ id: z.number().int().positive() })
        .strict()
        .parse(input);
      const old = db
        .prepare("SELECT type,payload FROM jobs WHERE id=? AND status='failed'")
        .get(p.id) as { type: string; payload: string } | undefined;
      if (!old) throw new Error("Failed job not found");
      const payload = JSON.parse(old.payload);
      return response(
        {
          job:
            old.type === "channel_sync"
              ? syncChannel(payload.source_id, true)
              : old.type === "insights"
                ? (resumeInsights(),
                  (
                    db
                      .prepare(
                        "SELECT id FROM jobs WHERE type='insights' AND status IN ('queued','running') AND json_extract(payload,'$.id')=?",
                      )
                      .get(payload.id) as { id: number } | undefined
                  )?.id)
                : old.type === "discover"
                  ? queueDiscovery(payload.source_id)
                  : old.type === "extract" || old.type === "extract_batch"
                    ? queueExtraction(
                        (old.type === "extract"
                          ? [payload.id]
                          : payload.ids
                        ).filter(
                          (id: string) =>
                            !db
                              .prepare(
                                "SELECT 1 FROM videos WHERE id=? AND status='extracted' UNION SELECT 1 FROM opinions WHERE video_id=?",
                              )
                              .get(id, id),
                        ),
                        old.type === "extract",
                      )
                    : queue(old.type, payload),
        },
        202,
      );
    }
    return response({ error: "Endpoint not found" }, 404);
  } catch (e) {
    return response(
      { error: e instanceof Error ? e.message : "Request failed" },
      400,
    );
  }
}
