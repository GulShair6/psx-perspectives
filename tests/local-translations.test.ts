import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
const temp = mkdtempSync(join(tmpdir(), "psx-local-"));
process.env.PSX_DB_PATH = join(temp, "research.sqlite");
process.env.PSX_LOCAL_TRANSLATION_DIR = temp;
delete process.env.OLLAMA_API_KEY;
writeFileSync(
  join(temp, "installed.json"),
  readFileSync("local_translation/models.json"),
);
let runtime = createServer();
await new Promise<void>((resolve) =>
  runtime.listen(join(temp, "runtime.sock"), resolve),
);
const ready = () =>
  writeFileSync(
    join(temp, "runtime.json"),
    JSON.stringify({
      pid: process.pid,
      owner: "fixture",
      version: "local-2",
      heartbeat: Date.now(),
    }),
  );
ready();
const { db, gate } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
const { getTranslations, queueTranslation } =
  await import("../lib/translations");
const { localTranslationJob, translationQuality } =
  await import("../lib/local-translations");
const { claimJob } = await import("../lib/worker");
function fixture(id: string, text = "खरीदो मत 100. यह उदाहरण है।") {
  importTranscript({
    url: `https://www.youtube.com/watch?v=${id}`,
    title: "Local fixture",
    speaker: "Fixture",
    source_id: 2,
    published_at: "2026-10-01",
    language: "unknown",
    text,
  });
  db.prepare("UPDATE videos SET language='hi' WHERE id=?").run(id);
  return (
    db
      .prepare(
        "SELECT id FROM caption_segments WHERE video_id=? ORDER BY ordinal",
      )
      .all(id) as { id: number }[]
  ).map((r) => r.id);
}
function payload(id: number) {
  return JSON.parse(
    (
      db.prepare("SELECT payload FROM jobs WHERE id=?").get(id) as {
        payload: string;
      }
    ).payload,
  );
}
const p = (id: string, ids?: number[]) => ({
  videoId: id,
  target: "en",
  ...(ids ? { segmentIds: ids } : {}),
});
test.after(async () => {
  await new Promise<void>((resolve) => runtime.close(() => resolve()));
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
test("a passage job keeps its queued chunk scope despite overlapping neighbours", async () => {
  const text = Array.from(
    { length: 12 },
    (_, i) =>
      `${i + 1}\n00:${String(i).padStart(2, "0")}.000 --> 00:${String(i + 1).padStart(2, "0")}.000\nखरीदो मत ${i} ${"उदाहरण ".repeat(80)}`,
  ).join("\n\n");
  const ids = fixture("localover01", text);
  const id = queueTranslation(p("localover01", [ids[0]])).job!;
  const job = payload(id);
  assert.equal(job.chunkIds.length, 1);
  let calls = 0;
  await localTranslationJob(
    job,
    () => {},
    async (_source, _target, blocks) => {
      calls++;
      return blocks;
    },
  );
  assert.equal(calls, 1);
  await localTranslationJob(
    job,
    () => {},
    async () => {
      throw new Error("Cached block must not run again");
    },
  );
  await assert.rejects(
    localTranslationJob(
      { ...job, version: "local-1" },
      () => {},
      async () => {
        throw new Error("Obsolete job must not run");
      },
    ),
    /obsolete/,
  );
  db.prepare(
    "DELETE FROM english_translation_search WHERE rowid IN (SELECT id FROM chunks WHERE video_id='localover01')",
  ).run();
  await localTranslationJob(
    job,
    () => {},
    async () => {
      throw new Error("Index repair must reuse the saved block");
    },
  );
  assert.ok(
    db
      .prepare("SELECT 1 FROM english_translation_search WHERE rowid=?")
      .get(job.chunkIds[0]),
  );
  db.prepare("DELETE FROM english_translation_search WHERE rowid=?").run(
    job.chunkIds[0],
  );
  db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(id);
});
test("local is default, deduplicates scopes, rejects cross-video sources and works with cloud paused", async () => {
  const ids = fixture("local000001"),
    other = fixture("local000002");
  db.prepare(
    "UPDATE pipeline_state SET analysis_paused='quota' WHERE id=1",
  ).run();
  assert.equal(getTranslations(p("local000001")).method, "local");
  assert.throws(() => queueTranslation(p("local000001", other)), /segment/i);
  const first = queueTranslation(p("local000001")).job!;
  assert.equal(queueTranslation(p("local000001", ids)).job, first);
  assert.equal(claimJob()?.id, first);
  const before = {
    segments: db.prepare("SELECT * FROM caption_segments").all(),
    chunks: db.prepare("SELECT * FROM chunks").all(),
    gate: gate(),
  };
  let calls = 0;
  const translate = async (
    _source: string,
    _target: "ur" | "en",
    blocks: { id: number; text: string }[],
  ) => {
    calls++;
    return blocks.map((b) => ({
      id: b.id,
      text: "Do not buy 100. This is an example.",
    }));
  };
  await localTranslationJob(payload(first), () => {}, translate);
  assert.equal(calls, 1);
  assert.equal(getTranslations(p("local000001")).blocks.length, 1);
  assert.equal(queueTranslation(p("local000001")).job, null);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) n FROM english_translation_search").get() as {
        n: number;
      }
    ).n,
    1,
  );
  assert.deepEqual(
    {
      segments: db.prepare("SELECT * FROM caption_segments").all(),
      chunks: db.prepare("SELECT * FROM chunks").all(),
      gate: gate(),
    },
    before,
  );
  assert.equal(translationQuality("ur").validated, false);
});
test("partial completion survives interruption; retry skips saved blocks and detects transcript changes", async () => {
  fixture("local000003", ("खरीदो मत 100. ".repeat(65) + "\n\n").repeat(4));
  const id = queueTranslation(p("local000003")).job!,
    job = payload(id);
  assert.ok(job.chunkIds.length > 1);
  let calls = 0;
  const mock = async (
    _s: string,
    _t: "en" | "ur",
    blocks: { id: number; text: string }[],
  ) => {
    calls++;
    if (calls === 2) throw new Error("interrupted");
    return blocks;
  };
  await assert.rejects(
    localTranslationJob(job, () => {}, mock),
    /interrupted/,
  );
  assert.equal(getTranslations(p("local000003")).blocks.length, 1);
  calls = 0;
  await localTranslationJob(
    job,
    () => {},
    async (_s, _t, blocks) => {
      calls++;
      return blocks;
    },
  );
  assert.equal(calls, job.chunkIds.length - 1);
  db.prepare(
    "UPDATE videos SET content_hash='changed' WHERE id='local000003'",
  ).run();
  assert.equal(getTranslations(p("local000003")).blocks.length, 0);
  await assert.rejects(
    localTranslationJob(job, () => {}, mock),
    /changed/,
  );
});
test("invalid output never saves and cached blocks remain readable without runtime", async () => {
  fixture("local000004");
  const id = queueTranslation(p("local000004")).job!;
  await assert.rejects(
    localTranslationJob(
      payload(id),
      () => {},
      async () => [{ id: 999, text: "buy 200" }],
    ),
    /mapping/,
  );
  assert.equal(getTranslations(p("local000004")).blocks.length, 0);
  await new Promise<void>((resolve) => runtime.close(() => resolve()));
  assert.equal(getTranslations(p("local000001")).complete, true);
  assert.equal(getTranslations(p("local000004")).available, false);
  assert.throws(() => queueTranslation(p("local000002")), /runtime/i);
  runtime = createServer();
  await new Promise<void>((resolve) =>
    runtime.listen(join(temp, "runtime.sock"), resolve),
  );
  ready();
});

