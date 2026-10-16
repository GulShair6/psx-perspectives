import { readFileSync } from "node:fs";
import { cpus, hostname, totalmem } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { db } from "./db";
import {
  localScope,
  queueLocal,
  translationQuality,
} from "./local-translations";
import {
  localDirectory,
  localReadiness,
  LOCAL_REVISION,
  LOCAL_VERSION,
  sourceHash,
} from "./local-runtime";
export const machineFingerprint = () =>
  sourceHash(
    JSON.stringify([hostname(), cpus().map((c) => c.model), totalmem()]),
  );
export function archiveReadiness() {
  try {
    const report = z
      .object({
        revision: z.literal(LOCAL_REVISION),
        version: z.literal(LOCAL_VERSION),
        machine: z.string(),
        samples: z.number().int().min(30),
        expectedDailySeconds: z
          .number()
          .positive()
          .max(8 * 3600),
        peakRssMiB: z.number().positive().max(4096),
        appLatencyMs: z.number().nonnegative().max(1000),
        failures: z.literal(0),
      })
      .parse(
        JSON.parse(
          readFileSync(join(localDirectory, "benchmark.json"), "utf8"),
        ),
      );
    const retrieval = z
      .object({
        revision: z.literal(LOCAL_REVISION),
        version: z.literal(LOCAL_VERSION),
        reviews: z
          .array(
            z.object({
              id: z.number().int(),
              reviewer: z.string().trim().min(1),
              passed: z.boolean(),
            }),
          )
          .length(20),
      })
      .parse(
        JSON.parse(
          readFileSync(join(localDirectory, "retrieval-reviews.json"), "utf8"),
        ),
      );
    return (
      report.machine === machineFingerprint() &&
      new Set(retrieval.reviews.map((r) => r.id)).size === 20 &&
      retrieval.reviews.filter((r) => r.passed).length >= 18 &&
      translationQuality("en").validated
    );
  } catch {
    return false;
  }
}
export function scheduleLocalPreparation() {
  if (!localReadiness().ready) return;
  if (
    db
      .prepare(
        "SELECT 1 FROM jobs WHERE type='local_translate' AND status IN ('queued','running')",
      )
      .get()
  )
    return;
  const archive = archiveReadiness();
  const candidates = db
    .prepare(
      `SELECT c.id,c.video_id,EXISTS(SELECT 1 FROM caption_segments seg WHERE seg.video_id=v.id AND seg.retrieved_at>=(SELECT preparation_since FROM local_reading_state WHERE id=1)) is_new FROM chunks c JOIN videos v ON v.id=c.video_id JOIN sources s ON s.id=v.source_id WHERE s.enabled=1 AND (is_new OR (? AND NOT EXISTS(SELECT 1 FROM jobs WHERE status IN ('queued','running')))) AND NOT EXISTS(SELECT 1 FROM local_translation_blocks b WHERE b.chunk_id=c.id AND b.transcript_hash=v.content_hash AND b.target='en' AND b.revision=? AND b.version=?) AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.type='local_translate' AND j.status='failed' AND json_extract(j.payload,'$.transcriptHash')=v.content_hash AND json_extract(j.payload,'$.revision')=? AND json_extract(j.payload,'$.target')='en' AND EXISTS(SELECT 1 FROM json_each(j.payload,'$.chunkIds') WHERE value=c.id)) ORDER BY is_new DESC,v.published_at DESC,c.ordinal LIMIT 50`,
    )
    .all(Number(archive), LOCAL_REVISION, LOCAL_VERSION, LOCAL_REVISION) as {
    id: number;
    video_id: string;
    is_new: number;
  }[];
  for (const c of candidates) {
    const ids = (
      db
        .prepare("SELECT segment_id FROM chunk_segments WHERE chunk_id=?")
        .all(c.id) as { segment_id: number }[]
    ).map((r) => r.segment_id);
    try {
      const scope = localScope(c.video_id, "en", ids);
      if (queueLocal(scope, c.is_new ? "new" : "archive").job) break;
    } catch {
      /* Unsupported sources stay available in the original; no cloud fallback. */
    }
  }
}
