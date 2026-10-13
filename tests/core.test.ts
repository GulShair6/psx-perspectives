import OpenAI from "openai";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const temp = mkdtempSync(join(tmpdir(), "psx-test-"));
process.env.PSX_DB_PATH = join(temp, "test.sqlite");
const { db, companies, saveSnapshot, gate, consensus, now } =
  await import("../lib/db");
const { numeric, parsePsx, parsePayouts, parseFeed } =
  await import("../lib/sources");
const { videoId, officialUrl } = await import("../lib/validation");
const { parseTranscript, importTranscript, recordReview } =
  await import("../lib/transcripts");
const { reserve, settle, budget, month } = await import("../lib/budget");
const {
  matchesCompany,
  validateExtraction,
  validateAnswer,
  citation,
  retrieve,
  research,
  askJson,
  aiSettings,
} = await import("../lib/ai");
const {
  runJob,
  claimJob,
  normalizeCaptions,
  groupCaptions,
  queueDiscovery,
  scheduleDiscovery,
  DISCOVERY_INTERVAL,
  queueExtraction,
  analyzeBatch,
  videos,
} = await import("../lib/worker");
const html = `<title>OGDC - Quote</title><div class="quote__name">Oil &amp; Gas Development Company<div class="tag">XD</div></div><div class="quote__close">Rs.300.39</div><div class="quote__date">As of Oct 12, 2026</div><div class="quote__sector">Energy</div><div class="change__percent">(-1.87%)</div><div class="tabs__panel" data-name="REG"><div class="stats_item"><div class="stats_label">P/E Ratio (TTM) **</div><div class="stats_value">5.33</div></div><div class="stats_item"><div class="stats_label">Volume</div><div class="stats_value">1,929,730</div></div></div><div id="financials"><div class="tabs__panel" data-name="Annual"><table><thead><tr><th></th><th>2026</th><th>2025</th></tr></thead><tbody><tr><td>EPS</td><td>56.35</td><td>-</td></tr></tbody></table></div></div>`;
let opinionId = 0;
test("numeric parser preserves missing values, losses and units", () => {
  assert.equal(numeric("—"), null);
  assert.equal(numeric(""), null);
  assert.equal(numeric("(18.71)"), -18.71);
  assert.equal(numeric("Rs.300.39"), 300.39);
  assert.equal(numeric("1,929,730"), 1929730);
  assert.equal(numeric("1.2x"), null);
});
test("PSX parser validates the symbol and retains dated financial periods", () => {
  const s = parsePsx(html, "OGDC");
  assert.equal(s.price, 300.39);
  assert.equal(s.change, -1.87);
  assert.equal(s.name, "Oil & Gas Development Company");
  assert.equal(s.pe, 5.33);
  assert.deepEqual(s.annual.periods, ["2026", "2025"]);
  assert.deepEqual(s.annual.rows[0].values, [56.35, null]);
  assert.match(s.annual.unit, /thousands/);
  assert.throws(() => parsePsx(html, "MCB"));
  saveSnapshot("OGDC", s);
  assert.equal(
    companies().find((c) => c.symbol === "OGDC")!.snapshot!.price,
    300.39,
  );
});
test("payout and channel feed parsers read structured rows without inference", () => {
  assert.deepEqual(
    parsePayouts(
      "<table><tbody><tr><td>Oct 1, 2026</td><td>Final cash dividend</td><td>10%</td></tr></tbody></table>",
    ),
    [{ date: "Oct 1, 2026", description: "Final cash dividend | 10%" }],
  );
  assert.equal(
    parseFeed(
      '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>abcdefghijk</yt:videoId><title>PSX</title><published>2026-10-01</published><link href="https://www.youtube.com/watch?v=abcdefghijk"/></entry></feed>',
    )[0].id,
    "abcdefghijk",
  );
});
test("caption timestamps normalize millisecond srv3 and preserve classic seconds", () => {
  assert.equal(
    normalizeCaptions(
      [{ text: "Quote", offset: 2800, duration: 4559 }],
      true,
    )[0].offset,
    2.8,
  );
  assert.equal(
    normalizeCaptions(
      [{ text: "Quote", offset: 2.8, duration: 4.559 }],
      false,
    )[0].offset,
    2.8,
  );
  assert.equal(
    groupCaptions([
      { text: "OGDC", offset: 2.8 },
      { text: "is a company", offset: 4 },
    ])[0].offset,
    2.8,
  );
});
test("URLs reject spoofed hosts, private targets and credentials", () => {
  assert.equal(videoId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assert.throws(() =>
    videoId("https://youtube.com.evil.test/watch?v=abcdefghijk"),
  );
  assert.throws(() =>
    videoId("https://user:pass@youtube.com/watch?v=abcdefghijk"),
  );
  assert.throws(() => officialUrl("https://127.0.0.1/test"));
  assert.throws(() => officialUrl("http://www.psx.com.pk/test"));
});
test("SRT, VTT and plain imports keep supplied timestamps only", () => {
  assert.deepEqual(
    parseTranscript(
      "1\n00:00:02,800 --> 00:00:04,000\nOGDC is undervalued.\n\n2\n00:01:00,000 --> 00:01:04,000\nI would not buy PPL.",
    ),
    [
      { text: "OGDC is undervalued.", start_seconds: 2.8 },
      { text: "I would not buy PPL.", start_seconds: 60 },
    ],
  );
  assert.equal(
    parseTranscript(
      "WEBVTT\n\n00:02.500 --> 00:04.000\nOGDC is discussed here.",
    )[0].start_seconds,
    2.5,
  );
  assert.equal(
    parseTranscript("OGDC is discussed without timestamps.")[0].start_seconds,
    null,
  );
});
test("duplicate video imports never overwrite reviewed evidence", () => {
  const input = {
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    title: "Test transcript",
    speaker: "Analyst One",
    published_at: "2026-10-01",
    text: "OGDC: I would not buy it at this valuation. If it were cheaper, I might buy.",
    language: "en",
  };
  assert.equal(importTranscript(input).duplicate, false);
  assert.equal(importTranscript(input).duplicate, true);
  assert.throws(() =>
    importTranscript({
      ...input,
      text: "OGDC changed transcript content for this stock.",
    }),
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM passages").get() as { n: number }).n,
    1,
  );
});
test("alias boundaries and negated evidence survive extraction without keyword buy counting", () => {
  assert.equal(
    matchesCompany(
      "Hubco and میزان بینک",
      companies().find((c) => c.symbol === "HUBC")!,
    ),
    true,
  );
  assert.equal(
    matchesCompany(
      "SYSTEMATIC",
      companies().find((c) => c.symbol === "SYS")!,
    ),
    false,
  );
  const p = db.prepare("SELECT id,text FROM passages").all() as {
    id: number;
    text: string;
  }[];
  const o = {
    passage_id: p[0].id,
    symbol: "OGDC",
    stance: "bearish",
    rationale: "Explicitly not buying at this valuation",
    quote: "I would not buy it at this valuation.",
    target: null,
    horizon: null,
    hypothetical: false,
  };
  assert.equal(
    validateExtraction({ opinions: [o] }, p).opinions[0].stance,
    "bearish",
  );
  assert.throws(() =>
    validateExtraction({ opinions: [{ ...o, quote: "Buy it today" }] }, p),
  );
  assert.throws(() =>
    validateExtraction({ opinions: [{ ...o, target: "PKR 500" }] }, p),
  );
  assert.throws(() =>
    validateExtraction({ opinions: [{ ...o, symbol: "PPL" }] }, p),
  );
  opinionId = Number(
    db
      .prepare(
        "INSERT INTO opinions(video_id,passage_id,symbol,speaker,stance,rationale,quote,extracted_symbol,extracted_stance) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "abcdefghijk",
        p[0].id,
        "OGDC",
        "Analyst One",
        "bullish",
        "Wrong initial extraction",
        o.quote,
        "OGDC",
        "bullish",
      ).lastInsertRowid,
  );
});
test("review correction updates research evidence and evaluation without changing the original extraction", () => {
  recordReview({
    id: opinionId,
    symbol: "OGDC",
    speaker: "Analyst One",
    stance: "bearish",
    rationale: "Does not support buying",
    target: null,
    horizon: null,
    hypothetical: false,
    status: "approved",
    expected_symbol: "OGDC",
    expected_stance: "bearish",
    evaluate: true,
  });
  assert.equal(gate().reviewed, 1);
  assert.equal(gate().accuracy, 0);
  assert.equal(gate().enabled, false);
  assert.equal(consensus("OGDC", "2026-01-01"), null);
  const e = retrieve("What about OGDC?", [], "2026-01-01");
  assert.ok(
    e.some((e) => e.kind === "commentary" && e.text.includes("bearish")),
  );
  assert.throws(() =>
    recordReview({
      id: opinionId,
      symbol: "OGDC",
      speaker: "Analyst One",
      stance: "neutral",
      rationale: "Example",
      target: null,
      horizon: null,
      hypothetical: true,
      status: "approved",
      expected_symbol: "OGDC",
      expected_stance: "neutral",
      evaluate: false,
    }),
  );
});
test("gate requires 30 independent evaluated extractions and at least 90% accuracy", () => {
  for (let i = 0; i < 29; i++) {
    const passageId = Number(
      db
        .prepare("INSERT INTO passages(video_id,text) VALUES(?,?)")
        .run("abcdefghijk", `Independent test passage ${i}`).lastInsertRowid,
    );
    const id = Number(
      db
        .prepare(
          "INSERT INTO opinions(video_id,passage_id,symbol,speaker,stance,rationale,quote,extracted_symbol,extracted_stance,status) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "abcdefghijk",
          passageId,
          "OGDC",
          "Analyst One",
          "bearish",
          "Test fixture",
          "Test fixture",
          "OGDC",
          "bearish",
          "approved",
        ).lastInsertRowid,
    );
    db.prepare("INSERT INTO evaluations VALUES(?,?,?)").run(id, 1, now());
  }
  assert.equal(gate().reviewed, 30);
  assert.equal(gate().enabled, true);
  assert.equal(consensus("OGDC", "2026-01-01")!.sample, 1);
  db.prepare(
    "UPDATE evaluations SET correct=0 WHERE opinion_id IN (SELECT opinion_id FROM evaluations LIMIT 4)",
  ).run();
  assert.equal(gate().enabled, false);
});
test("citations must reference retrieved evidence and timestamps come only from passages", () => {
  const evidence = retrieve("OGDC", [], "2026-01-01");
  assert.throws(() =>
    validateAnswer(
      {
        facts: [{ text: "Claim", evidenceIds: ["company:FAKE"] }],
        expertViews: [],
        interpretation: "",
        gaps: [],
      },
      evidence,
    ),
  );
  assert.throws(() =>
    validateAnswer(
      {
        facts: [{ text: "Claim", evidenceIds: [`opinion:${opinionId}`] }],
        expertViews: [],
        interpretation: "",
        gaps: [],
      },
      evidence,
    ),
  );
  const e = {
    id: "opinion:1",
    kind: "commentary" as const,
    text: "quote",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    date: "2026-10-01",
    start_seconds: null,
  };
  assert.throws(() =>
    validateAnswer(
      {
        facts: [{ text: "Price is PKR 99999", evidenceIds: ["company:OGDC"] }],
        expertViews: [],
        interpretation: "",
        gaps: [],
      },
      evidence,
    ),
  );
  assert.ok(!citation(e).url.includes("&t="));
  assert.ok(citation({ ...e, start_seconds: 2.8 }).url.endsWith("&t=2"));
});
test("failed refresh preserves the last good snapshot", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  try {
    await assert.rejects(() =>
      runJob({
        id: 999,
        type: "refresh",
        payload: JSON.stringify({ symbols: ["OGDC"] }),
      }),
    );
    assert.equal(
      companies().find((c) => c.symbol === "OGDC")!.snapshot!.price,
      300.39,
    );
  } finally {
    globalThis.fetch = saved;
  }
});
test("job claim is atomic and only queued jobs are returned", () => {
  db.prepare(
    "INSERT INTO jobs(type,payload,created_at,updated_at) VALUES(?,?,?,?)",
  ).run("refresh", "{}", now(), now());
  assert.ok(claimJob());
  assert.equal(claimJob(), undefined);
});
test("budget uses Pakistan month boundaries and settles one reservation once", () => {
  assert.equal(month(new Date("2026-09-30T20:00:00Z")), "2026-10");
  const id = reserve("test", 10000);
  settle(id, 1000, 1000);
  assert.equal(budget().used, 0.002);
  assert.throws(() => settle(id, 1000, 1000));
  assert.throws(() => reserve("invalid", -1));
});
test("concurrent processes cannot reserve beyond the monthly $10 cap", async () => {
  db.prepare("DELETE FROM usage").run();
  const script = join(process.cwd(), "tests/reserve-child.ts");
  const results = await Promise.all(
    Array.from(
      { length: 8 },
      () =>
        new Promise<number>((resolve, reject) => {
          const p = spawn(process.execPath, ["--import", "tsx", script], {
            env: process.env,
            stdio: "ignore",
          });
          p.on("error", reject);
          p.on("exit", (c) => resolve(c ?? 1));
        }),
    ),
  );
  assert.equal(results.filter((c) => c === 0).length, 5);
  assert.equal(budget().remaining, 0);
});
test("empty evidence answers disclose gaps without charging AI", async () => {
  const answer = await research(
    "Nonexistent company question",
    [],
    "2026-01-01",
  );
  assert.equal(answer.citations.length, 0);
  assert.ok(answer.gaps.length);
});
test("automatic discovery schedules due enabled sources once and persists six-hour checks", () => {
  db.prepare("UPDATE sources SET enabled=0,next_check_at=NULL").run();
  db.prepare("UPDATE sources SET enabled=1 WHERE id=2").run();
  const time = Date.now();
  scheduleDiscovery(time);
  scheduleDiscovery(time);
  const jobs = db
    .prepare("SELECT id FROM jobs WHERE type='discover'")
    .all() as { id: number }[];
  assert.equal(jobs.length, 1);
  assert.equal(queueDiscovery(2, time), jobs[0].id);
  assert.throws(() => queueDiscovery(1, time));
  db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(jobs[0].id);
  scheduleDiscovery(time + DISCOVERY_INTERVAL - 1);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) n FROM jobs WHERE type='discover'").get() as {
        n: number;
      }
    ).n,
    1,
  );
  scheduleDiscovery(time + DISCOVERY_INTERVAL);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) n FROM jobs WHERE type='discover'").get() as {
        n: number;
      }
    ).n,
    2,
  );
});

