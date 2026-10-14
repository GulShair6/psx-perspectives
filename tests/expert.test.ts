import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "psx-expert-"));
process.env.PSX_DB_PATH = join(temp, "db.sqlite");
delete process.env.OLLAMA_API_KEY;
delete process.env.YOUTUBE_DATA_API_KEY;
delete process.env.OPENAI_API_KEY;
const { db, now, gate, queue } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
const { indexVideo, windowBounds, normalize, refreshCatalog } =
  await import("../lib/knowledge");
const {
  searchChannels,
  followChannel,
  collectChannel,
  syncChannel,
  pauseChannel,
  channelCoverage,
} = await import("../lib/channels");
const {
  validateStatement,
  retrieveExpert,
  expertChatSchema,
  quoteSpan,
  validateExpertAnswer,
  analyzeInsights,
  scheduleInsights,
  resumeInsights,
  pipeline,
  reviewStatement,
  ANALYSIS_VERSION,
  expertResearch,
  scopeCoverage,
} = await import("../lib/expert");
const { captions, claimJob } = await import("../lib/worker");
const channel = "UC" + "x".repeat(22);
const fixture = (
  id: string,
  text: string,
  source = 2,
  date = "2026-10-01T10:00:00Z",
) =>
  importTranscript({
    url: `https://www.youtube.com/watch?v=${id}`,
    title: "Test fixture, not investment evidence",
    speaker: "Unknown guest",
    source_id: source,
    published_at: date.slice(0, 10),
    language: "mixed",
    text,
  });
const chunk = (id: string) =>
  db
    .prepare("SELECT * FROM chunks WHERE video_id=? ORDER BY ordinal")
    .get(id) as import("../lib/expert").Chunk;
const raw = (c: import("../lib/expert").Chunk, quote = c.text) => ({
  chunk_id: c.id,
  quote,
  symbol: "FFC",
  topic: "fertilizer",
  stance: "bullish",
  action: null,
  rationale: "Positive outlook",
  target: null,
  horizon: null,
  speaker: null,
  hypothetical: false,
});
const selected = (c: import("../lib/expert").Chunk, quote = c.text) => {
  const segments = db.prepare("SELECT s.* FROM caption_segments s JOIN chunk_segments cs ON cs.segment_id=s.id WHERE cs.chunk_id=? ORDER BY s.ordinal").all(c.id) as {id:number;text:string}[];
  const matching = segments.find((s) => s.text === quote);
  return { ...raw(c, quote), start_segment_id: matching?.id ?? (quote === c.text ? segments[0].id : -1), end_segment_id: matching?.id ?? (quote === c.text ? segments.at(-1)!.id : -1) };
};
const selectedSummary = (c: import("../lib/expert").Chunk, text: string, quote = c.text) => ({ ...selected(c, quote), text });
const response = (value: unknown) =>
  Response.json({
    id: "fixture",
    object: "chat.completion",
    created: 0,
    model: "gemma4:31b",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(value) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
  });
