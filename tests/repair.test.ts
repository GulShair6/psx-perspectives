import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
const temp = mkdtempSync(join(tmpdir(), "psx-repair-"));
process.env.PSX_DB_PATH = join(temp, "db.sqlite");
delete process.env.OLLAMA_API_KEY;
const { db, now, queue } = await import("../lib/db");
const { importTranscript, recordReview } = await import("../lib/transcripts");
const { repairPlan, applyRepair } = await import("../lib/repair");
function fixture(id: string, text: string) {
  const input = {
    url: `https://youtu.be/${id}`,
    title: "Repair fixture",
    speaker: "Unknown",
    published_at: "2026-10-01",
    language: "unknown",
    text,
  };
  importTranscript(input);
  return {
    input,
    chunk: db
      .prepare("SELECT * FROM chunks WHERE video_id=?")
      .get(id) as import("../lib/expert").Chunk,
  };
}
test("repair quarantines only automatic invalid records and is idempotent", () => {
  const { chunk } = fixture(
    "repair00001",
    "FFC को buy नहीं करना चाहिए। Buy MCB at 100.",
  );
  const stmt = (status: string) =>
    Number(
      db
        .prepare(
          "INSERT INTO statements(video_id,chunk_id,quote,stance,action,rationale,attribution,status,created_at) VALUES(?,?,?,'bullish','buy','Outlook','channel',?,?)",
        )
        .run(chunk.video_id, chunk.id, chunk.text, status, now())
        .lastInsertRowid,
    );
  const automatic = stmt("unreviewed"),
    human = stmt("reviewed"),
    rejected = stmt("rejected");
  const p = db
    .prepare("SELECT id FROM passages WHERE video_id=?")
    .get(chunk.video_id) as { id: number };
  const opinion = Number(
    db
      .prepare(
        "INSERT INTO opinions(video_id,passage_id,symbol,speaker,stance,rationale,quote,extracted_symbol,extracted_stance) VALUES(?,?,'FFC','Unknown','bullish','Outlook','Buy MCB at 100.','FFC','bullish')",
      )
      .run(chunk.video_id, p.id).lastInsertRowid,
  );
  const before = db
    .prepare("SELECT * FROM statements WHERE id IN (?,?) ORDER BY id")
    .all(human, rejected);
  const plan = repairPlan();
  assert.ok(plan.statements.some((r) => r.id === automatic));
  assert.ok(plan.opinions.some((r) => r.id === opinion));
  assert.ok(plan.conflicts.some((r) => r.id === human));
  applyRepair(plan);
  assert.equal(
    (
      db.prepare("SELECT status FROM statements WHERE id=?").get(automatic) as {
        status: string;
      }
    ).status,
    "quarantined",
  );
  assert.ok(
    db
      .prepare(
        "SELECT original_payload FROM opinion_quarantine WHERE opinion_id=?",
      )
      .get(opinion),
  );
  assert.deepEqual(
    db
      .prepare("SELECT * FROM statements WHERE id IN (?,?) ORDER BY id")
      .all(human, rejected),
    before,
  );
  assert.equal(repairPlan().statements.length, 0);
  assert.equal(repairPlan().opinions.length, 0);
  recordReview({
    id: opinion,
    symbol: "MCB",
    speaker: "Unknown",
    stance: "bullish",
    rationale: "Human correction",
    target: null,
    horizon: null,
    hypothetical: false,
    status: "approved",
    evaluate: false,
    expected_symbol: "MCB",
    expected_stance: "bullish",
  });
  assert.ok(
    db
      .prepare(
        "SELECT original_payload FROM opinion_quarantine WHERE opinion_id=?",
      )
      .get(opinion),
    "Human correction must retain the quarantined provider payload",
  );
});
test("recoverable imports rebuild indexes atomically without queueing paid work", () => {
  const raw = "1\n00:00:01,000 --> 00:00:03,000\nFFC target\n100";
  const { input, chunk } = fixture("repair00002", raw);
  queue("import", input);
  db.prepare(
    "UPDATE caption_segments SET text='FFC target' WHERE video_id=?",
  ).run(chunk.video_id);
  db.prepare("UPDATE passages SET text='FFC target' WHERE video_id=?").run(
    chunk.video_id,
  );
  db.prepare(
    "UPDATE chunks SET text='FFC target',searchable='ffc target' WHERE video_id=?",
  ).run(chunk.video_id);
  const plan = repairPlan();
  assert.equal(plan.imports.length, 1);
  const before = db
    .prepare("SELECT * FROM caption_segments WHERE video_id=?")
    .all(chunk.video_id);
  db.exec(
    "CREATE TEMP TRIGGER interrupt_repair BEFORE INSERT ON caption_segments BEGIN SELECT RAISE(ABORT,'simulated interruption'); END",
  );
  assert.throws(() => applyRepair(plan), /simulated interruption/);
  assert.deepEqual(
    db
      .prepare("SELECT * FROM caption_segments WHERE video_id=?")
      .all(chunk.video_id),
    before,
  );
  db.exec("DROP TRIGGER interrupt_repair");
  applyRepair(plan);
  assert.ok(
    db
      .prepare("SELECT 1 FROM chunk_search WHERE chunk_search MATCH '100'")
      .get(),
  );
  assert.equal(
    (
      db
        .prepare("SELECT text FROM caption_segments WHERE video_id=?")
        .get(chunk.video_id) as { text: string }
    ).text,
    "FFC target 100",
  );
  assert.equal(repairPlan().imports.length, 0);
  assert.equal(importTranscript(input).duplicate, true);
  db.prepare(
    "INSERT INTO chunk_search(chunk_search,rank) VALUES('integrity-check',1)",
  ).run();
  db.prepare(
    "INSERT INTO passage_search(passage_search,rank) VALUES('integrity-check',1)",
  ).run();
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) n FROM jobs WHERE type IN ('insights','extract') AND status='queued'",
        )
        .get() as { n: number }
    ).n,
    0,
  );
  assert.equal(
    (
      db
        .prepare("SELECT status FROM analysis_runs WHERE video_id=?")
        .get(chunk.video_id) as { status: string }
    ).status,
    "failed",
  );
});
test("missing raw input and human-reviewed imports remain unchanged", () => {
  const { input, chunk } = fixture(
    "repair00003",
    "FFC original caption for a human review.",
  );
  queue("import", input);
  db.prepare(
    "UPDATE caption_segments SET text='Old source' WHERE video_id=?",
  ).run(chunk.video_id);
  db.prepare(
    "INSERT INTO statements(video_id,chunk_id,quote,stance,rationale,attribution,status,created_at) VALUES(?,?,?,'neutral','','channel','reviewed',?)",
  ).run(chunk.video_id, chunk.id, chunk.text, now());
  fixture("repair00004", "FFC caption without any retained raw input.");
  const plan = repairPlan();
  assert.ok(plan.missingRaw.includes("repair00004"));
  assert.ok(
    plan.conflicts.some((r) => r.kind === "import" && r.id === chunk.video_id),
  );
  assert.equal(plan.imports.length, 0);
});
test("maintenance preview is read-only; apply saves a restorable backup and report", () => {
  const report = join(temp, "report.json");
  const run = (apply = false) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/repair.ts",
        "--report",
        report,
        ...(apply ? ["--apply"] : []),
      ],
      { env: process.env, encoding: "utf8", timeout: 20000 },
    );
  const before = db.prepare("SELECT * FROM statements ORDER BY id").all();
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    db.prepare("SELECT * FROM statements ORDER BY id").all(),
    before,
  );
  result = run(true);
  assert.equal(result.status, 0, result.stderr);
  const saved = JSON.parse(readFileSync(report, "utf8"));
  assert.ok(saved.backup);
  const restored = new Database(saved.backup, { readonly: true });
  assert.deepEqual(
    restored.prepare("SELECT * FROM statements ORDER BY id").all(),
    before,
  );
  assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
  restored.close();
});
test("repair refuses to overwrite a database or an unrelated human file", () => {
  const path = join(temp, "human-reviews.json");
  writeFileSync(path, '{"humanReview":true}');
  for (const report of [process.env.PSX_DB_PATH!, path]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/repair.ts", "--report", report],
      { env: process.env, encoding: "utf8", timeout: 10000 },
    );
    assert.notEqual(result.status, 0);
  }
  assert.equal(readFileSync(path, "utf8"), '{"humanReview":true}');
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
});
test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
