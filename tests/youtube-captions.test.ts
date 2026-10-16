import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const temp = mkdtempSync(join(tmpdir(), "psx-youtube-captions-"));
process.env.PSX_DB_PATH = join(temp, "research.sqlite");
delete process.env.OLLAMA_API_KEY;
delete process.env.OPENAI_API_KEY;
const { db, gate } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
const { youtubeCaptions, captions } = await import("../lib/youtube-captions");
const { queueTranslation, getTranslations } =
  await import("../lib/translations");
const { runJob } = await import("../lib/worker");
type Track = {
  languageCode: string;
  kind?: string;
  isTranslatable?: boolean;
  baseUrl: string;
};
const track = (
  languageCode: string,
  kind?: string,
  isTranslatable = false,
): Track => ({
  languageCode,
  kind,
  isTranslatable,
  baseUrl: `https://www.youtube.com/api/timedtext?track=${languageCode}-${kind || "manual"}`,
});
const originalFetch = globalThis.fetch;
const requests: URL[] = [];
function mock(
  tracks: Track[],
  body = '<transcript><text start="1.5" dur="2">Do not buy at 100.</text><text start="4" dur="2">Keep 200.</text></transcript>',
  languages?: string[],
) {
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    requests.push(u);
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    if (u.pathname === "/youtubei/v1/player")
      return Response.json({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: tracks,
            ...(languages
              ? {
                  translationLanguages: languages.map((languageCode) => ({
                    languageCode,
                  })),
                }
              : {}),
          },
        },
      });
    assert.equal(u.pathname, "/api/timedtext");
    return new Response(body);
  };
}
function fixture(id: string) {
  importTranscript({
    url: `https://www.youtube.com/watch?v=${id}`,
    title: "Caption fixture",
    speaker: "Fixture",
    published_at: "2026-10-01",
    language: "unknown",
    text: "Do not buy at 100.\n\nKeep 200.",
  });
  db.prepare("UPDATE videos SET language='hi' WHERE id=?").run(id);
  const ids = (
    db
      .prepare(
        "SELECT id FROM caption_segments WHERE video_id=? ORDER BY ordinal",
      )
      .all(id) as { id: number }[]
  ).map((s) => s.id);
  ids.forEach((id, i) =>
    db
      .prepare(
        "UPDATE caption_segments SET start_seconds=?,end_seconds=? WHERE id=?",
      )
      .run(i * 3 + 1, i * 3 + 3, id),
  );
  return ids;
}
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
      (e as Error).message,
      id,
    );
    throw e;
  }
}
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  requests.length = 0;
  db.prepare("UPDATE pipeline_state SET analysis_paused=NULL WHERE id=1").run();
});
test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});

test("original ingestion retains its existing metadata fallback", async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    const u = new URL(String(input));
    if (u.pathname === "/youtubei/v1/player")
      return new Response("unavailable", { status: 503 });
    if (u.pathname === "/watch")
      return new Response(
        `var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: { status: "OK" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [track("ur")] } } })};`,
      );
    return new Response(
      '<transcript><text start="1" dur="2">Original captions</text></transcript>',
    );
  };
  const rows = await captions("ytcaption01");
  assert.equal(rows[0].text, "Original captions");
  assert.equal(rows[0].lang, "ur");
  assert.equal(calls, 3);
});

test("target creator captions outrank automatic tracks; automatic target outranks translation", async () => {
  mock([track("hi", undefined, true), track("ur", "asr"), track("ur")]);
  const manual = await youtubeCaptions("ytcaption01", "ur", "hi");
  assert.equal(manual.provenance, "YouTube creator-supplied captions");
  assert.equal(manual.cues[0].startSeconds, 1.5);
  assert.equal(requests.at(-1)!.searchParams.get("track"), "ur-manual");
  assert.equal(requests.at(-1)!.searchParams.has("tlang"), false);
  mock([track("hi", undefined, true), track("en", "asr")]);
  assert.equal(
    (await youtubeCaptions("ytcaption01", "en", "hi")).provenance,
    "YouTube automatic captions",
  );
  assert.equal(requests.at(-1)!.searchParams.get("track"), "en-asr");
});

