import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "psx-translations-"));
process.env.PSX_DB_PATH = join(temp, "research.sqlite");
delete process.env.OLLAMA_API_KEY;
delete process.env.OPENAI_API_KEY;
const { db, gate } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
const { queueTranslation, getTranslations } =
  await import("../lib/translations");
const { runJob } = await import("../lib/worker");
function fixture(
  id: string,
  text = "Do not buy FFC at 100.5. This is hypothetical.",
) {
  importTranscript({
    url: `https://www.youtube.com/watch?v=${id}`,
    title: "Synthetic translation fixture",
    speaker: "Fixture",
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
  ).map((s) => s.id);
}
const response = (value: unknown, finish = "stop") =>
  Response.json({
    choices: [
      {
        message: {
          content: typeof value === "string" ? value : JSON.stringify(value),
        },
        finish_reason: finish,
      },
    ],
  });
const input = (videoId: string, segmentIds?: number[]) => ({
  videoId,
  target: "ur",
  method: "ollama",
  ...(segmentIds ? { segmentIds } : {}),
});
async function run(id: number) {
  const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as {
    id: number;
    type: string;
    payload: string;
  };
  db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);
  try {
    await runJob(job);
    db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(id);
  } catch (e) {
    db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run(
      e instanceof Error ? e.message : String(e),
      id,
    );
    throw e;
  }
}
const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OLLAMA_API_KEY;
  db.prepare("UPDATE pipeline_state SET analysis_paused=NULL WHERE id=1").run();
});
test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});

test("translation requests require an explicit supported provider", () => {
  const missing = { videoId: "trans000001", target: "ur" };
  for (const request of [missing, { ...missing, method: "local" }]) {
    assert.throws(() => getTranslations(request), /method|option/i);
    assert.throws(() => queueTranslation(request), /method|option/i);
  }
});

test("requests validate saved source scope and reuse identical queued jobs", () => {
  const ids = fixture("trans000001"),
    other = fixture("trans000002");
  assert.throws(() =>
    queueTranslation({ ...input("trans000001"), target: "fr" }),
  );
  assert.throws(
    () => queueTranslation(input("trans000001", other)),
    /segment/i,
  );
  assert.throws(() => queueTranslation(input("trans000001", [ids[0], ids[0]])));
  assert.throws(() => queueTranslation(input("trans999999")), /transcript/i);
  assert.throws(() => queueTranslation(input("trans000001")), /OLLAMA_API_KEY/);
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  const first = queueTranslation(input("trans000001"));
  assert.ok(first.job);
  assert.equal(queueTranslation(input("trans000001", ids)).job, first.job);
  assert.equal(getTranslations(input("trans000001")).job?.status, "queued");
});

test("validated translations are saved without changing source records or review scores and read without keys", async () => {
  fixture("trans000003");
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  const before = {
    segments: db.prepare("SELECT * FROM caption_segments").all(),
    chunks: db.prepare("SELECT * FROM chunks").all(),
    gate: gate(),
  };
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tokens, 8192);
    const p = JSON.parse(body.messages[1].content);
    assert.equal(p.sourceLanguageHint, "hi");
    assert.equal(p.sourceTitle, "Synthetic translation fixture");
    assert.ok(!p.pieces[0].text.includes("100.5"));
    return response({
      translations: p.pieces.map((s: { id: string; text: string }) => ({
        id: s.id,
        text: s.text
          .replace("Do not buy FFC at ", "FFC کو ")
          .replace(
            ". This is hypothetical.",
            " پر نہ خریدیں۔ یہ فرضی مثال ہے۔",
          ),
      })),
    });
  };
  await run(queueTranslation(input("trans000003")).job!);
  assert.equal(calls, 1);
  delete process.env.OLLAMA_API_KEY;
  const saved = getTranslations(input("trans000003"));
  assert.equal(saved.translations.length, 1);
  assert.equal(saved.complete, true);
  assert.equal(saved.translations[0].model, "gemma4:31b");
  assert.equal(queueTranslation(input("trans000003")).job, null);
  assert.deepEqual(
    {
      segments: db.prepare("SELECT * FROM caption_segments").all(),
      chunks: db.prepare("SELECT * FROM chunks").all(),
      gate: gate(),
    },
    before,
  );
});

test("invalid mappings, omitted or altered numbers, malformed and truncated responses never enter the cache", async () => {
  fixture("trans000004");
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  for (const bad of [
    "missing",
    "duplicate",
    "unknown",
    "number",
    "omitted",
    "sign",
    "percentage",
    "digit-script",
    "repeated",
    "malformed",
    "truncated",
    "credential",
  ]) {
    globalThis.fetch = async (_url, init) => {
      const p = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      let rows = p.pieces.map((s: { id: string; text: string }) => ({
        id: s.id,
        text: s.text,
      }));
      if (bad === "missing") rows = [];
      if (bad === "duplicate") rows = [rows[0], rows[0]];
      if (bad === "unknown") rows[0].id = "unknown";
      if (bad === "number") rows[0].text = "Buy at 999.";
      if (bad === "omitted") rows[0].text = "Buy now.";
      if (bad === "sign") rows[0].text = "Do not buy at -100.5.";
      if (bad === "percentage") rows[0].text = "Do not buy at 100.5%.";
      if (bad === "digit-script") rows[0].text = "Do not buy at ١٠٠.٥.";
      if (bad === "repeated") rows[0].text = "Do not buy at 100.5 or 100.5.";
      if (bad === "credential") rows[0].text = "translation-fixture-key";
      return response(
        bad === "malformed" ? "{broken" : { translations: rows },
        bad === "truncated" ? "length" : "stop",
      );
    };
    await assert.rejects(
      run(queueTranslation(input("trans000004")).job!),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes("translation-fixture-key"));
        return true;
      },
    );
    assert.equal(
      getTranslations(input("trans000004")).translations.length,
      0,
      bad,
    );
  }
});

