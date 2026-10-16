import { db, now, queue } from "./db";
import { z } from "zod";
import { normalize } from "./knowledge";
import {
  validateLocalBlocks,
  inferLocal,
  localReadiness,
  sourceHash,
  sourceLanguage,
  LOCAL_REVISION,
  LOCAL_VERSION,
  type LocalBlock,
} from "./local-runtime";
export { LOCAL_REVISION, LOCAL_VERSION } from "./local-runtime";
type Block = {
  id: number;
  text: string;
  start_seconds: number | null;
  end_seconds: number | null;
};
type Saved = {
  chunkId: number;
  text: string;
  provider: string;
  createdAt: string;
  segmentIds: number[];
  startSeconds: number | null;
  endSeconds: number | null;
};
const jobSchema = z
  .object({
    videoId: z.string().regex(/^[-\w]{11}$/),
    target: z.enum(["en", "ur"]),
    chunkIds: z.array(z.number().int().positive()).min(1).max(10000),
    transcriptHash: z.string().min(1),
    revision: z.literal(LOCAL_REVISION),
    version: z.literal(LOCAL_VERSION),
    key: z.string().length(64),
    priority: z.enum(["reading", "new", "archive"]).default("reading"),
  })
  .strict();
export function localScope(
  videoId: string,
  target: "ur" | "en",
  segmentIds: number[],
) {
  const video = db
    .prepare("SELECT content_hash,language FROM videos WHERE id=?")
    .get(videoId) as { content_hash: string; language: string };
  const rows = db
    .prepare(
      "SELECT DISTINCT c.id,c.text,c.start_seconds,c.end_seconds FROM chunks c JOIN chunk_segments cs ON cs.chunk_id=c.id WHERE c.video_id=? ORDER BY c.ordinal",
    )
    .all(videoId) as Block[];
  const mappings = db
    .prepare(
      "SELECT cs.chunk_id,cs.segment_id FROM chunk_segments cs JOIN chunks c ON c.id=cs.chunk_id WHERE c.video_id=?",
    )
    .all(videoId) as { chunk_id: number; segment_id: number }[];
  const selected = new Set(segmentIds);
  if (segmentIds.some((id) => !mappings.some((m) => m.segment_id === id)))
    throw new Error(
      "Source segments lack chunk mappings; reopen the saved transcript after indexing",
    );
  const blocks = rows.filter((b) =>
    mappings.some((m) => m.chunk_id === b.id && selected.has(m.segment_id)),
  );
  return {
    videoId,
    target,
    transcriptHash: video.content_hash,
    language: video.language,
    blocks,
    mappings,
    key: sourceHash(
      JSON.stringify([
        videoId,
        video.content_hash,
        target,
        LOCAL_REVISION,
        LOCAL_VERSION,
        blocks.map((b) => b.id),
      ]),
    ),
  };
}
type Scope = ReturnType<typeof localScope>;
function cached(s: Scope, includeLegacy = true): Saved[] {
  return s.blocks.flatMap((block) => {
    let row = db
      .prepare(
        "SELECT text,provider,created_at createdAt FROM local_translation_blocks WHERE chunk_id=? AND transcript_hash=? AND source_hash=? AND target=? AND revision=? AND version=?",
      )
      .get(
        block.id,
        s.transcriptHash,
        sourceHash(block.text),
        s.target,
        LOCAL_REVISION,
        LOCAL_VERSION,
      ) as { text: string; provider: string; createdAt: string } | undefined;
    if (!row && includeLegacy) {
      const ids = s.mappings
        .filter((m) => m.chunk_id === block.id)
        .map((m) => m.segment_id);
      const legacy = db
        .prepare(
          "SELECT st.text,st.created_at FROM caption_segments cs JOIN segment_translations st ON st.segment_id=cs.id AND st.video_id=cs.video_id WHERE cs.id IN (SELECT value FROM json_each(?)) AND st.transcript_hash=? AND st.target=? AND st.version='translation-1' ORDER BY cs.ordinal",
        )
        .all(JSON.stringify(ids), s.transcriptHash, s.target) as {
        text: string;
        created_at: string;
      }[];
      if (legacy.length === ids.length) {
        try {
          const text = legacy.map((r) => r.text).join(" ");
          validateLocalBlocks(
            [{ id: block.id, text: block.text }],
            [{ id: block.id, text }],
          );
          row = {
            text,
            provider: "ollama-cache",
            createdAt: legacy[0].created_at,
          };
        } catch {
          /* Retain only validated, complete legacy blocks. */
        }
      }
    }
    return row
      ? [
          {
            ...row,
            chunkId: block.id,
            segmentIds: s.mappings
              .filter((m) => m.chunk_id === block.id)
              .map((m) => m.segment_id),
            startSeconds: block.start_seconds,
            endSeconds: block.end_seconds,
          },
        ]
      : [];
  });
}
function latestJob(key: string) {
  return (
    (db
      .prepare(
        "SELECT id,status,progress,error FROM jobs WHERE type='local_translate' AND json_extract(payload,'$.key')=? ORDER BY id DESC LIMIT 1",
      )
      .get(key) as
      | { id: number; status: string; progress: string; error: string | null }
      | undefined) || null
  );
}
export function translationQuality(target: "ur" | "en") {
  const r = db
    .prepare(
      "SELECT COUNT(DISTINCT r.chunk_id) reviewed,COUNT(DISTINCT v.source_id) channels,COALESCE(SUM(r.names*r.units*r.negation*r.meaning),0) passed FROM translation_reviews r JOIN chunks c ON c.id=r.chunk_id JOIN videos v ON v.id=c.video_id JOIN local_translation_blocks b ON b.chunk_id=r.chunk_id AND b.source_hash=r.source_hash AND b.target=r.target AND b.revision=r.revision AND b.version=r.version AND b.transcript_hash=v.content_hash WHERE r.target=? AND r.revision=? AND r.version=?",
    )
    .get(target, LOCAL_REVISION, LOCAL_VERSION) as {
    reviewed: number;
    channels: number;
    passed: number;
  };
  const rows = db
    .prepare(
      "SELECT r.source_kind,r.cases_json FROM translation_reviews r JOIN local_translation_blocks b ON b.chunk_id=r.chunk_id AND b.source_hash=r.source_hash AND b.target=r.target AND b.revision=r.revision AND b.version=r.version JOIN chunks c ON c.id=b.chunk_id JOIN videos v ON v.id=c.video_id WHERE b.transcript_hash=v.content_hash AND r.target=? AND r.revision=? AND r.version=?",
    )
    .all(target, LOCAL_REVISION, LOCAL_VERSION) as {
    source_kind: string | null;
    cases_json: string;
  }[];
  const kinds = new Set(rows.map((row) => row.source_kind));
  const cases = new Set(
    rows.flatMap((row) => {
      try {
        return JSON.parse(row.cases_json) as string[];
      } catch {
        return [];
      }
    }),
  );
  const coverageComplete =
    kinds.has("hindi") &&
    kinds.has("hindustani") &&
    [
      "code-mixing",
      "company-names",
      "financial-figures",
      "negation",
      "conditional",
    ].every((tag) => cases.has(tag));
  return {
    ...r,
    coverageComplete,
    validated:
      r.reviewed >= 30 &&
      r.channels >= 3 &&
      r.passed === r.reviewed &&
      coverageComplete,
  };
}
export function localState(s: Scope) {
  const blocks = cached(s),
    readiness = localReadiness();
  let reason = readiness.reason;
  try {
    for (const b of s.blocks) sourceLanguage(b.text, s.language);
  } catch (e) {
    reason = (e as Error).message;
  }
  return {
    blocks,
    total: s.blocks.length,
    complete: blocks.length === s.blocks.length,
    available: !reason,
    unavailableReason: reason,
    readiness,
    quality: translationQuality(s.target),
    job: latestJob(s.key),
  };
}
export function queueLocal(
  s: Scope,
  priority: "reading" | "new" | "archive" = "reading",
) {
  const state = localState(s);
  const indexed =
    s.target !== "en" ||
    s.blocks.every(
      (b) =>
        !!db
          .prepare("SELECT 1 FROM english_translation_search WHERE rowid=?")
          .get(b.id),
    );
  if (state.complete && indexed) return { job: null };
  const active = latestJob(s.key);
  if (active && ["queued", "running"].includes(active.status)) {
    if (priority === "reading")
      db.prepare(
        "UPDATE jobs SET payload=json_set(payload,'$.priority','reading') WHERE id=?",
      ).run(active.id);
    return { job: active.id };
  }
  if (!state.available && !state.complete)
    throw new Error(state.unavailableReason!);
  return {
    job: queue("local_translate", {
      videoId: s.videoId,
      target: s.target,
      chunkIds: s.blocks.map((b) => b.id),
      transcriptHash: s.transcriptHash,
      revision: LOCAL_REVISION,
      version: LOCAL_VERSION,
      key: s.key,
      priority,
    }),
  };
}
export async function localTranslationJob(
  input: unknown,
  progress: (s: string) => void,
  translate: typeof inferLocal = inferLocal,
) {
  const p = jobSchema.parse(input);
  const mappings = db
    .prepare(
      "SELECT cs.segment_id FROM chunk_segments cs JOIN chunks c ON c.id=cs.chunk_id WHERE c.video_id=? AND c.id IN (SELECT value FROM json_each(?))",
    )
    .all(p.videoId, JSON.stringify(p.chunkIds)) as { segment_id: number }[];
  const s = localScope(
    p.videoId,
    p.target,
    mappings.map((m) => m.segment_id),
  );
  if (
    s.transcriptHash !== p.transcriptHash ||
    s.key !== p.key ||
    s.blocks.length !== p.chunkIds.length
  )
    throw new Error(
      "Transcript or model version changed. Reopen the reader to request a fresh translation.",
    );
  const done = new Set(cached(s, false).map((b) => b.chunkId));
  for (const block of s.blocks) {
    if (done.has(block.id)) continue;
    const ids = s.mappings
      .filter((m) => m.chunk_id === block.id)
      .map((m) => m.segment_id);
    const old = db
      .prepare(
        "SELECT st.text FROM caption_segments cs JOIN segment_translations st ON st.segment_id=cs.id AND st.video_id=cs.video_id WHERE cs.id IN (SELECT value FROM json_each(?)) AND st.transcript_hash=? AND st.target=? AND st.version='translation-1' ORDER BY cs.ordinal",
      )
      .all(JSON.stringify(ids), s.transcriptHash, s.target) as {
      text: string;
    }[];
    const source =
      old.length === ids.length ? null : sourceLanguage(block.text, s.language);
    progress(
      `Translating saved blocks locally · ${done.size}/${s.blocks.length}`,
    );
    const provider = old.length === ids.length ? "ollama-cache" : "local";
    const batch: LocalBlock[] = [{ id: block.id, text: block.text }];
    const result = validateLocalBlocks(
      batch,
      old.length === ids.length
        ? [{ id: block.id, text: old.map((r) => r.text).join(" ") }]
        : source === s.target
          ? batch
          : await translate(source!, s.target, batch),
    );
    db.transaction(() => {
      const current = db
        .prepare(
          "SELECT v.content_hash,c.text FROM videos v JOIN chunks c ON c.video_id=v.id WHERE c.id=?",
        )
        .get(block.id) as { content_hash: string; text: string } | undefined;
      if (
        current?.content_hash !== s.transcriptHash ||
        current.text !== block.text
      )
        throw new Error(
          "Transcript changed during translation; original retained",
        );
      db.prepare(
        "INSERT OR REPLACE INTO local_translation_blocks(chunk_id,transcript_hash,source_hash,target,revision,version,text,provider,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        block.id,
        s.transcriptHash,
        sourceHash(block.text),
        s.target,
        LOCAL_REVISION,
        LOCAL_VERSION,
        result[0].text,
        provider,
        now(),
      );
      if (s.target === "en") {
        db.prepare("DELETE FROM english_translation_search WHERE rowid=?").run(
          block.id,
        );
        db.prepare(
          "INSERT INTO english_translation_search(rowid,text) VALUES(?,?)",
        ).run(block.id, normalize(result[0].text));
      }
    }).immediate();
    done.add(block.id);
  }
  return `Local translation completed · ${s.blocks.length} blocks · no cloud requests`;
}
export async function englishQuestion(
  question: string,
  translate: typeof inferLocal = inferLocal,
) {
  if (!/\p{Script=Arabic}/u.test(question))
    return { text: question, translated: false, reason: null };
  const key = sourceHash(
    JSON.stringify([normalize(question), LOCAL_REVISION, LOCAL_VERSION]),
  );
  const row = db
    .prepare("SELECT text FROM local_question_translations WHERE cache_key=?")
    .get(key) as { text: string } | undefined;
  if (row) return { text: row.text, translated: true, reason: null };
  try {
    if (!localReadiness().ready)
      throw new Error(
        "Local query translation unavailable; literal and alias retrieval used.",
      );
    const source = sourceLanguage(question, "ur");
    const input = [{ id: 1, text: question }];
    const result = validateLocalBlocks(
      input,
      await translate(source, "en", input, 15_000),
    );
    db.prepare(
      "INSERT OR REPLACE INTO local_question_translations VALUES(?,?,?)",
    ).run(key, result[0].text, now());
    return { text: result[0].text, translated: true, reason: null };
  } catch {
    return {
      text: question,
      translated: false,
      reason:
        "Local query translation unavailable; literal and alias retrieval used.",
    };
  }
}
