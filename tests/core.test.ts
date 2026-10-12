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
} = await import("../lib/ai");
const { runJob, claimJob, normalizeCaptions, groupCaptions } =
  await import("../lib/worker");
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
test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