test("automatic channel collection saves captions without a key and skips saved videos", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let captionRequests = 0;
  const published = new Date(Date.now() - 86400000).toISOString();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "scstrade.com")
      return new Response(
        '<a href="https://www.youtube.com/channel/UCjL4aKJhoVQNRJK9vHdaWEA">Official channel</a>',
      );
    if (url.pathname === "/feeds/videos.xml")
      return new Response(
        `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>autovid0001</yt:videoId><title>PSX earnings discussion</title><published>${published}</published><link href="https://www.youtube.com/watch?v=autovid0001"/></entry></feed>`,
      );
    if (url.pathname === "/youtubei/v1/player") {
      captionRequests++;
      return Response.json({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: "https://www.youtube.com/api/timedtext?v=autovid0001",
                languageCode: "ur",
              },
            ],
          },
        },
      });
    }
    if (url.pathname === "/api/timedtext")
      return new Response(
        '<timedtext><p t="3000" d="2000"><s>OGDC کی مالی رپورٹ</s></p></timedtext>',
      );
    throw new Error("Unexpected network request");
  };
  try {
    const job = {
      id: 999,
      type: "discover",
      payload: JSON.stringify({ source_id: 2 }),
    };
    await runJob(job);
    await runJob(job);
    assert.equal(captionRequests, 1);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM passages WHERE video_id='autovid0001'",
          )
          .get() as { n: number }
      ).n,
      1,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT start_seconds FROM passages WHERE video_id='autovid0001'",
          )
          .get() as { start_seconds: number }
      ).start_seconds,
      3,
    );
    assert.equal(
      (
        db.prepare("SELECT last_error FROM sources WHERE id=2").get() as {
          last_error: string | null;
        }
      ).last_error,
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  }
});