test("imports index immediately with real start/end segments and overlap without duplicating evidence", () => {
  fixture(
    "expertt0001",
    "1\n00:00:05,000 --> 00:00:09,000\nFFC outlook is improving.\n\n2\n00:00:20,000 --> 00:00:23,000\nBut do not buy FFC now.",
  );
  const c = chunk("expertt0001");
  assert.ok(c.text.includes("do not buy"));
  assert.deepEqual(quoteSpan(c.id, "But do not buy FFC now."), {
    start_seconds: 20,
    end_seconds: 23,
  });
  assert.equal(
    fixture(
      "expertt0001",
      "1\n00:00:05,000 --> 00:00:09,000\nFFC outlook is improving.\n\n2\n00:00:20,000 --> 00:00:23,000\nBut do not buy FFC now.",
    ).duplicate,
    true,
  );
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) n FROM caption_segments WHERE video_id=?")
        .get("expertt0001") as { n: number }
    ).n,
    2,
  );
  indexVideo("expertt0001");
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) n FROM chunks WHERE video_id=?")
        .get("expertt0001") as { n: number }
    ).n,
    1,
  );
  assert.equal(normalize("كی يہ"), "کی یہ");
});
test("30 structured validation cases preserve negation, explicit actions, target, horizon and guest attribution", () => {
  const c = chunk("expertt0001");
  assert.equal(
    validateStatement(raw(c, "FFC outlook is improving."), [c]).action,
    null,
  );
  for (let i = 0; i < 10; i++) {
    assert.throws(
      () =>
        validateStatement(
          { ...raw(c, "But do not buy FFC now."), action: "buy" },
          [c],
        ),
      /negated/,
    );
    assert.throws(
      () => validateStatement({ ...raw(c), speaker: "Channel owner" }, [c]),
      /not established/,
    );
    assert.throws(
      () => validateStatement({ ...raw(c), target: "500" }, [c]),
      /not explicitly/,
    );
  }
  for (const text of [
    "FFC: I would not buy now.",
    "FFC: I never sell now.",
    "FFC خریدنا نہیں",
  ]) {
    const negative = { ...c, text };
    assert.throws(
      () =>
        validateStatement(
          { ...raw(negative), action: text.includes("sell") ? "sell" : "buy" },
          [negative],
        ),
      /negated/,
    );
  }
  const avoid = { ...c, text: "Avoid FFC; do not buy it." };
  assert.equal(
    validateStatement({ ...raw(avoid), action: "avoid" }, [avoid]).action,
    "avoid",
  );
  assert.throws(() =>
    validateStatement({ ...raw(c), horizon: "next year" }, [c]),
  );
  assert.throws(() => validateStatement({ ...raw(c), symbol: "MCB" }, [c]));
  const quoted = {
    ...c,
    text: "FFC: buy at 100 for next year. Guest Ali says this.",
  };
  assert.equal(
    validateStatement(
      {
        ...raw(quoted),
        action: "buy",
        target: "100",
        horizon: "next year",
        speaker: "Ali",
      },
      [quoted],
    ).action,
    "buy",
  );
  assert.throws(() =>
    validateStatement({ ...raw(quoted), action: "buy", hypothetical: true }, [
      quoted,
    ]),
  );
});
test("Pakistan date boundaries and channel/date/stock isolation precede top-ten ranking", () => {
  assert.deepEqual(windowBounds("2026-10-01", "2026-10-01"), [
    "2026-09-30T19:00:00.000Z",
    "2026-10-01T18:59:59.999Z",
  ]);
  fixture("expertt0002", "FFC bearish view from another channel.", 3);
  fixture(
    "expertt0003",
    "FFC older view outside selected period.",
    2,
    "2026-07-01T00:00:00Z",
  );
  fixture("expertt0004", "MCB Bank has a different outlook.", 2);
  const p = expertChatSchema.parse({
    question: "FFC outlook",
    channelIds: [2],
    since: "2026-10-01",
    until: "2026-10-01",
    symbols: ["FFC"],
  });
  const results = retrieveExpert(p);
  assert.ok(results.length);
  assert.ok(results.every((r) => r.video_id === "expertt0001"));
  assert.throws(() => expertChatSchema.parse({ ...p, until: "2020-01-01" }));
});
test("20 bilingual fixture questions return relevant evidence in the top ten (synthetic regression, not live evaluation)", () => {
  db.prepare("UPDATE stock_catalog SET aliases=? WHERE symbol='FFC'").run(
    JSON.stringify(["فوجی فرٹیلائزر", "Fauji Fertilizer"]),
  );
  fixture(
    "expertt0005",
    "FFC Fauji Fertilizer فوجی فرٹیلائزر outlook dividend fertilizer market. Do not buy now; hold existing shares. Earlier bearish, later bullish perspective. فائدہ منافع کھاد مارکیٹ خرید فروخت",
  );
  const questions = [
    "FFC outlook",
    "FFC dividend",
    "FFC buy or sell",
    "FFC changes in position",
    "FFC disagreement",
    "Fauji Fertilizer view",
    "فوجی فرٹیلائزر خرید",
    "FFC کا منافع",
    "FFC market",
    "FFC hold",
    "فوجی فرٹیلائزر outlook",
    "FFC فائدہ",
    "FFC مارکیٹ",
    "FFC کھاد",
    "FFC فروخت",
    "FFC خرید",
    "FFC bullish",
    "FFC bearish",
    "FFC latest perspective",
    "FFC پہلے اور بعد",
  ];
  let correct = 0;
  for (const question of questions) {
    const hits = retrieveExpert(
      expertChatSchema.parse({
        question,
        channelIds: [2],
        symbols: ["FFC"],
        since: "2026-10-01",
        until: "2026-10-13",
      }),
    );
    if (hits.some((c) => c.video_id === "expertt0005")) correct++;
  }
  assert.equal(correct, 20);
});
test("composer coverage reports indexed and reviewed evidence without claiming complete discovery", () => {
  const p = expertChatSchema.parse({
    question: "coverage",
    channelIds: [2],
    since: "2026-10-01",
    until: "2026-10-13",
  });
  const coverage = scopeCoverage(p);
  assert.ok(coverage.indexed >= 2);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.reviewed, 0);
  assert.ok(coverage.cutoff);
});
test("explicit topic filters isolate candidates before top-ten ranking", () => {
  const p = expertChatSchema.parse({
    question: "FFC outlook",
    channelIds: [2],
    symbols: ["FFC"],
    topics: ["dividend"],
    since: "2026-10-01",
    until: "2026-10-13",
  });
  const hits = retrieveExpert(p);
  assert.ok(hits.length);
  assert.ok(hits.every((c) => c.text.includes("dividend")));
});
test("caption track selection prefers creator-supplied Urdu and preserves duration/provenance", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    requests.push(u.href);
    if (u.pathname === "/youtubei/v1/player")
      return Response.json({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: "https://www.youtube.com/api/timedtext?track=auto",
                languageCode: "en",
                kind: "asr",
              },
              {
                baseUrl: "https://www.youtube.com/api/timedtext?track=creator",
                languageCode: "ur",
              },
            ],
          },
        },
      });
    if (u.searchParams.get("track") === "creator")
      return new Response(
        '<timedtext><p t="5000" d="3000"><s>FFC منافع</s></p></timedtext>',
      );
    throw new Error("Wrong caption track");
  };
  try {
    const s = await captions("expertt0001");
    assert.equal(s[0].lang, "ur");
    assert.equal(s[0].offset, 5);
    assert.equal(s[0].duration, 3);
    assert.equal(s[0].provenance, "YouTube creator-supplied captions");
    assert.ok(!requests.some((u) => u.includes("track=auto")));
  } finally {
    globalThis.fetch = original;
  }
});
test("channel search resolves identities and paginated discovery resumes after quota without loss", async () => {
  const original = globalThis.fetch;
  process.env.YOUTUBE_DATA_API_KEY = "fixture-private-key";
  let fail = true;
  let pageRequests = 0;
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    assert.equal(u.searchParams.get("key"), null);
    assert.equal(
      new Headers(init?.headers).get("X-Goog-Api-Key"),
      "fixture-private-key",
    );
    if (u.pathname.endsWith("/channels"))
      return Response.json({
        items: [
          {
            id: channel,
            snippet: {
              title: "Confirmed fixture",
              customUrl: "@fixture",
              thumbnails: { default: { url: "https://yt3.ggpht.com/avatar" } },
            },
            contentDetails: {
              relatedPlaylists: { uploads: "UU" + "x".repeat(22) },
            },
          },
        ],
      });
    if (u.pathname.endsWith("/search"))
      return Response.json({ items: [{ id: { channelId: channel } }] });
    if (u.pathname.endsWith("/playlistItems")) {
      pageRequests++;
      if (u.searchParams.get("pageToken") === "page2" && fail)
        return new Response("{}", { status: 403 });
      return Response.json({
        items: Array.from({ length: 50 }, (_, i) => ({
          contentDetails: {
            videoId: `page${u.searchParams.has("pageToken") ? "2" : "1"}${String(i).padStart(6, "0")}`,
          },
        })),
        ...(u.searchParams.has("pageToken") ? {} : { nextPageToken: "page2" }),
      });
    }
    if (u.pathname.endsWith("/videos"))
      return Response.json({
        items: u.searchParams
          .get("id")!
          .split(",")
          .map((id) => ({
            id,
            snippet: {
              channelId: channel,
              title: "Educational topic without stock keyword",
              publishedAt: "2026-10-02T00:00:00Z",
            },
            status: { privacyStatus: "public" },
          })),
      });
    throw new Error("Unexpected YouTube endpoint");
  };
  try {
    assert.equal((await searchChannels("Abdul Rehman"))[0].id, channel);
    assert.equal(
      (await searchChannels("https://www.youtube.com/@fixture"))[0].id,
      channel,
    );
    await assert.rejects(() =>
      searchChannels("https://youtube.com.evil.test/@fixture"),
    );
    const followed = await followChannel(channel),
      source = followed.source_id;
    await assert.rejects(
      () =>
        collectChannel(
          source,
          () => {},
          async () => {},
        ),
      /quota/,
    );
    const cp = db
      .prepare("SELECT * FROM channel_checkpoints WHERE source_id=?")
      .get(source) as { page_token: string; discovery_complete: number };
    assert.equal(cp.page_token, "page2");
    assert.equal(cp.discovery_complete, 0);
    fail = false;
    let collected = 0;
    await collectChannel(
      source,
      () => {},
      async (id) => {
        collected++;
        db.prepare(
          "UPDATE videos SET caption_attempted_at=?,status='needs_transcript' WHERE id=?",
        ).run(now(), id);
      },
    );
    assert.equal(collected, 100);
    assert.equal(pageRequests, 3);
    const coverage = channelCoverage().find((c: any) => c.id === source) as any;
    assert.equal(coverage.discovered, 100);
    assert.equal(coverage.missing, 100);
    assert.equal(coverage.discovery_complete, 1);
    pauseChannel(source);
    assert.match(
      await collectChannel(
        source,
        () => {},
        async () => {
          throw new Error("Paused collection ran");
        },
      ),
      /Paused|paused/,
    );
    syncChannel(source, true);
    assert.equal(
      (
        db
          .prepare("SELECT paused FROM channel_checkpoints WHERE source_id=?")
          .get(source) as { paused: number }
      ).paused,
      0,
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.YOUTUBE_DATA_API_KEY;
  }
});
test("automatic analysis quarantines invalid claims individually and caches completed transcript hashes", async () => {
  const original = globalThis.fetch;
  process.env.OLLAMA_API_KEY = "fixture-ollama-key-test-only";
  scheduleInsights();
  let calls = 0;
  const c = chunk("expertt0001");
  globalThis.fetch = async () => {
    calls++;
    return response({
      summaries: [selectedSummary(c, "FFC has a positive outlook.", "FFC outlook is improving."), { broken: true }],
      statements: [
        selected(c, "FFC outlook is improving."),
        selected(c, "An invented source quote"),
        { ...selected(c, "But do not buy FFC now."), action: "buy" },
      ],
    });
  };
  try {
    assert.match(await analyzeInsights("expertt0001", () => {}), /1 supported/);
    const rows = db
      .prepare("SELECT status FROM statements WHERE video_id=?")
      .all("expertt0001") as { status: string }[];
    assert.equal(rows.filter((s) => s.status === "unreviewed").length, 1);
    assert.equal(rows.filter((s) => s.status === "quarantined").length, 2);
    await analyzeInsights("expertt0001", () => {});
    assert.equal(calls, 1);
    const st = db
      .prepare(
        "SELECT * FROM statements WHERE video_id=? AND status='unreviewed'",
      )
      .get("expertt0001") as { id: number; original_payload: string };
    reviewStatement({
      id: st.id,
      symbol: "FFC",
      stance: "neutral",
      action: null,
      rationale: "Corrected test interpretation",
      target: null,
      horizon: null,
      speaker: null,
      status: "reviewed",
      evaluate: true,
    });
    const changed = db
      .prepare("SELECT * FROM statements WHERE id=?")
      .get(st.id) as { original_payload: string; stance: string };
    assert.equal(changed.original_payload, st.original_payload);
    assert.equal(changed.stance, "neutral");
    assert.equal(gate().enabled, false);
    assert.equal(gate().correct, 0);
  } finally {
    globalThis.fetch = original;
    delete process.env.OLLAMA_API_KEY;
  }
});
test("quota pauses automatic analysis while raw transcript indexing continues, then resumes unfinished chunks", async () => {
  const original = globalThis.fetch;
  process.env.OLLAMA_API_KEY = "fixture-ollama-key-test-only";
  fixture(
    "expertt0006",
    "FFC opinion " +
      "x ".repeat(1200) +
      "\n\nFFC market " +
      "y ".repeat(1200) +
      "\n\nFFC outlook " +
      "z ".repeat(1200) +
      "\n\nFFC dividend " +
      "q ".repeat(1200) +
      "\n\nFFC risk " +
      "r ".repeat(1200) +
      "\n\nFFC discussion " +
      "s ".repeat(1200) +
      "\n\nFFC last " +
      "t ".repeat(1200),
  );
  scheduleInsights();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? response({
          summaries: [
            selectedSummary(chunk("expertt0006"), "First saved summary"),
          ],
          statements: [],
        })
      : Response.json(
          { error: { message: "quota", type: "insufficient_quota" } },
          { status: 429 },
        );
  };
  try {
    await assert.rejects(() => analyzeInsights("expertt0006", () => {}));
    assert.ok(pipeline().analysis_paused);
    const before = (
      db
        .prepare("SELECT COUNT(*) n FROM analysis_checkpoints WHERE video_id=?")
        .get("expertt0006") as { n: number }
    ).n;
    assert.equal(before, 6);
    fixture("expertt0007", "FFC searchable despite cloud quota.");
    assert.ok(chunk("expertt0007"));
    db.prepare("UPDATE jobs SET status='failed' WHERE type='insights'").run();
    const savedSummary = (
      db
        .prepare("SELECT summary FROM analysis_runs WHERE video_id=?")
        .get("expertt0006") as { summary: string }
    ).summary;
    assert.equal(savedSummary, "First saved summary");
    resumeInsights();
    assert.equal(
      (
        db
          .prepare("SELECT summary FROM analysis_runs WHERE video_id=?")
          .get("expertt0006") as { summary: string }
      ).summary,
      savedSummary,
    );
    assert.equal(pipeline().analysis_paused, null);
    globalThis.fetch = async () => {
      calls++;
      return response({ summaries: [], statements: [] });
    };
    assert.match(
      await analyzeInsights("expertt0006", () => {}),
      /No supported opinions/,
    );
    assert.equal(
      calls,
      2 +
        Math.ceil(
          ((
            db
              .prepare("SELECT COUNT(*) n FROM chunks WHERE video_id=?")
              .get("expertt0006") as { n: number }
          ).n -
            6) /
            6,
        ),
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.OLLAMA_API_KEY;
  }
});
test("answer validation rejects unknown citations, unsupported numerical claims and fabricated changes", () => {
  const evidence = [
    {
      id: "chunk:1",
      text: "FFC target 100, do not buy.",
      date: "2026-10-01T00:00:00Z",
      url: "https://www.youtube.com/watch?v=expertt0001",
      start_seconds: 5,
      end_seconds: 9,
      channel: "Channel A",
      title: "Fixture",
      kind: "transcript" as const,
      review: "unreviewed",
    },
  ];
  const base = {
    whatWasSaid: [{ text: "FFC target was 100.", evidenceIds: ["chunk:1"] }],
    changes: [],
    disagreements: [],
    interpretation: "Historical view only.",
    gaps: [],
  };
  assert.ok(validateExpertAnswer(base, evidence));
  assert.throws(() =>
    validateExpertAnswer(
      {
        ...base,
        whatWasSaid: [{ text: "FFC target 200", evidenceIds: ["chunk:1"] }],
      },
      evidence,
    ),
  );
  assert.throws(() =>
    validateExpertAnswer(
      {
        ...base,
        whatWasSaid: [{ text: "FFC view", evidenceIds: ["invented"] }],
      },
      evidence,
    ),
  );
  assert.throws(() =>
    validateExpertAnswer({ ...base, changes: base.whatWasSaid }, evidence),
  );
  assert.throws(() =>
    validateExpertAnswer(
      { ...base, disagreements: base.whatWasSaid },
      evidence,
    ),
  );
});
test("raw RAG works without successful extraction or paid-provider fallback", async () => {
  process.env.OPENAI_API_KEY = "must-not-use";
  const answer = await expertResearch(
    expertChatSchema.parse({
      question: "FFC outlook",
      channelIds: [2],
      since: "2026-10-01",
      until: "2026-10-13",
    }),
  );
  assert.ok(answer.evidence.length);
  assert.match(answer.interpretation, /OLLAMA_API_KEY/);
  assert.ok(answer.evidence.every((e) => e.channel === "SCS Trade"));
  delete process.env.OPENAI_API_KEY;
});
test("official catalog preserves aliases and fails safely on an empty response", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        '<table><tr><td><a href="/company/TESTCO">TESTCO</a></td><td>Test Company Limited</td></tr></table>',
      );
    assert.match(await refreshCatalog(), /1 official/);
    assert.equal(
      (
        db
          .prepare("SELECT name FROM stock_catalog WHERE symbol='TESTCO'")
          .get() as { name: string }
      ).name,
      "Test Company Limited",
    );
    globalThis.fetch = async () => new Response("<html>Unavailable</html>");
    await assert.rejects(() => refreshCatalog());
    assert.ok(
      db.prepare("SELECT 1 FROM stock_catalog WHERE symbol='TESTCO'").get(),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("provider rejection messages cannot expose the server credential", async () => {
  const original = globalThis.fetch;
  process.env.OLLAMA_API_KEY = "fixture-super-secret";
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          message: "Rejected fixture-super-secret",
          type: "authentication_error",
        },
      },
      { status: 401 },
    );
  try {
    const { askJson } = await import("../lib/ai");
    await assert.rejects(
      () =>
        askJson(
          "credential test",
          "Return JSON",
          {},
          { type: "object" },
          (x) => x,
        ),
      (e) =>
        e instanceof Error &&
        !e.message.includes("fixture-super-secret") &&
        e.message.includes("[credential redacted]"),
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.OLLAMA_API_KEY;
  }
});