test("English derived search preserves channel, topic, time and original evidence identity", async () => {
  const { retrieveCandidates, literalPlan, assembleEvidence } =
    await import("../lib/rag");
  const { expertChatSchema } = await import("../lib/expert");
  const p = expertChatSchema.parse({
    question: "example",
    channelIds: [2],
    symbols: [],
    topics: [],
    since: "2026-10-01",
    until: "2026-10-13",
  });
  // The source caption has no English 'example' token.
  const plan = literalPlan(p),
    result = retrieveCandidates(p, plan);
  assert.equal(
    result.candidates.filter((c) => c.video_id === "local000001").length,
    1,
  );
  const evidence = assembleEvidence(
    p,
    plan,
    result.candidates.map((c) => c.id),
    [],
  ).evidence;
  assert.equal(evidence.filter((e) => e.video_id === "local000001").length, 1);
  assert.ok(
    evidence.find((e) => e.video_id === "local000001")?.text.includes("खरीदो"),
  );
  assert.equal(
    retrieveCandidates({ ...p, channelIds: [3] }, plan).candidates.length,
    0,
  );
  assert.equal(
    retrieveCandidates({ ...p, since: "2026-10-02" }, plan).candidates.length,
    0,
  );
  assert.equal(
    retrieveCandidates({ ...p, topics: ["cement"] }, plan).candidates.length,
    0,
  );
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
    const chunk = db
      .prepare(
        "SELECT c.id,c.text,v.content_hash FROM chunks c JOIN videos v ON v.id=c.video_id WHERE v.id='local000001' LIMIT 1",
      )
      .get() as { id: number; text: string; content_hash: string };
    const { LOCAL_REVISION, LOCAL_VERSION, sourceHash } =
      await import("../lib/local-runtime");
    db.prepare(
      "INSERT OR REPLACE INTO local_translation_blocks VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      chunk.id,
      chunk.content_hash,
      sourceHash(chunk.text),
      "ur",
      LOCAL_REVISION,
      LOCAL_VERSION,
      "اردو 100",
      "local",
      new Date().toISOString(),
    );
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
    db.prepare(
      "UPDATE local_translation_blocks SET transcript_hash='changed-relevant-source' WHERE chunk_id IN (SELECT id FROM chunks WHERE video_id=?)",
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

test("Urdu questions translate locally once, preserve numbers and fall back literally", async () => {
  const { englishQuestion } = await import("../lib/local-translations");
  let calls = 0;
  const mock = async () => {
    calls++;
    return [{ id: 1, text: "Do not buy at 100" }];
  };
  const question = "100 پر مت خریدیں";
  assert.equal(
    (await englishQuestion(question, mock)).text,
    "Do not buy at 100",
  );
  assert.equal((await englishQuestion(question, mock)).translated, true);
  assert.equal(calls, 1);
  const bad = await englishQuestion("200 پر مت خریدیں", async () => [
    { id: 1, text: "Buy at 300" },
  ]);
  assert.equal(bad.translated, false);
  assert.equal(bad.text, "200 پر مت خریدیں");
  rmSync(join(temp, "installed.json"));
  assert.equal((await englishQuestion(question, mock)).translated, true);
  assert.equal((await englishQuestion("یہ کیا ہے؟", mock)).translated, false);
  writeFileSync(
    join(temp, "installed.json"),
    readFileSync("local_translation/models.json"),
  );
});

test("archive preparation stays gated, new captions queue locally and reading takes priority", async () => {
  const { scheduleLocalPreparation, archiveReadiness } =
    await import("../lib/local-preparation");
  db.prepare("UPDATE jobs SET status='done'").run();
  db.prepare("UPDATE caption_segments SET retrieved_at='2000-01-01'").run();
  assert.equal(archiveReadiness(), false);
  scheduleLocalPreparation();
  assert.equal(
    db.prepare("SELECT 1 FROM jobs WHERE status='queued'").get(),
    undefined,
  );
  fixture("local000006");
  scheduleLocalPreparation();
  const background = db
    .prepare("SELECT id,payload FROM jobs WHERE status='queued'")
    .get() as { id: number; payload: string };
  assert.equal(JSON.parse(background.payload).priority, "new");
  const reading = queueTranslation({
    videoId: "local000002",
    target: "ur",
  }).job!;
  assert.equal(claimJob()?.id, reading);
  assert.equal(
    JSON.parse(
      (
        db
          .prepare("SELECT payload FROM jobs WHERE id=?")
          .get(background.id) as { payload: string }
      ).payload,
    ).target,
    "en",
  );
});

test("human trial import is additive, source-bound and never changes expert accuracy", async () => {
  const { spawnSync } = await import("node:child_process");
  const { sourceHash, LOCAL_REVISION, LOCAL_VERSION } =
    await import("../lib/local-runtime");
  const c = db
    .prepare("SELECT id,text FROM chunks WHERE video_id='local000001'")
    .get() as { id: number; text: string };
  const before = gate();
  const trial = [
    {
      chunkId: c.id,
      sourceHash: sourceHash(c.text),
      source: c.text,
      outputs: {
        en: {
          text: "Do not buy 100. This is an example.",
          revision: LOCAL_REVISION,
          version: LOCAL_VERSION,
        },
      },
      reviews: {
        en: {
          reviewer: "synthetic fixture only",
          audioChecked: true,
          sourceKind: "hindustani",
          cases: ["financial-figures", "negation"],
          names: true,
          units: true,
          negation: true,
          meaning: true,
        },
      },
    },
  ];
  writeFileSync(join(temp, "trial.json"), JSON.stringify(trial));
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/local-translation-check.ts",
        "import-reviews",
      ],
      { env: process.env, encoding: "utf8" },
    );
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(translationQuality("en").reviewed, 1);
  assert.equal(translationQuality("en").validated, false);
  assert.deepEqual(gate(), before);
  trial[0].sourceHash = "changed";
  writeFileSync(join(temp, "trial.json"), JSON.stringify(trial));
  assert.notEqual(run().status, 0);
  assert.equal(translationQuality("en").reviewed, 1);
});

test("compatible Ollama English blocks build the local search index without inference or keys", async () => {
  const ids = fixture("local000007");
  const hash = (
    db
      .prepare("SELECT content_hash FROM videos WHERE id='local000007'")
      .get() as { content_hash: string }
  ).content_hash;
  for (const id of ids)
    db.prepare(
      "INSERT INTO segment_translations VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      "local000007",
      hash,
      id,
      "en",
      "translation-1",
      "Do not buy 100. This is an example.",
      "Ollama Cloud",
      "saved fixture",
      new Date().toISOString(),
    );
  rmSync(join(temp, "installed.json"));
  assert.equal(getTranslations(p("local000007")).complete, true);
  assert.equal(
    getTranslations(p("local000007")).blocks[0].provider,
    "ollama-cache",
  );
  const job = queueTranslation(p("local000007")).job!;
  await localTranslationJob(
    payload(job),
    () => {},
    async () => {
      throw new Error("No inference expected");
    },
  );
  assert.ok(
    db
      .prepare("SELECT 1 FROM english_translation_search WHERE rowid=?")
      .get(payload(job).chunkIds[0]),
  );
  writeFileSync(
    join(temp, "installed.json"),
    readFileSync("local_translation/models.json"),
  );
});