test("auto-translation uses an eligible hinted source and preserves millisecond cue timing", async () => {
  mock(
    [track("fr", undefined, true), track("hi", "asr", true)],
    '<timedtext><p t="1500" d="2250"><s>خریدیں نہیں 100</s></p></timedtext>',
    ["ur", "en"],
  );
  const result = await youtubeCaptions("ytcaption01", "ur", "hi");
  assert.equal(result.provenance, "YouTube auto-translation");
  assert.equal(result.sourceLanguage, "hi");
  assert.deepEqual(result.cues, [
    { id: 0, text: "خریدیں نہیں 100", startSeconds: 1.5, endSeconds: 3.75 },
  ]);
  assert.equal(requests.at(-1)!.searchParams.get("track"), "hi-asr");
  assert.equal(requests.at(-1)!.searchParams.get("tlang"), "ur");
});

test("unsupported translation, empty or invalid captions are rejected without retry loops", async () => {
  mock([track("hi")]);
  await assert.rejects(
    youtubeCaptions("ytcaption01", "ur", "hi"),
    /translatable/,
  );
  assert.equal(requests.length, 1);
  requests.length = 0;
  mock([track("hi", undefined, true)], undefined, ["en"]);
  await assert.rejects(youtubeCaptions("ytcaption01", "ur", "hi"), /language/);
  assert.equal(requests.length, 1);
  for (const body of [
    "",
    '<transcript><text start="1" dur="0">Bad</text></transcript>',
    '<transcript><text start="4" dur="2">Later</text><text start="1" dur="2">Earlier</text></transcript>',
    '<transcript><text start="1" dur="2"> </text></transcript>',
    "<broken>",
    '<transcript><text start="1" dur="2">Truncated track</text>',
    '<transcript><text start="1" dur="2">Valid cue</text><text start="4" dur="2">Broken cue</transcript>',
  ]) {
    mock([track("en")], body);
    await assert.rejects(youtubeCaptions("ytcaption01", "en", "hi"));
  }
});

test("caption hosts, response bounds, blocking and timeouts cannot trigger fallback network requests", async () => {
  for (const baseUrl of [
    "https://youtube.com.evil.test/api/timedtext",
    "http://www.youtube.com/api/timedtext",
    "https://user:pass@www.youtube.com/api/timedtext",
    "https://www.youtube.com:444/api/timedtext",
  ]) {
    requests.length = 0;
    mock([{ ...track("en"), baseUrl }]);
    await assert.rejects(youtubeCaptions("ytcaption01", "en", "hi"), /host/);
    assert.equal(requests.length, 1);
  }
  for (const status of [403, 429, 500]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("blocked", { status });
    };
    await assert.rejects(youtubeCaptions("ytcaption01", "en", "hi"));
    assert.equal(calls, 1);
  }
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new DOMException("Timed out", "TimeoutError");
  };
  await assert.rejects(youtubeCaptions("ytcaption01", "en", "hi"), /Timed out/);
  assert.equal(calls, 1);
  mock([track("en")], "x".repeat(3_000_001));
  await assert.rejects(
    youtubeCaptions("ytcaption01", "en", "hi"),
    /size limit/,
  );
});