test("protected numbers restore exact notation and reject missing, duplicated, cross-piece or extra numbers", async () => {
  const text =
    "Do not invest ₹00 for 10 years. Preserve +1.50%, −٢,٣٤٥.٦٧٪ and १०.\n\nDo not buy at -12.50%.";
  fixture("trans000009", text);
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  for (const bad of ["missing", "duplicate", "cross-piece", "extra"]) {
    globalThis.fetch = async (_url, init) => {
      const p = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      const rows = p.pieces.map((s: { id: string; text: string }) => ({
        ...s,
      }));
      const marker = rows[0].text.match(/~[a-f\d]{6}:[a-z\d]+~/)![0];
      if (bad === "missing") rows[0].text = rows[0].text.replace(marker, "");
      if (bad === "duplicate") rows[0].text += marker;
      if (bad === "cross-piece")
        [rows[0].text, rows[1].text] = [rows[1].text, rows[0].text];
      if (bad === "extra") rows[0].text += " 999";
      return response({ translations: rows });
    };
    await assert.rejects(
      run(queueTranslation(input("trans000009")).job!),
      /num(?:ber|erical).*segment/i,
    );
    assert.equal(getTranslations(input("trans000009")).translations.length, 0);
  }
  globalThis.fetch = async (_url, init) => {
    const p = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    return response({ translations: p.pieces });
  };
  await run(queueTranslation(input("trans000009")).job!);
  assert.equal(
    getTranslations(input("trans000009"))
      .translations.map((s) => s.text)
      .join("\n\n"),
    text,
  );
});

test("dense numeric input stays within the provider context and restores every number", async () => {
  const ids = fixture("trans000010"),
    text = "1 ".repeat(4095) + "1";
  db.prepare("UPDATE caption_segments SET text=? WHERE id=?").run(text, ids[0]);
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  globalThis.fetch = async (_url, init) => {
    const content = JSON.parse(String(init?.body)).messages[1].content;
    assert.ok(Buffer.byteLength(content) < 70000);
    return response({ translations: JSON.parse(content).pieces });
  };
  await run(queueTranslation(input("trans000010")).job!);
  assert.equal(
    getTranslations(input("trans000010")).translations[0].text,
    text,
  );
});

test("partial progress survives failure and an overlapping retry only translates missing segments", async () => {
  const ids = fixture(
    "trans000005",
    Array.from({ length: 25 }, () => "Do not buy FFC at 100.5.").join("\n\n"),
  );
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 2)
      return Response.json(
        { error: { message: "provider unavailable" } },
        { status: 503 },
      );
    const p = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    assert.ok(p.pieces.length <= 20);
    return response({
      translations: p.pieces.map((s: { id: string; text: string }) => ({
        id: s.id,
        text: s.text,
      })),
    });
  };
  await assert.rejects(
    run(queueTranslation(input("trans000005")).job!),
    /provider unavailable/,
  );
  assert.equal(getTranslations(input("trans000005")).translations.length, 20);
  assert.equal(getTranslations(input("trans000005")).complete, false);
  calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const p = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    assert.deepEqual(
      p.pieces.map((s: { id: string }) => Number(s.id.split(":")[0])),
      ids.slice(20),
    );
    return response({
      translations: p.pieces.map((s: { id: string; text: string }) => ({
        id: s.id,
        text: s.text,
      })),
    });
  };
  await run(queueTranslation(input("trans000005", ids.slice(18))).job!);
  assert.equal(calls, 1);
  assert.equal(getTranslations(input("trans000005")).complete, true);
  assert.equal(queueTranslation(input("trans000005")).job, null);
});

test("long Unicode segments are split into bounded batches and cached only after reassembly", async () => {
  const ids = fixture("trans000006");
  const text = "😀 اردو متن ".repeat(1500) + " FFC 100.5%";
  db.prepare("UPDATE caption_segments SET text=? WHERE id=?").run(text, ids[0]);
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const p = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    assert.ok(p.pieces.length <= 20);
    assert.ok(
      p.pieces.reduce(
        (sum: number, s: { text: string }) => sum + Buffer.byteLength(s.text),
        0,
      ) <= 8192,
    );
    assert.ok(
      p.pieces.every(
        (s: { text: string }) =>
          Buffer.byteLength(s.text) <= 4096 && !s.text.includes("�"),
      ),
    );
    assert.equal(getTranslations(input("trans000006")).translations.length, 0);
    return response({
      translations: p.pieces.map((s: { id: string; text: string }) => ({
        id: s.id,
        text: s.text,
      })),
    });
  };
  await run(queueTranslation(input("trans000006")).job!);
  assert.ok(calls > 1);
  assert.equal(
    getTranslations(input("trans000006")).translations[0].text,
    text.trim(),
  );
});

