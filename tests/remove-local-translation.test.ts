import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
const temp = mkdtempSync(join(tmpdir(), "psx-retired-translation-"));
process.env.PSX_DB_PATH = join(temp, "research.sqlite");
const { db, now, queue } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
const { runJob } = await import("../lib/worker");
const { retrieveCandidates, literalPlan } = await import("../lib/rag");
const { expertChatSchema } = await import("../lib/expert");

test("retired translation jobs cannot execute or be retried", async () => {
  const id = queue("local_translate", {});
  db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(id);
  await assert.rejects(
    runJob({ id, type: "local_translate", payload: "{}" }),
    /Local model translation has been removed/,
  );
  const { POST } = await import("../app/api/[...path]/route");
  const { NextRequest } = await import("next/server");
  const response = await POST(
    new NextRequest("http://127.0.0.1:3000/api/retry", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ id }),
    }),
    { params: Promise.resolve({ path: ["retry"] }) },
  );
  assert.equal(response.status, 400);
  assert.match(
    (await response.json()).error,
    /Local model translation has been removed/,
  );
});

test("upgrade retires pending local jobs while preserving research and translation records", () => {
  importTranscript({
    url: "https://youtu.be/retired0001",
    title: "Upgrade fixture",
    speaker: "Fixture",
    source_id: 2,
    published_at: "2026-10-01",
    language: "unknown",
    text: "Original passage without the translated search terms.",
  });
  const chunk = db
    .prepare(
      "SELECT c.id,v.content_hash FROM chunks c JOIN videos v ON v.id=c.video_id WHERE v.id='retired0001'",
    )
    .get() as { id: number; content_hash: string };
  db.prepare(
    "INSERT INTO local_translation_blocks VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    chunk.id,
    chunk.content_hash,
    "source",
    "en",
    "legacy",
    "local-2",
    "phantomneedle FFC",
    "local",
    now(),
  );
  db.prepare(
    "INSERT INTO translation_reviews(chunk_id,source_hash,target,revision,version,reviewer,audio_checked,names,units,negation,meaning,reviewed_at) VALUES(?,?,'en','legacy','local-2','Human',1,1,1,1,1,?)",
  ).run(chunk.id, "source", now());
  db.prepare(
    "INSERT INTO english_translation_search(rowid,text) VALUES(?,?)",
  ).run(chunk.id, "phantomneedle FFC");
  db.prepare(
    "INSERT INTO local_question_translations VALUES('legacy','phantomneedle',?)",
  ).run(now());
  const segment = db
    .prepare("SELECT id FROM caption_segments WHERE video_id='retired0001'")
    .get() as { id: number };
  db.prepare(
    "INSERT INTO segment_translations VALUES('retired0001',?,?,'ur','translation-1','Saved cloud text','Ollama Cloud','fixture',?)",
  ).run(chunk.content_hash, segment.id, now());
  db.prepare(
    "INSERT INTO youtube_caption_tracks VALUES('retired0001',?,'ur','youtube-captions-1','en','Creator captions','[]',?)",
  ).run(chunk.content_hash, now());
  // The retired index is not needed even when an existing database still contains it.
  db.exec("DROP TABLE english_translation_search");
  const p = expertChatSchema.parse({
    question: "FFC phantomneedle",
    symbols: ["FFC"],
    channelIds: [2],
    since: "2026-10-01",
    until: "2026-10-02",
  });
  assert.equal(retrieveCandidates(p, literalPlan(p)).candidates.length, 0);
  db.exec(
    "CREATE VIRTUAL TABLE english_translation_search USING fts5(text,tokenize='unicode61')",
  );
  db.prepare(
    "INSERT INTO english_translation_search(rowid,text) VALUES(?,?)",
  ).run(chunk.id, "phantomneedle FFC");
  const statuses = ["queued", "running", "done", "failed"];
  const localJobs = statuses.map((status) => {
    const id = queue("local_translate", {});
    db.prepare("UPDATE jobs SET status=? WHERE id=?").run(status, id);
    return id;
  });
  const cloud = queue("translate", {});
  const tables = [
    "videos",
    "caption_segments",
    "chunks",
    "local_translation_blocks",
    "translation_reviews",
    "local_question_translations",
    "segment_translations",
    "youtube_caption_tracks",
  ];
  const before = tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all());
  db.prepare(
    "DELETE FROM migrations WHERE name='013_remove_local_translation.sql'",
  ).run();
  db.close();
  const upgrade = () =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `const {db}=await import(${JSON.stringify(resolve("lib/db.ts"))});db.close();`,
      ],
      { env: process.env, encoding: "utf8", timeout: 15000 },
    );
  const result = upgrade();
  assert.equal(result.status, 0, result.stderr);
  const check = new Database(process.env.PSX_DB_PATH!);
  assert.deepEqual(
    tables.map((t) => check.prepare(`SELECT * FROM ${t}`).all()),
    before,
  );
  for (const [i, id] of localJobs.entries()) {
    const row = check
      .prepare("SELECT status,error FROM jobs WHERE id=?")
      .get(id) as { status: string; error: string | null };
    assert.equal(row.status, i < 2 ? "failed" : statuses[i]);
    if (i < 2)
      assert.equal(row.error, "Local model translation has been removed.");
  }
  assert.equal(
    (
      check.prepare("SELECT status FROM jobs WHERE id=?").get(cloud) as {
        status: string;
      }
    ).status,
    "queued",
  );
  const jobs = check.prepare("SELECT * FROM jobs").all();
  check.close();
  const again = upgrade();
  assert.equal(again.status, 0, again.stderr);
  const repeated = new Database(process.env.PSX_DB_PATH!);
  assert.deepEqual(repeated.prepare("SELECT * FROM jobs").all(), jobs);
  repeated.close();
});
test.after(() => rmSync(temp, { recursive: true, force: true }));
