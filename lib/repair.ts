import { createHash } from "node:crypto";
import { db, now, reviewEvidence } from "./db";
import { validateExtraction } from "./ai";
import { validateStatement, ANALYSIS_VERSION, type Chunk } from "./expert";
import { indexVideo } from "./knowledge";
import { parseTranscript } from "./transcripts";
import { importSchema, videoId } from "./validation";

type Row = Record<string, unknown>;
const all = (table: string) =>
  db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Row[];
const exists = (table: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const tables = [
  "videos",
  "passages",
  "caption_segments",
  "chunks",
  "chunk_segments",
  "opinions",
  "evaluations",
  "statements",
  "statement_stocks",
  "statement_topics",
  "statement_evaluations",
  "analysis_runs",
  "analysis_checkpoints",
  "jobs",
  "local_translation_blocks",
  "translation_reviews",
  "segment_translations",
  "youtube_caption_tracks",
  "opinion_quarantine",
  "source_repairs",
];
function fingerprint() {
  return hash(JSON.stringify(tables.map((t) => [t, exists(t) ? all(t) : []])));
}
function archivedVideo(id: string) {
  const jobMatches = (payload: unknown) => {
    try {
      const p = JSON.parse(String(payload));
      return (
        p.id === id ||
        p.videoId === id ||
        (Array.isArray(p.ids) && p.ids.includes(id)) ||
        (typeof p.url === "string" && videoId(p.url) === id)
      );
    } catch {
      return false;
    }
  };
  const chunks = new Set(
    (
      db.prepare("SELECT id FROM chunks WHERE video_id=?").all(id) as {
        id: number;
      }[]
    ).map((r) => r.id),
  );
  const segments = new Set(
    (
      db
        .prepare("SELECT id FROM caption_segments WHERE video_id=?")
        .all(id) as { id: number }[]
    ).map((r) => r.id),
  );
  const statements = new Set(
    (
      db.prepare("SELECT id FROM statements WHERE video_id=?").all(id) as {
        id: number;
      }[]
    ).map((r) => r.id),
  );
  const opinions = new Set(
    (
      db.prepare("SELECT id FROM opinions WHERE video_id=?").all(id) as {
        id: number;
      }[]
    ).map((r) => r.id),
  );
  return Object.fromEntries(
    tables
      .filter((t) => exists(t))
      .map((t) => [
        t,
        all(t).filter(
          (r) =>
            r.video_id === id ||
            (t === "videos" && r.id === id) ||
            (t === "jobs" && jobMatches(r.payload)) ||
            chunks.has(Number(r.chunk_id)) ||
            segments.has(Number(r.segment_id)) ||
            statements.has(Number(r.statement_id)) ||
            opinions.has(Number(r.opinion_id)),
        ),
      ]),
  );
}
function buildRepairPlan() {
  const statements: { id: number; reason: string; original: Row }[] = [];
  const opinions: { id: number; reason: string; original: Row }[] = [];
  const conflicts: { kind: string; id: string | number; reason: string }[] = [];
  for (const row of all("statements")) {
    if (["quarantined", "rejected"].includes(String(row.status))) continue;
    const chunk = db
      .prepare("SELECT * FROM chunks WHERE id=? AND video_id=?")
      .get(row.chunk_id, row.video_id) as Chunk | undefined;
    let raw: Row = {};
    try {
      raw = JSON.parse(String(row.original_payload || "{}"));
    } catch {
      /* Revalidate saved fields if a legacy payload is missing. */
    }
    const symbol = db
      .prepare(
        "SELECT symbol FROM statement_stocks WHERE statement_id=? ORDER BY symbol LIMIT 1",
      )
      .get(row.id) as { symbol: string } | undefined;
    const topic = db
      .prepare(
        "SELECT topic FROM statement_topics WHERE statement_id=? LIMIT 1",
      )
      .get(row.id) as { topic: string } | undefined;
    try {
      validateStatement(
        {
          ...raw,
          ...row,
          symbol: symbol?.symbol ?? raw.symbol ?? null,
          topic: topic?.topic || raw.topic || "market",
          hypothetical: raw.hypothetical ?? false,
        },
        chunk ? [chunk] : [],
      );
    } catch (e) {
      const issue = {
        id: Number(row.id),
        reason: (e as Error).message,
        original: row,
      };
      if (
        row.status === "reviewed" ||
        db
          .prepare("SELECT 1 FROM statement_evaluations WHERE statement_id=?")
          .get(row.id)
      )
        conflicts.push({
          kind: "statement",
          id: issue.id,
          reason: issue.reason,
        });
      else statements.push(issue);
    }
  }
  for (const row of all("opinions")) {
    if (
      row.status === "rejected" ||
      (row.status === "pending" &&
        exists("opinion_quarantine") &&
        db
          .prepare("SELECT 1 FROM opinion_quarantine WHERE opinion_id=?")
          .get(row.id))
    )
      continue;
    try {
      validateExtraction(
        { opinions: [{ ...row, hypothetical: !!row.hypothetical }] },
        db
          .prepare("SELECT id,text FROM passages WHERE id=? AND video_id=?")
          .all(row.passage_id, row.video_id) as { id: number; text: string }[],
      );
    } catch (e) {
      const issue = {
        id: Number(row.id),
        reason: (e as Error).message,
        original: row,
      };
      if (
        row.status !== "pending" ||
        row.reviewed_at ||
        db.prepare("SELECT 1 FROM evaluations WHERE opinion_id=?").get(row.id)
      )
        conflicts.push({ kind: "opinion", id: issue.id, reason: issue.reason });
      else opinions.push(issue);
    }
  }
  const imports: {
    id: string;
    previousHash: string;
    contentHash: string;
    input: ReturnType<typeof importSchema.parse>;
    archive: ReturnType<typeof archivedVideo>;
  }[] = [];
  const missingRaw: string[] = [];
  const importJobs = db
    .prepare("SELECT payload FROM jobs WHERE type='import' ORDER BY id")
    .all() as { payload: string }[];
  for (const video of db
    .prepare(
      "SELECT DISTINCT v.id,v.content_hash FROM videos v JOIN caption_segments s ON s.video_id=v.id WHERE s.provenance IN ('User-supplied transcript','legacy import')",
    )
    .all() as { id: string; content_hash: string }[]) {
    if (
      exists("source_repairs") &&
      db
        .prepare(
          "SELECT 1 FROM source_repairs WHERE video_id=? AND content_hash=?",
        )
        .get(video.id, video.content_hash)
    )
      continue;
    let input: ReturnType<typeof importSchema.parse> | undefined;
    for (const job of importJobs) {
      try {
        const candidate = importSchema.parse(JSON.parse(job.payload));
        if (
          videoId(candidate.url) === video.id &&
          hash(candidate.text) === video.content_hash
        ) {
          input = candidate;
          break;
        }
      } catch {
        /* Unrelated or malformed jobs are never recovery sources. */
      }
    }
    if (!input) {
      missingRaw.push(video.id);
      continue;
    }
    let parsed;
    try {
      parsed = parseTranscript(input.text).map((p) => ({
        text: p.text,
        start_seconds: p.start_seconds,
        end_seconds: p.end_seconds ?? null,
      }));
      if (!parsed.length) throw new Error("No usable source passages");
    } catch {
      conflicts.push({
        kind: "import",
        id: video.id,
        reason:
          "Retained input cannot be parsed safely; original file required",
      });
      continue;
    }
    const saved = db
      .prepare(
        "SELECT text,start_seconds,end_seconds FROM caption_segments WHERE video_id=? ORDER BY ordinal",
      )
      .all(video.id);
    if (JSON.stringify(parsed) === JSON.stringify(saved)) continue;
    const human = db
      .prepare(
        "SELECT 1 WHERE EXISTS(SELECT 1 FROM statements st LEFT JOIN statement_evaluations e ON e.statement_id=st.id WHERE st.video_id=? AND (st.status IN ('reviewed','rejected') OR e.statement_id IS NOT NULL)) OR EXISTS(SELECT 1 FROM opinions o LEFT JOIN evaluations e ON e.opinion_id=o.id WHERE o.video_id=? AND (o.status!='pending' OR o.reviewed_at IS NOT NULL OR e.opinion_id IS NOT NULL)) OR EXISTS(SELECT 1 FROM translation_reviews r JOIN chunks c ON c.id=r.chunk_id WHERE c.video_id=?)",
      )
      .get(video.id, video.id, video.id);
    if (human) {
      conflicts.push({
        kind: "import",
        id: video.id,
        reason: "Source is linked to a human decision; retained unchanged",
      });
      continue;
    }
    imports.push({
      id: video.id,
      previousHash: video.content_hash,
      contentHash: hash("caption-parser-2\n" + input.text),
      input,
      archive: archivedVideo(video.id),
    });
  }
  return {
    version: "audit-1",
    fingerprint: fingerprint(),
    statements,
    opinions,
    imports,
    missingRaw,
    conflicts,
    unresolvedReviews: reviewEvidence().unresolved,
  };
}
export function repairPlan() {
  return db.transaction(buildRepairPlan).deferred();
}
export type RepairPlan = ReturnType<typeof repairPlan>;
export function applyRepair(plan: RepairPlan) {
  db.transaction(() => {
    if (fingerprint() !== plan.fingerprint)
      throw new Error(
        "Saved data changed after preview; generate a fresh repair report",
      );
    const lease = db
      .prepare("SELECT heartbeat FROM worker_lock WHERE id=1")
      .get() as { heartbeat: number } | undefined;
    if (
      (lease && Date.now() - lease.heartbeat < 30_000) ||
      db.prepare("SELECT 1 FROM jobs WHERE status='running'").get()
    )
      throw new Error("Stop the worker before applying repairs");
    for (const issue of plan.statements)
      db.prepare(
        "UPDATE statements SET status='quarantined',validation_error=?,original_payload=COALESCE(original_payload,?) WHERE id=?",
      ).run(issue.reason, JSON.stringify(issue.original), issue.id);
    for (const issue of plan.opinions)
      db.prepare("INSERT INTO opinion_quarantine VALUES(?,?,?,?)").run(
        issue.id,
        issue.reason,
        JSON.stringify(issue.original),
        now(),
      );
    for (const source of plan.imports) {
      const id = source.id;
      db.prepare(
        "DELETE FROM opinion_quarantine WHERE opinion_id IN (SELECT id FROM opinions WHERE video_id=?)",
      ).run(id);
      for (const table of ["statement_stocks", "statement_topics"])
        db.prepare(
          `DELETE FROM ${table} WHERE statement_id IN (SELECT id FROM statements WHERE video_id=?)`,
        ).run(id);
      db.prepare("DELETE FROM statements WHERE video_id=?").run(id);
      db.prepare("DELETE FROM opinions WHERE video_id=?").run(id);
      db.prepare(
        "DELETE FROM english_translation_search WHERE rowid IN (SELECT id FROM chunks WHERE video_id=?)",
      ).run(id);
      db.prepare(
        "DELETE FROM chunk_segments WHERE chunk_id IN (SELECT id FROM chunks WHERE video_id=?)",
      ).run(id);
      db.prepare("DELETE FROM analysis_checkpoints WHERE video_id=?").run(id);
      db.prepare("DELETE FROM chunks WHERE video_id=?").run(id);
      db.prepare("DELETE FROM caption_segments WHERE video_id=?").run(id);
      db.prepare("DELETE FROM passages WHERE video_id=?").run(id);
      db.prepare("DELETE FROM youtube_caption_tracks WHERE video_id=?").run(id);
      const passages = parseTranscript(source.input.text);
      for (const p of passages)
        db.prepare(
          "INSERT INTO passages(video_id,start_seconds,text) VALUES(?,?,?)",
        ).run(id, p.start_seconds, p.text);
      db.prepare(
        "UPDATE videos SET content_hash=?,status='imported',error=NULL WHERE id=?",
      ).run(source.contentHash, id);
      indexVideo(
        id,
        passages,
        source.input.language,
        "User-supplied transcript",
      );
      db.prepare(
        "INSERT INTO source_repairs VALUES(?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET previous_hash=excluded.previous_hash,content_hash=excluded.content_hash,created_at=excluded.created_at",
      ).run(id, source.previousHash, source.contentHash, now());
      db.prepare(
        "INSERT INTO analysis_runs(video_id,transcript_hash,version,status,error,updated_at) VALUES(?,?,?,'failed','Source repaired; explicitly resume analysis to regenerate insights',?)",
      ).run(id, source.contentHash, ANALYSIS_VERSION, now());
      db.prepare(
        "UPDATE jobs SET status='failed',error='Source repaired; request a fresh job',updated_at=? WHERE status='queued' AND json_valid(payload) AND (json_extract(payload,'$.id')=? OR json_extract(payload,'$.videoId')=? OR EXISTS(SELECT 1 FROM json_each(payload,'$.ids') WHERE value=?))",
      ).run(now(), id, id, id);
    }
    if (plan.imports.length)
      db.exec(
        "DELETE FROM research_answers; INSERT INTO chunk_search(chunk_search) VALUES('rebuild'); INSERT INTO passage_search(passage_search) VALUES('rebuild');",
      );
  }).immediate();
}
