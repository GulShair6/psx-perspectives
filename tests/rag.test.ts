import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const temp = mkdtempSync(join(tmpdir(), "psx-rag-"));
process.env.PSX_DB_PATH = join(temp, "db.sqlite");
delete process.env.OLLAMA_API_KEY;
const { db, now } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
const { expertChatSchema } = await import("../lib/expert");
const { literalPlan, retrieveCandidates, assembleEvidence } =
  await import("../lib/rag");
const fixture = (id: string, text: string, source = 2, date = "2026-10-01") =>
  importTranscript({
    url: `https://www.youtube.com/watch?v=${id}`,
    title: "Research fixture",
    speaker: "Unknown",
    source_id: source,
    published_at: date,
    language: "mixed",
    text,
  });
const request = (extra: Record<string, unknown> = {}) =>
  expertChatSchema.parse({
    question: "FFC outlook",
    channelIds: [2, 3],
    symbols: ["FFC"],
    since: "2026-04-01",
    until: "2026-10-13",
    ...extra,
  });
const statement = (
  video: string,
  symbol: string,
  topic = "dividend",
  version = "legacy",
  status = "unreviewed",
) => {
  const c = db
    .prepare("SELECT id,text FROM chunks WHERE video_id=? LIMIT 1")
    .get(video) as {
    id: number;
    text: string;
  };
  const hash = (
    db.prepare("SELECT content_hash FROM videos WHERE id=?").get(video) as {
      content_hash: string;
    }
  ).content_hash;
  const id = Number(
    db
      .prepare(
        "INSERT INTO statements(video_id,chunk_id,quote,stance,rationale,attribution,status,created_at,analysis_version,transcript_hash) VALUES(?,?,?,'neutral','source','channel',?,?,?,?)",
      )
      .run(video, c.id, c.text, status, now(), version, hash).lastInsertRowid,
  );
  db.prepare("INSERT INTO statement_stocks VALUES(?,?)").run(id, symbol);
  db.prepare("INSERT INTO statement_topics VALUES(?,?)").run(id, topic);
  return id;
};
test("structured retrieval filters stocks before limits and preserves chronological channel evidence", async () => {
  fixture(
    "ragtest0001",
    "FFC outlook earlier dividend discussion.",
    2,
    "2026-04-15",
  );
  fixture(
    "ragtest0002",
    "FFC outlook later dividend discussion.",
    2,
    "2026-10-01",
  );
  fixture("ragtest0003", "FFC outlook from another channel.", 3, "2026-10-02");
  fixture("ragtest0004", "MCB market discussion.", 2, "2026-10-03");
  statement("ragtest0001", "FFC");
  statement("ragtest0002", "FFC");
  statement("ragtest0003", "FFC");
  for (let i = 0; i < 510; i++) statement("ragtest0004", "MCB");
  const p = request({ question: "How did the FFC outlook change?" });
  const plan = literalPlan(p);
  const result = retrieveCandidates(p, plan);
  assert.ok(result.candidates.some((c) => c.video_id === "ragtest0001"));
  assert.ok(result.candidates.some((c) => c.video_id === "ragtest0002"));
  assert.ok(result.candidates.every((c) => c.video_id !== "ragtest0004"));
  assert.ok(result.required.length >= 2);
  const only = request({
    channelIds: [3],
    since: "2026-10-02",
    until: "2026-10-02",
  });
  assert.ok(
    retrieveCandidates(only, literalPlan(only)).candidates.every(
      (c) => c.video_id === "ragtest0003",
    ),
  );
});
test("overview retrieves stocks without lexical query matches; explicit topic filters remain strict", async () => {
  const p = request({ question: "Give a market overview", symbols: [] });
  const result = retrieveCandidates(p, literalPlan(p));
  assert.ok(result.candidates.some((c) => c.video_id === "ragtest0004"));
  const filtered = request({ topics: ["cement"] });
  assert.equal(
    retrieveCandidates(filtered, literalPlan(filtered)).candidates.length,
    0,
  );
});
test("new completed extraction replaces automatic legacy rows while reviewed and rejected decisions survive", async () => {
  fixture("ragtest0005", "FFC conditional risk statement.");
  const legacy = statement("ragtest0005", "FFC");
  const current = statement("ragtest0005", "FFC", "risk", "expert-2");
  db.prepare(
    "UPDATE statements SET rationale='Legacy perspective' WHERE id=?",
  ).run(legacy);
  db.prepare(
    "UPDATE statements SET rationale='Revised perspective' WHERE id=?",
  ).run(current);
  const c = db
    .prepare("SELECT id FROM chunks WHERE video_id='ragtest0005'")
    .get() as {
    id: number;
  };
  const p = request();
  const plan = literalPlan(p);
  let evidence = assembleEvidence(p, plan, [c.id], []).evidence;
  assert.ok(evidence.some((e) => e.id === `chunk:${c.id}`));
  assert.ok(
    evidence.some((e) =>
      e.statements?.some((s) => s.rationale === "Legacy perspective"),
    ),
  );
  assert.ok(
    !evidence.some((e) =>
      e.statements?.some((s) => s.rationale === "Revised perspective"),
    ),
  );
  const hash = (
    db
      .prepare("SELECT content_hash FROM videos WHERE id='ragtest0005'")
      .get() as {
      content_hash: string;
    }
  ).content_hash;
  db.prepare(
    "INSERT INTO analysis_runs(video_id,transcript_hash,version,status,updated_at) VALUES(?,?,'expert-2','done',?)",
  ).run("ragtest0005", hash, now());
  evidence = assembleEvidence(p, plan, [c.id], []).evidence;
  assert.ok(
    evidence.some((e) =>
      e.statements?.some((s) => s.rationale === "Revised perspective"),
    ),
  );
  assert.ok(
    !evidence.some((e) =>
      e.statements?.some((s) => s.rationale === "Legacy perspective"),
    ),
  );
  db.prepare(
    "UPDATE statements SET status='rejected',quote='FFC conditional risk' WHERE id=?",
  ).run(legacy);
  evidence = assembleEvidence(p, plan, [c.id], []).evidence;
  assert.ok(!evidence.some((e) => e.id === `statement:${current}`));
  assert.equal(
    (
      db.prepare("SELECT status FROM statements WHERE id=?").get(legacy) as {
        status: string;
      }
    ).status,
    "rejected",
  );
  db.prepare("UPDATE statements SET status='reviewed' WHERE id=?").run(legacy);
  evidence = assembleEvidence(p, plan, [c.id], []).evidence;
  assert.ok(
    evidence.some((e) =>
      e.statements?.some((s) => s.rationale === "Legacy perspective"),
    ),
  );
  assert.ok(
    !evidence.some((e) =>
      e.statements?.some((s) => s.rationale === "Revised perspective"),
    ),
  );
});
test("evidence is bounded, deduplicated and includes required pairs before optional context", async () => {
  const p = request({ question: "How did FFC change?" });
  const plan = literalPlan(p);
  const pool = retrieveCandidates(p, plan);
  const assembled = assembleEvidence(
    p,
    plan,
    pool.candidates.map((c) => c.id),
    pool.required,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(assembled.evidence)) <= 50000);
  assert.ok(
    pool.required.every((id) =>
      assembled.evidence.some((e) => e.id === `chunk:${id}`),
    ),
  );
  assert.ok(
    assembled.evidence
      .filter((e) => e.id.startsWith("chunk:"))
      .every(
        (e) =>
          e.text ===
          (
            db
              .prepare("SELECT text FROM chunks WHERE id=?")
              .get(Number(e.id.split(":")[1])) as { text: string }
          ).text,
      ),
  );
  assert.equal(
    new Set(assembled.evidence.map((e) => e.id)).size,
    assembled.evidence.length,
  );
});
test("approved opinions retain their correction without replacing the original caption text", async () => {
  const text =
    "Known expert discusses FFC with a positive outlook and significant risks.";
  fixture("ragtest0006", text);
  const automatic = statement("ragtest0006", "FFC");
  db.prepare("UPDATE statements SET stance='bullish' WHERE id=?").run(
    automatic,
  );
  const passage = db
    .prepare("SELECT id FROM passages WHERE video_id='ragtest0006'")
    .get() as { id: number };
  db.prepare(
    "INSERT INTO opinions(video_id,passage_id,symbol,speaker,stance,rationale,quote,status,extracted_symbol,extracted_stance) VALUES('ragtest0006',?,'FFC','Known expert','neutral','Human interpretation',?,'approved','FFC','bullish')",
  ).run(passage.id, text);
  const chunk = db
    .prepare("SELECT id FROM chunks WHERE video_id='ragtest0006'")
    .get() as { id: number };
  const p = request();
  const plan = literalPlan(p);
  const evidence = assembleEvidence(p, plan, [chunk.id], []).evidence;
  const parent = evidence.find((e) => e.id === `chunk:${chunk.id}`)!;
  assert.equal(parent.text, text);
  assert.ok(
    parent.statements?.some(
      (s) =>
        s.review === "reviewed" &&
        s.stance === "neutral" &&
        s.symbols.includes("FFC"),
    ),
  );
  assert.ok(
    !parent.statements?.some(
      (s) => s.review !== "reviewed" && s.symbols.includes("FFC"),
    ),
  );
  assert.equal(evidence.filter((e) => e.text.includes(text)).length, 1);
});
test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