test("hash and version changes invalidate translations and stale jobs cannot save output", async () => {
  fixture("trans000007");
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  globalThis.fetch = async (_url, init) => {
    const p = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    return response({
      translations: p.pieces.map((s: { id: string; text: string }) => ({
        id: s.id,
        text: s.text,
      })),
    });
  };
  await run(queueTranslation(input("trans000007")).job!);
  db.prepare(
    "UPDATE segment_translations SET version='old' WHERE video_id='trans000007'",
  ).run();
  assert.equal(getTranslations(input("trans000007")).translations.length, 0);
  const job = queueTranslation(input("trans000007")).job!;
  db.prepare(
    "UPDATE videos SET content_hash='replacement' WHERE id='trans000007'",
  ).run();
  await assert.rejects(run(job), /Transcript changed/);
  globalThis.fetch = async (_url, init) => {
    const p = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    db.prepare(
      "UPDATE videos SET content_hash='changed-during-request' WHERE id='trans000007'",
    ).run();
    return response({
      translations: p.pieces.map((s: { id: string; text: string }) => ({
        id: s.id,
        text: s.text,
      })),
    });
  };
  await assert.rejects(
    run(queueTranslation(input("trans000007")).job!),
    /Transcript changed/,
  );
  assert.equal(getTranslations(input("trans000007")).translations.length, 0);
});

test("quota pauses generation while cached translations remain available", async () => {
  fixture("trans000008");
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  globalThis.fetch = async () =>
    Response.json({ error: { message: "quota exhausted" } }, { status: 429 });
  await assert.rejects(
    run(queueTranslation(input("trans000008")).job!),
    /quota/,
  );
  assert.ok(
    (
      db
        .prepare("SELECT analysis_paused FROM pipeline_state WHERE id=1")
        .get() as { analysis_paused: string }
    ).analysis_paused,
  );
  assert.throws(() => queueTranslation(input("trans000008")), /paused/);
  assert.ok(getTranslations(input("trans000003")).complete);
});

test("translation API enforces localhost, same-origin JSON and exact source scope", async () => {
  const { NextRequest } = await import("next/server");
  const { GET, POST } = await import("../app/api/[...path]/route");
  const params = { params: Promise.resolve({ path: ["translations"] }) };
  const post = (data: unknown, extra: Record<string, string> = {}) =>
    POST(
      new NextRequest("http://127.0.0.1:3000/api/translations", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
          ...extra,
        },
        body: JSON.stringify(data),
      }),
      params,
    );
  assert.equal(
    (await post(input("trans000003"), { origin: "https://evil.test" })).status,
    400,
  );
  assert.equal(
    (await post(input("trans000003"), { host: "evil.test" })).status,
    400,
  );
  assert.equal(
    (await post(input("trans000003"), { "content-type": "text/plain" })).status,
    400,
  );
  assert.equal(
    (await post({ ...input("trans000003"), target: "fr" })).status,
    400,
  );
  for (const method of [undefined, "local"]) {
    const body = {
      videoId: "trans000003",
      target: "ur",
      ...(method ? { method } : {}),
    };
    assert.equal((await post(body)).status, 400);
    const query = `http://127.0.0.1:3000/api/translations?videoId=trans000003&target=ur${method ? `&method=${method}` : ""}`;
    assert.equal(
      (
        await GET(
          new NextRequest(query, { headers: { host: "127.0.0.1:3000" } }),
          params,
        )
      ).status,
      400,
    );
  }
  const foreign = (
    db
      .prepare("SELECT id FROM caption_segments WHERE video_id='trans000001'")
      .get() as { id: number }
  ).id;
  assert.equal((await post(input("trans000003", [foreign]))).status, 400);
  const cached = await post(input("trans000003"));
  assert.equal(cached.status, 200);
  assert.deepEqual(await cached.json(), { job: null });
  const get = await GET(
    new NextRequest(
      "http://127.0.0.1:3000/api/translations?videoId=trans000003&target=ur&method=ollama",
      { headers: { host: "127.0.0.1:3000" } },
    ),
    params,
  );
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("Cache-Control"), "no-store");
  assert.equal((await get.json()).complete, true);
  process.env.OLLAMA_API_KEY = "translation-fixture-key";
  assert.equal(
    (await post({ ...input("trans000003"), target: "en" })).status,
    202,
  );
  const video = await GET(
    new NextRequest("http://127.0.0.1:3000/api/video?id=trans000003", {
      headers: { host: "127.0.0.1:3000" },
    }),
    { params: Promise.resolve({ path: ["video"] }) },
  );
  const preview = await video.json();
  assert.ok(preview.chunks[0].segmentIds.includes(preview.segments[0].id));
});