test("YouTube defaults, deduplicates overlapping scopes, saves separate cues and ignores cloud pause", async () => {
  const ids = fixture("ytcaption02"),
    p = { videoId: "ytcaption02", target: "en" };
  db.prepare(
    "UPDATE pipeline_state SET analysis_paused='fixture pause' WHERE id=1",
  ).run();
  const before = {
    segments: db.prepare("SELECT * FROM caption_segments").all(),
    chunks: db.prepare("SELECT * FROM chunks").all(),
    gate: gate(),
  };
  mock([track("en")]);
  const job = queueTranslation({ ...p, segmentIds: [ids[0]] }).job!;
  assert.equal(queueTranslation(p).job, job);
  assert.equal(getTranslations(p).available, true);
  assert.equal(requests.length, 0);
  await run(job);
  const result = getTranslations(p);
  assert.equal(result.method, "youtube");
  assert.equal(result.complete, true);
  assert.equal(result.captionTrack?.cues.length, 2);
  assert.equal(result.translations.length, 0);
  assert.equal(result.numberWarning, false);
  const passage = getTranslations({ ...p, segmentIds: [ids[0]] });
  assert.equal(passage.captionTrack?.cues.length, 1);
  assert.equal(passage.numberWarning, false);
  assert.equal(queueTranslation(p).job, null);
  assert.equal(requests.length, 2);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) n FROM segment_translations").get() as {
        n: number;
      }
    ).n,
    0,
  );
  assert.deepEqual(
    {
      segments: db.prepare("SELECT * FROM caption_segments").all(),
      chunks: db.prepare("SELECT * FROM chunks").all(),
      gate: gate(),
    },
    before,
  );
  db.prepare("UPDATE videos SET content_hash='changed' WHERE id=?").run(
    p.videoId,
  );
  assert.equal(getTranslations(p).captionTrack, null);
});

test("numerical differences are warned, untimed or foreign passages rejected and GET never queues", async () => {
  const ids = fixture("ytcaption03"),
    foreign = fixture("ytcaption04"),
    p = { videoId: "ytcaption03", target: "ur" };
  mock(
    [track("ur")],
    '<transcript><text start="1" dur="2">مختلف 999</text><text start="4" dur="2">200</text></transcript>',
  );
  await run(queueTranslation(p).job!);
  assert.equal(getTranslations(p).numberWarning, true);
  assert.equal(getTranslations(p).complete, true);
  assert.throws(
    () => queueTranslation({ ...p, segmentIds: foreign }),
    /another video/,
  );
  db.prepare(
    "UPDATE caption_segments SET start_seconds=NULL,end_seconds=NULL WHERE id=?",
  ).run(ids[0]);
  assert.equal(
    getTranslations({ ...p, segmentIds: [ids[0]] }).available,
    false,
  );
  assert.throws(
    () => queueTranslation({ ...p, segmentIds: [ids[0]] }),
    /untimed/,
  );
  const { GET, POST } = await import("../app/api/[...path]/route");
  const { NextRequest } = await import("next/server");
  const params = { params: Promise.resolve({ path: ["translations"] }) };
  const before = (
    db.prepare("SELECT COUNT(*) n FROM jobs").get() as { n: number }
  ).n;
  const response = await GET(
    new NextRequest(
      "http://127.0.0.1:3000/api/translations?videoId=ytcaption04&target=en",
      { headers: { host: "127.0.0.1:3000" } },
    ),
    params,
  );
  assert.equal((await response.json()).method, "youtube");
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM jobs").get() as { n: number }).n,
    before,
  );
  const post = (body: unknown) =>
    POST(
      new NextRequest("http://127.0.0.1:3000/api/translations", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      params,
    );
  assert.equal((await post({ ...p, method: "google" })).status, 400);
  assert.equal(
    (await post({ videoId: "ytcaption04", target: "en" })).status,
    202,
  );
});

test("interruption and retry preserve originals; stale downloads never enter the cache", async () => {
  fixture("ytcaption05");
  const p = { videoId: "ytcaption05", target: "en" };
  globalThis.fetch = async () => {
    throw new Error("fixture interrupted");
  };
  await assert.rejects(run(queueTranslation(p).job!), /interrupted/);
  assert.equal(getTranslations(p).captionTrack, null);
  mock([track("en")]);
  const fetchMock = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await fetchMock(input, init);
    if (String(input).includes("timedtext"))
      db.prepare("UPDATE videos SET content_hash='replaced' WHERE id=?").run(
        p.videoId,
      );
    return response;
  };
  await assert.rejects(run(queueTranslation(p).job!), /Transcript changed/);
  assert.equal(getTranslations(p).captionTrack, null);
  mock([track("en")]);
  await run(queueTranslation(p).job!);
  assert.equal(getTranslations(p).complete, true);
});
