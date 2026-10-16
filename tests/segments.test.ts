import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const temp = mkdtempSync(join(tmpdir(), "psx-segments-"));
process.env.PSX_DB_PATH = join(temp, "db.sqlite");
const { db } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
const { reconstructQuote, sourceSegments } = await import("../lib/evidence");
test("quotes are reconstructed from contiguous source segments, ignoring generated text", () => {
  importTranscript({
    url: "https://www.youtube.com/watch?v=segment0001",
    title: "Fixture",
    speaker: "Unknown",
    source_id: 2,
    published_at: "2026-10-01",
    language: "mixed",
    text: "1\n00:00:05,000 --> 00:00:09,000\nFFC bullish.\n\n2\n00:00:10,000 --> 00:00:15,000\nDo not buy now.",
  });
  const chunks = db.prepare("SELECT id FROM chunks").all() as {
    id: number;
  }[];
  const segments = sourceSegments(chunks[0].id);
  const selection = {
    chunk_id: chunks[0].id,
    start_segment_id: segments[0].id,
    end_segment_id: segments[1].id,
    quote: "Invented buy recommendation",
  };
  const result = reconstructQuote(selection, chunks);
  assert.equal(result.quote, "FFC bullish. Do not buy now.");
  assert.equal(result.start_seconds, 5);
  assert.equal(result.end_seconds, 15);
  assert.throws(() =>
    reconstructQuote(
      {
        ...selection,
        start_segment_id: segments[1].id,
        end_segment_id: segments[0].id,
      },
      chunks,
    ),
  );
  assert.throws(() =>
    reconstructQuote({ ...selection, end_segment_id: 99999 }, chunks),
  );
  assert.throws(() => reconstructQuote(selection, []));
});
test("plain transcripts keep missing timestamps; ranges cannot cross videos or segment gaps", () => {
  importTranscript({
    url: "https://www.youtube.com/watch?v=segment0002",
    title: "Fixture",
    speaker: "Unknown",
    source_id: 2,
    published_at: "2026-10-01",
    language: "en",
    text: "PPL has a conditional outlook.",
  });
  const chunks = db
    .prepare("SELECT id FROM chunks WHERE video_id='segment0002'")
    .all() as {
    id: number;
  }[];
  const segments = sourceSegments(chunks[0].id);
  const result = reconstructQuote(
    {
      chunk_id: chunks[0].id,
      start_segment_id: segments[0].id,
      end_segment_id: segments[0].id,
    },
    chunks,
  );
  assert.equal(result.start_seconds, null);
  assert.equal(result.end_seconds, null);
  const other = db
    .prepare(
      "SELECT id FROM caption_segments WHERE video_id='segment0001' LIMIT 1",
    )
    .get() as {
    id: number;
  };
  assert.throws(() =>
    reconstructQuote(
      {
        chunk_id: chunks[0].id,
        start_segment_id: other.id,
        end_segment_id: segments[0].id,
      },
      chunks,
    ),
  );
  db.prepare(
    "UPDATE caption_segments SET ordinal=4 WHERE video_id='segment0001' AND ordinal=1",
  ).run();
  const c = db
    .prepare("SELECT id FROM chunks WHERE video_id='segment0001'")
    .get() as {
    id: number;
  };
  const ss = sourceSegments(c.id);
  assert.throws(
    () =>
      reconstructQuote(
        {
          chunk_id: c.id,
          start_segment_id: ss[0].id,
          end_segment_id: ss[1].id,
        },
        [c],
      ),
    /contiguous/,
  );
});
test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
