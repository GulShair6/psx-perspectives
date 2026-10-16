import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "psx-audit-regression-"));
process.env.PSX_DB_PATH = join(temp, "db.sqlite");
delete process.env.OLLAMA_API_KEY;
const { db, gate, now, reviewEvidence } = await import("../lib/db");
const { parseTranscript, importTranscript } =
  await import("../lib/transcripts");
const { validateStatement } = await import("../lib/expert");
const { validateExtraction } = await import("../lib/ai");
function fixture(id: string, text: string) {
  importTranscript({
    url: `https://youtu.be/${id}`,
    title: "Audit fixture",
    speaker: "Unknown",
    published_at: "2026-10-01",
    language: "unknown",
    text: text.length < 20 ? text + " Source caption." : text,
  });
  return db
    .prepare("SELECT * FROM chunks WHERE video_id=?")
    .get(id) as import("../lib/expert").Chunk;
}
const raw = (c: import("../lib/expert").Chunk) => ({
  chunk_id: c.id,
  quote: c.text,
  symbol: "FFC",
  topic: "market",
  stance: "bullish",
  action: null,
  rationale: "Outlook",
  target: null,
  horizon: null,
  speaker: null,
  hypothetical: false,
});

test("subtitle parsing preserves numeric speech and excludes VTT blocks and cue IDs", () => {
  assert.deepEqual(
    parseTranscript("1\n00:00:01,000 --> 00:00:03,000\nFFC target\n100"),
    [{ text: "FFC target 100", start_seconds: 1, end_seconds: 3 }],
  );
  const vtt =
    "WEBVTT\nKind: captions\nLanguage: en\n\nNOTE Editorial note\nNot spoken\n\nSTYLE\n::cue { color: red; }\n\nREGION\nid:main\n\ncue-name\n00:01.000 --> 00:03.000 align:start\nFFC\n100\n\n2\n00:04.000 --> 00:05.000\n200";
  assert.deepEqual(
    parseTranscript(vtt).map((p) => p.text),
    ["FFC 100", "200"],
  );
  assert.equal(parseTranscript("100\n200")[0].text, "100 200");
});
test("Hindi and code-mixed actions respect negation and hypothetical advice", () => {
  for (const [i, quote, action] of [
    [0, "FFC को अभी खरीदें।", "buy"],
    [1, "FFC को बेचें।", "sell"],
    [2, "FFC को होल्ड करें।", "hold"],
    [3, "FFC पर नज़र रखें।", "watch"],
    [4, "FFC से बचें।", "avoid"],
  ] as const) {
    const c = fixture(`audithin00${i}`, quote);
    assert.doesNotThrow(() => validateStatement({ ...raw(c), action }, [c]));
  }
  for (const [i, quote] of [
    "FFC को buy नहीं करना चाहिए।",
    "FFC को मत खरीदें।",
    "FFC को खरीदना नहीं चाहिए।",
    "FFC को buy न करें।",
    "FFC को नहीं खरीदें लेकिन MCB buy करें।",
  ].entries()) {
    const c = fixture(`auditneg00${i}`, quote);
    assert.throws(
      () => validateStatement({ ...raw(c), action: "buy" }, [c]),
      /negated|ambiguous/,
    );
  }
  const c = fixture("audithyp000", "FFC buy if the price falls.");
  assert.throws(() =>
    validateStatement({ ...raw(c), action: "buy", hypothetical: true }, [c]),
  );
});
test("numerical grounding preserves complete signed tokens and sentence punctuation", () => {
  const c = fixture(
    "auditnum000",
    "FFC change -100 PKR; target 1,200.50; yield 10%. Target 100.",
  );
  for (const rationale of [
    "Change -100 PKR",
    "Target 100.",
    "Yield 10%.",
    "Target 1,200.50.",
  ])
    assert.doesNotThrow(() => validateStatement({ ...raw(c), rationale }, [c]));
  for (const rationale of [
    "Change +100 PKR",
    "Yield 10",
    "Target 200.50",
    "Target 1200.50",
    "Change −100 PKR",
  ])
    assert.throws(
      () => validateStatement({ ...raw(c), rationale }, [c]),
      /numbers/,
    );
});
test("legacy extraction grounds stock, target and horizon in the quote", () => {
  const p = [
    { id: 1, text: "FFC outlook is weak for 10 years. Buy MCB at 100." },
  ];
  const opinion = {
    passage_id: 1,
    symbol: "FFC",
    stance: "bullish",
    rationale: "Outlook",
    quote: "Buy MCB at 100.",
    target: null,
    horizon: null,
    hypothetical: false,
  };
  assert.throws(() => validateExtraction({ opinions: [opinion] }, p));
  assert.throws(() =>
    validateExtraction(
      { opinions: [{ ...opinion, symbol: "MCB", horizon: "10 years" }] },
      p,
    ),
  );
  assert.doesNotThrow(() =>
    validateExtraction(
      { opinions: [{ ...opinion, symbol: "MCB", target: "100" }] },
      p,
    ),
  );
});
test("review gate merges the same original evidence across both review systems", () => {
  for (let i = 0; i < 15; i++) {
    const c = fixture(
      `auditrev${String(i).padStart(3, "0")}`,
      `FFC original passage ${i}.`,
    );
    const p = db
      .prepare("SELECT id FROM passages WHERE video_id=?")
      .get(c.video_id) as { id: number };
    const o = Number(
      db
        .prepare(
          "INSERT INTO opinions(video_id,passage_id,symbol,speaker,stance,rationale,quote,status,extracted_symbol,extracted_stance) VALUES(?,?,'FFC','Unknown','bullish','outlook',?,'approved','FFC','bullish')",
        )
        .run(c.video_id, p.id, c.text).lastInsertRowid,
    );
    db.prepare("INSERT INTO evaluations VALUES(?,?,?)").run(o, 1, now());
    const s = Number(
      db
        .prepare(
          "INSERT INTO statements(video_id,chunk_id,quote,stance,rationale,attribution,status,created_at) VALUES(?,?,?,'bullish','outlook','channel','reviewed',?)",
        )
        .run(c.video_id, c.id, c.text, now()).lastInsertRowid,
    );
    db.prepare("INSERT INTO statement_evaluations VALUES(?,?,?)").run(
      s,
      i === 0 ? 0 : 1,
      now(),
    );
  }
  assert.equal(gate().reviewed, 15);
  assert.equal(gate().correct, 14);
  assert.equal(gate().enabled, false);
});
test("cross-site GETs are rejected before any provider call", async () => {
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../app/api/[...path]/route");
  const fetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ items: [] });
  };
  process.env.YOUTUBE_DATA_API_KEY = "synthetic-test-key";
  try {
    for (const headers of [
      { origin: "https://foreign.test" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ] as Record<string, string>[]) {
      const r = await GET(
        new NextRequest("http://127.0.0.1:3000/api/channels/search?q=expert", {
          headers: { host: "127.0.0.1:3000", ...headers },
        }),
        { params: Promise.resolve({ path: ["channels", "search"] }) },
      );
      assert.notEqual(r.status, 200);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = fetch;
    delete process.env.YOUTUBE_DATA_API_KEY;
  }
});
test("overlapping reviewed chunks are one unit and unmapped reviews are excluded", () => {
  const before = gate();
  const c = fixture(
    "auditspan00",
    Array.from(
      { length: 6 },
      (_, i) =>
        `${i + 1}\n00:${String(i).padStart(2, "0")}.000 --> 00:${String(i + 1).padStart(2, "0")}.000\nFFC passage ${i}. ${"original caption ".repeat(50)}`,
    ).join("\n\n"),
  );
  const chunks = db
    .prepare("SELECT * FROM chunks WHERE video_id=?")
    .all(c.video_id) as import("../lib/expert").Chunk[];
  assert.ok(chunks.length > 1);
  for (const [i, chunk] of chunks.entries()) {
    const id = db
      .prepare(
        "INSERT INTO statements(video_id,chunk_id,quote,stance,rationale,attribution,status,created_at) VALUES(?,?,?,'neutral','','channel','reviewed',?)",
      )
      .run(chunk.video_id, chunk.id, chunk.text, now()).lastInsertRowid;
    db.prepare("INSERT INTO statement_evaluations VALUES(?,?,?)").run(
      id,
      i === 0 ? 0 : 1,
      now(),
    );
  }
  assert.equal(gate().reviewed, before.reviewed + 1);
  assert.equal(gate().correct, before.correct);
  const p = db
    .prepare(
      "INSERT INTO passages(video_id,text) VALUES(?,'Unmapped legacy evidence')",
    )
    .run(c.video_id).lastInsertRowid;
  const id = db
    .prepare(
      "INSERT INTO opinions(video_id,passage_id,symbol,speaker,stance,rationale,quote,extracted_symbol,extracted_stance) VALUES(?,?,'FFC','Unknown','neutral','','Unmapped','FFC','neutral')",
    )
    .run(c.video_id, p).lastInsertRowid;
  db.prepare("INSERT INTO evaluations VALUES(?,1,?)").run(id, now());
  assert.equal(gate().reviewed, before.reviewed + 1);
  assert.ok(reviewEvidence().unresolved.includes(`passage:${p}`));
});
test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
