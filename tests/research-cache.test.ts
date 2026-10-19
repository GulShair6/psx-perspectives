import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "psx-research-cache-"));
process.env.PSX_DB_PATH = join(temp, "research.sqlite");
const { db } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
for (const [id, source] of [
  ["local000001", 2],
  ["local000002", 3],
] as const)
  importTranscript({
    url: `https://youtu.be/${id}`,
    title: "Cache fixture",
    speaker: "Fixture",
    source_id: source,
    published_at: "2026-10-01",
    language: "unknown",
    text: "Example: खरीदो मत 100. यह उदाहरण है।",
  });
test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
test("validated answers use one cloud call, reuse cache and invalidate with source/review changes", async () => {
  const { expertResearch, expertChatSchema } = await import("../lib/expert");
  const p = expertChatSchema.parse({
    question: "example",
    channelIds: [2],
    symbols: [],
    since: "2026-10-01",
    until: "2026-10-13",
  });
  const original = globalThis.fetch;
  process.env.OLLAMA_API_KEY = "one-call-fixture";
  db.prepare("UPDATE pipeline_state SET analysis_paused=NULL WHERE id=1").run();
  let calls = 0;
  globalThis.fetch = async (_u, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.ok(body.messages[0].content.startsWith("Answer only"));
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              whatWasSaid: [],
              changes: [],
              disagreements: [],
              interpretation: "Read the supplied evidence.",
              gaps: [],
            }),
          },
          finish_reason: "stop",
        },
      ],
    });
  };
  try {
    const a = await expertResearch(p);
    assert.equal(calls, 1);
    assert.equal(a.processing.cloudRequests, 1);
    const b = await expertResearch(p);
    assert.equal(calls, 1);
    assert.equal(b.processing.cacheHit, true);
    assert.deepEqual(a.evidence, b.evidence);
    db.prepare(
      "INSERT INTO local_question_translations VALUES('unused','obsolete derived text',?)",
    ).run(new Date().toISOString());
    assert.equal((await expertResearch(p)).processing.cacheHit, true);
    assert.equal(calls, 1);
    db.prepare(
      "UPDATE videos SET content_hash='new-answer-source' WHERE id='local000002'",
    ).run();
    await expertResearch(p);
    assert.equal(
      calls,
      1,
      "An unrelated source does not invalidate the answer",
    );
    const relevant = a.evidence.find((e) => e.video_id)?.video_id;
    assert.ok(relevant);
    db.prepare(
      "UPDATE videos SET content_hash='changed-relevant-source' WHERE id=?",
    ).run(relevant);
    await expertResearch(p);
    assert.equal(calls, 2);
    const c = db
      .prepare("SELECT id FROM chunks WHERE video_id='local000001'")
      .get() as { id: number };
    const st = db
      .prepare(
        "INSERT INTO statements(video_id,chunk_id,quote,stance,rationale,attribution,status,created_at) VALUES('local000001',?,?,'neutral','review','channel','reviewed',?)",
      )
      .run(c.id, "खरीदो मत 100.", new Date().toISOString()).lastInsertRowid;
    db.prepare("INSERT INTO statement_evaluations VALUES(?,1,?)").run(
      st,
      new Date().toISOString(),
    );
    await expertResearch(p);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
    delete process.env.OLLAMA_API_KEY;
  }
});