test("manual caption fallback retains confirmed channel identity and official publication time", () => {
  db.prepare(
    "INSERT INTO videos(id,source_id,title,speaker,published_at,url) VALUES(?,2,'Known official title','Channel','2026-10-03T10:00:00Z',?)",
  ).run("expertt0009", "https://www.youtube.com/watch?v=expertt0009");
  importTranscript({
    url: "https://www.youtube.com/watch?v=expertt0009",
    title: "User fallback title",
    speaker: "Known guest",
    source_id: null,
    published_at: "2026-10-01",
    language: "en",
    text: "OGDC manual fallback fixture.",
  });
  const v = db
    .prepare("SELECT * FROM videos WHERE id=?")
    .get("expertt0009") as {
    source_id: number;
    published_at: string;
    title: string;
    speaker: string;
  };
  assert.equal(v.source_id, 2);
  assert.equal(v.published_at, "2026-10-03T10:00:00Z");
  assert.equal(v.title, "Known official title");
  assert.equal(v.speaker, "Known guest");
});
test("channel pause stops before another cloud call and resumes without losing completed summaries", async () => {
  const original = globalThis.fetch;
  process.env.OLLAMA_API_KEY = "fixture-ollama-key-test-only";
  fixture(
    "expertt0008",
    "FFC pause fixture " + "x ".repeat(14000),
    2,
    "2026-10-05",
  );
  scheduleInsights();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1)
      db.prepare("UPDATE sources SET enabled=0 WHERE id=2").run();
    const c = chunk("expertt0008");
    return response({
      summaries:
        calls === 1
          ? [selectedSummary(c, "Saved before pause")]
          : [],
      statements: [],
    });
  };
  try {
    assert.match(
      await analyzeInsights("expertt0008", () => {}),
      /Paused after/,
    );
    assert.equal(calls, 1);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM analysis_checkpoints WHERE video_id=?",
          )
          .get("expertt0008") as { n: number }
      ).n,
      6,
    );
    db.prepare(
      "UPDATE jobs SET status='done' WHERE type='insights' AND json_extract(payload,'$.id')=?",
    ).run("expertt0008");
    syncChannel(2, true);
    scheduleInsights();
    const resumed = db
      .prepare("SELECT status,summary FROM analysis_runs WHERE video_id=?")
      .get("expertt0008") as { status: string; summary: string };
    assert.equal(resumed.status, "pending");
    assert.equal(resumed.summary, "Saved before pause");
    await analyzeInsights("expertt0008", () => {});
    assert.equal(
      calls,
      1 +
        Math.ceil(
          ((
            db
              .prepare("SELECT COUNT(*) n FROM chunks WHERE video_id=?")
              .get("expertt0008") as { n: number }
          ).n -
            6) /
            6,
        ),
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.OLLAMA_API_KEY;
    db.prepare("UPDATE sources SET enabled=1 WHERE id=2").run();
  }
});
test("collection/import jobs run before queued insights and insights run newest video first", () => {
  const active = db
    .prepare("SELECT id,status FROM jobs WHERE status IN ('queued','running')")
    .all() as { id: number; status: string }[];
  db.prepare(
    "UPDATE jobs SET status='done' WHERE status IN ('queued','running')",
  ).run();
  const ids = [
    queue("insights", { id: "expertt0003" }),
    queue("insights", { id: "expertt0008" }),
    queue("import", {}),
  ];
  try {
    assert.equal(claimJob()!.type, "import");
    assert.equal(JSON.parse(claimJob()!.payload).id, "expertt0008");
    assert.equal(JSON.parse(claimJob()!.payload).id, "expertt0003");
  } finally {
    for (const id of ids) db.prepare("DELETE FROM jobs WHERE id=?").run(id);
    for (const j of active)
      db.prepare("UPDATE jobs SET status=? WHERE id=?").run(j.status, j.id);
  }
});
test("successful provider responses containing credentials are discarded before indexing or display", async () => {
  const original = globalThis.fetch;
  process.env.OLLAMA_API_KEY = "fixture-credential-response";
  globalThis.fetch = async () =>
    response({ secret: process.env.OLLAMA_API_KEY });
  try {
    const { askJson } = await import("../lib/ai");
    await assert.rejects(
      () =>
        askJson(
          "credential response",
          "Return JSON",
          {},
          { type: "object" },
          (x) => x,
        ),
      /credential data; discarded/,
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.OLLAMA_API_KEY;
  }
});
test("extraction rejects over-limit arrays without checkpointing or losing source evidence", async () => {
  fixture("expertlimit", "FFC source evidence for bounded output.");
  const original = globalThis.fetch;
  process.env.OLLAMA_API_KEY = "fixture-array-limit";
  scheduleInsights();
  const c = chunk("expertlimit");
  try {
    for (const output of [
      { summaries: Array.from({ length: 11 }, () => selectedSummary(c, "Source discussion")), statements: [] },
      { summaries: [], statements: Array.from({ length: 41 }, () => selected(c)) },
    ]) {
      globalThis.fetch = async () => response(output);
      await assert.rejects(() => analyzeInsights("expertlimit", () => {}), /Too big/);
      assert.equal((db.prepare("SELECT COUNT(*) n FROM analysis_checkpoints WHERE video_id='expertlimit'").get() as {n:number}).n, 0);
      assert.ok(chunk("expertlimit"));
    }
  } finally { globalThis.fetch = original; delete process.env.OLLAMA_API_KEY; }
});

test("synthesis failure returns scoped saved evidence and coverage without a generated conclusion", async () => {
  const original = globalThis.fetch;
  process.env.OLLAMA_API_KEY = "fixture-synthesis-failure";
  globalThis.fetch = async () => Response.json({error:{message:"provider unavailable"}}, {status:503});
  try {
    const result = await expertResearch(expertChatSchema.parse({question:"FFC outlook",channelIds:[2],symbols:["FFC"],since:"2026-10-01",until:"2026-10-13"}));
    assert.ok(result.evidence.length);
    assert.ok(result.evidence.every(e=>e.channel === "SCS Trade"));
    assert.equal(result.whatWasSaid.length,0);
    assert.ok(result.coverage.indexed);
    assert.match(result.interpretation,/synthesis failed/);
    assert.match(result.retrieval.fallbackReason||"",/saved evidence/);
  } finally { globalThis.fetch = original; delete process.env.OLLAMA_API_KEY; }
});

test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