test("blocked captions stop the batch and unavailable videos get a daily cooldown", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const published = new Date(Date.now() - 86400000).toISOString();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "scstrade.com")
      return new Response(
        '<a href="https://www.youtube.com/channel/UCjL4aKJhoVQNRJK9vHdaWEA">Official channel</a>',
      );
    if (url.pathname === "/feeds/videos.xml")
      return new Response(
        `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${["autovid0002", "autovid0003"].map((id) => `<entry><yt:videoId>${id}</yt:videoId><title>PSX market research</title><published>${published}</published><link href="https://www.youtube.com/watch?v=${id}"/></entry>`).join("")}</feed>`,
      );
    requests++;
    return new Response("Blocked", { status: 429 });
  };
  try {
    const job = {
      id: 999,
      type: "discover",
      payload: JSON.stringify({ source_id: 2 }),
    };
    await assert.rejects(() => runJob(job), /too many requests/);
    assert.equal(requests, 1);
    assert.equal(
      db.prepare("SELECT 1 FROM videos WHERE id='autovid0003'").get(),
      undefined,
    );
    db.prepare(
      "INSERT INTO videos(id,title,speaker,published_at,url,caption_attempted_at) VALUES(?,?,?,?,?,?)",
    ).run(
      "autovid0003",
      "Fixture",
      "Fixture",
      published,
      "https://www.youtube.com/watch?v=autovid0003",
      now(),
    );
    await runJob(job);
    assert.equal(requests, 1);
    db.prepare(
      "UPDATE videos SET caption_attempted_at=? WHERE id='autovid0002'",
    ).run(new Date(Date.now() - 25 * 3600000).toISOString());
    await assert.rejects(() => runJob(job), /too many requests/);
    assert.equal(requests, 2);
    assert.match(
      (
        db.prepare("SELECT last_error FROM sources WHERE id=2").get() as {
          last_error: string;
        }
      ).last_error,
      /too many requests/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ollama Cloud uses the server key, validates JSON and accounts for credit usage", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OLLAMA_API_KEY;
  process.env.OLLAMA_API_KEY = "test-server-secret";
  db.prepare("DELETE FROM usage").run();
  let raw = '{"ok":true}';
  let status = 200;
  let finish = "stop";
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    assert.equal(request.url, "https://ollama.com/v1/chat/completions");
    assert.equal(
      request.headers.get("authorization"),
      "Bearer test-server-secret",
    );
    const body = await request.json();
    assert.equal(body.model, "gemma4:31b");
    assert.equal(body.max_tokens, 100);
    assert.equal(body.response_format, undefined);
    assert.match(body.messages[0].content, /schema/);
    return Response.json(
      status === 200
        ? {
            choices: [{ message: { content: raw }, finish_reason: finish }],
            usage: { prompt_tokens: 1000, completion_tokens: 100 },
          }
        : { error: { message: "quota exhausted" } },
      { status },
    );
  };
  const call = () =>
    askJson(
      "test cloud",
      "Respond as JSON",
      {},
      {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
      (value) => {
        assert.deepEqual(value, { ok: true });
        return value;
      },
      100,
    );
  try {
    assert.equal(aiSettings().provider, "Ollama Cloud");
    assert.deepEqual(await call(), { ok: true });
    assert.equal(budget().used, 0.00018);
    raw = '```json\n{"ok":true}\n```';
    assert.deepEqual(await call(), { ok: true });
    raw = "unstructured output";
    await assert.rejects(call(), /JSON/);
    raw = '{"ok":false}';
    await assert.rejects(call());
    finish = "length";
    await assert.rejects(call(), /truncated/);
    status = 429;
    await assert.rejects(call(), /quota exhausted/);
    assert.equal(
      (
        db
          .prepare("SELECT status FROM usage ORDER BY id DESC LIMIT 1")
          .get() as { status: string }
      ).status,
      "released",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = originalKey;
  }
});

test("batch analysis validates IDs, passages, existing analysis and active overlaps", () => {
  const ids = ["zzbatch0001", "zzbatch0002"];
  for (const id of ids)
    importTranscript({
      url: `https://www.youtube.com/watch?v=${id}`,
      title: "Batch fixture",
      speaker: "Fixture",
      published_at: "2026-10-01",
      language: "en",
      text: "OGDC batch fixture evidence.",
    });
  assert.throws(() => queueExtraction([]));
  assert.throws(() => queueExtraction([ids[0], ids[0]]));
  assert.throws(() => queueExtraction(["bad"]));
  assert.throws(() => queueExtraction(["zzbatch9999"]), /transcript/);
  const job = queueExtraction(ids);
  assert.equal(
    (
      db.prepare("SELECT type FROM jobs WHERE id=?").get(job) as {
        type: string;
      }
    ).type,
    "extract_batch",
  );
  assert.throws(() => queueExtraction([ids[0]], true), /already queued/);
  assert.equal(
    (videos() as { id: string; analysis_state: string }[]).find(
      (v) => v.id === ids[0],
    )?.analysis_state,
    "Analyzing",
  );
  db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(job);
  const single = queueExtraction([ids[0]], true);
  assert.throws(() => queueExtraction(ids), /already queued/);
  db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(single);
  db.prepare("UPDATE videos SET status='extracted' WHERE id=?").run(ids[0]);
  assert.throws(() => queueExtraction([ids[0]]), /already been analyzed/);
});
test("batch validation failures continue, quota failures stop, and zero opinions are explicit", async () => {
  const ids = ["zzbatch0003", "zzbatch0004", "zzbatch0005"];
  for (const id of ids)
    importTranscript({
      url: `https://www.youtube.com/watch?v=${id}`,
      title: "Batch failure fixture",
      speaker: "Fixture",
      published_at: "2026-10-01",
      language: "en",
      text: "OGDC fixture evidence.",
    });
  const called: string[] = [];
  const progress: string[] = [];
  await assert.rejects(
    analyzeBatch(
      ids,
      (s) => progress.push(s),
      async (id) => {
        called.push(id);
        if (id === ids[1]) throw new Error("Unsupported quote");
        db.prepare("UPDATE videos SET status='extracted' WHERE id=?").run(id);
      },
    ),
    /2 successful, 1 failed, 0 unprocessed/,
  );
  assert.deepEqual(called, ids);
  assert.match(
    (
      db.prepare("SELECT error FROM videos WHERE id=?").get(ids[1]) as {
        error: string;
      }
    ).error,
    /Unsupported quote/,
  );
  called.length = 0;
  await assert.rejects(
    analyzeBatch(
      ids,
      () => {},
      async (id) => {
        called.push(id);
        throw new OpenAI.APIError(
          429,
          undefined,
          "quota exhausted",
          new Headers(),
        );
      },
    ),
    /0 successful, 1 failed, 2 unprocessed/,
  );
  assert.deepEqual(called, [ids[0]]);
  const result = await analyzeBatch(
    [ids[2]],
    () => {},
    async (id) => {
      db.prepare("UPDATE videos SET status='extracted' WHERE id=?").run(id);
    },
  );
  assert.match(result, /No supported opinions found/);
  assert.equal(
    (videos() as { id: string; analysis_state: string }[]).find(
      (v) => v.id === ids[2],
    )?.analysis_state,
    "Reviewed",
  );
});
test("importing a transcript never triggers AI analysis even with a configured key", async () => {
  const originalKey = process.env.OLLAMA_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OLLAMA_API_KEY = "fixture-key";
  globalThis.fetch = async () => {
    throw new Error("Unexpected provider request");
  };
  try {
    const result = await runJob({
      id: 99999,
      type: "import",
      payload: JSON.stringify({
        url: "https://www.youtube.com/watch?v=zzbatch0006",
        title: "Import fixture",
        speaker: "Fixture",
        published_at: "2026-10-01",
        language: "en",
        text: "OGDC fixture evidence.",
      }),
    });
    assert.match(result, /Ready to analyze/);
    assert.equal(
      (
        db
          .prepare("SELECT status FROM videos WHERE id='zzbatch0006'")
          .get() as { status: string }
      ).status,
      "imported",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = originalKey;
  }
});

test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
