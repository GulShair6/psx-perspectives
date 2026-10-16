import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { db, now } from "../lib/db";
import questions from "../tests/expert-research-questions.json";
import { today, sixMonthsAgo } from "../lib/time";
import { normalize } from "../lib/knowledge";
import { expertChatSchema } from "../lib/expert";
import { literalPlan, retrieveCandidates, assembleEvidence } from "../lib/rag";
import { englishQuestion, translationQuality } from "../lib/local-translations";
import { machineFingerprint, archiveReadiness } from "../lib/local-preparation";
import {
  localDirectory,
  localReadiness,
  localRequest,
  sourceHash,
  sourceLanguage,
  validateLocalBlocks,
  LOCAL_REVISION,
  LOCAL_VERSION,
} from "../lib/local-runtime";
mkdirSync(localDirectory, { recursive: true });
const file = (name: string) => join(localDirectory, name);
const save = (name: string, value: unknown) =>
  writeFileSync(file(name), JSON.stringify(value, null, 2) + "\n");
const mode = process.argv[2] || "status";
type Trial = {
  chunkId: number;
  sourceHash: string;
  source: string;
  language: string;
  channel: string;
  audioUrl: string;
  categories: string[];
  outputs: Record<string, unknown>;
  reviews: Record<string, unknown>;
};
function trial() {
  return JSON.parse(readFileSync(file("trial.json"), "utf8")) as Trial[];
}
async function main() {
  if (mode === "status") {
    console.log(
      JSON.stringify(
        {
          runtime: localReadiness(),
          english: translationQuality("en"),
          urdu: translationQuality("ur"),
          archiveEnabled: archiveReadiness(),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (mode === "sample") {
    if (existsSync(file("trial.json")))
      throw new Error(
        "A trial already exists. Keep its outputs and reviews; move it aside deliberately before collecting a new trial.",
      );
    const rows = db
      .prepare(
        "SELECT c.id chunkId,c.text source,c.start_seconds,v.language,v.url,s.name channel FROM chunks c JOIN videos v ON v.id=c.video_id JOIN sources s ON s.id=v.source_id WHERE c.start_seconds IS NOT NULL AND length(c.text)>200 ORDER BY v.published_at DESC,c.ordinal",
      )
      .all() as {
      chunkId: number;
      source: string;
      start_seconds: number;
      language: string;
      url: string;
      channel: string;
    }[];
    const pools = new Map<string, typeof rows>();
    for (const r of rows) {
      try {
        sourceLanguage(r.source, r.language);
      } catch {
        continue;
      }
      pools.set(r.channel, [...(pools.get(r.channel) || []), r]);
    }
    const selected: typeof rows = [];
    // Round-robin channels and prefer captions containing figures and conditional/negative language.
    for (const pool of pools.values())
      pool.sort((a, b) => score(b.source) - score(a.source));
    while (selected.length < 30) {
      let added = false;
      for (const pool of pools.values()) {
        const r = pool.shift();
        if (r && selected.length < 30) {
          selected.push(r);
          added = true;
        }
      }
      if (!added) break;
    }
    if (
      selected.length !== 30 ||
      new Set(selected.map((r) => r.channel)).size < 3
    )
      throw new Error(
        "Need thirty timed passages from at least three saved channels",
      );
    const result = selected.map((r) => ({
      chunkId: r.chunkId,
      sourceHash: sourceHash(r.source),
      source: r.source,
      language: r.language,
      channel: r.channel,
      audioUrl:
        r.url +
        (r.url.includes("?") ? "&" : "?") +
        "t=" +
        Math.floor(r.start_seconds) +
        "s",
      categories: [
        /\d/u.test(r.source) ? "figures" : "no figures",
        /[A-Za-z]/.test(r.source) ? "code mixing/names" : "Indic script",
        /نہ|نہیں|نہيں|नहीं|मत|not|avoid/i.test(r.source)
          ? "negation candidate"
          : "check negation against audio",
        /اگر|यदि|अगर|if\b/i.test(r.source)
          ? "conditional candidate"
          : "check conditions against audio",
        "Human must identify genuine Hindi versus Hindi-labelled Urdu/Hindustani",
      ],
      outputs: {},
      reviews: {},
    }));
    save("trial.json", result);
    console.log(
      "Saved thirty real audio-linked passages. Language categories and translations still need independent review.",
    );
    return;
  }
  if (mode === "benchmark") {
    if (!localReadiness().ready) throw new Error(localReadiness().reason!);
    const samples = trial(),
      timings: {
        chunkId: number;
        target: string;
        seconds: number;
        cold?: number;
        warm?: number;
      }[] = [];
    let failures = 0,
      peakRssMiB = 0,
      appLatencyMs = 0,
      englishSeconds = 0,
      englishChars = 0;
    for (const target of ["en", "ur"] as const) {
      await localRequest({ operation: "reset" });
      for (const sample of samples) {
        const language = sourceLanguage(sample.source, sample.language);
        try {
          const start = performance.now();
          let processing = true;
          const inference = localRequest({
            source: language,
            target,
            blocks: [{ id: sample.chunkId, text: sample.source }],
          }).finally(() => {
            processing = false;
          });
          const latency = (async () => {
            while (processing) {
              await new Promise((resolve) => setTimeout(resolve, 250));
              const t = performance.now();
              const r = await fetch("http://127.0.0.1:3000/api/state", {
                signal: AbortSignal.timeout(5000),
              });
              if (!r.ok)
                throw new Error("Local app did not respond during inference");
              await r.arrayBuffer();
              appLatencyMs = Math.max(appLatencyMs, performance.now() - t);
            }
          })();
          const [response] = await Promise.all([inference, latency]);
          const raw = response as { blocks: unknown; peakRssMiB: number };
          const blocks = validateLocalBlocks(
              [{ id: sample.chunkId, text: sample.source }],
              raw.blocks,
            ),
            seconds = (performance.now() - start) / 1000;
          sample.outputs[target] = {
            text: blocks[0].text,
            revision: LOCAL_REVISION,
            version: LOCAL_VERSION,
          };
          let warm: number | undefined;
          if (!timings.some((t) => t.target === target)) {
            const t = performance.now();
            await localRequest({
              source: language,
              target,
              blocks: [{ id: sample.chunkId, text: sample.source }],
            });
            warm = (performance.now() - t) / 1000;
          }
          timings.push({
            chunkId: sample.chunkId,
            target,
            seconds,
            ...(warm === undefined ? {} : { cold: seconds, warm }),
          });
          peakRssMiB = Math.max(peakRssMiB, raw.peakRssMiB);
          if (target === "en") {
            englishSeconds += seconds;
            englishChars += sample.source.length;
          }
        } catch (e) {
          failures++;
          sample.outputs[target] = { error: (e as Error).message };
        }
        save("trial.json", samples);
      }
    }
    const videos = db
      .prepare(
        "SELECT SUM(length(text)) chars FROM chunks GROUP BY video_id ORDER BY chars",
      )
      .all() as { chars: number }[];
    const dailyChars = 10 * (videos[Math.floor(videos.length / 2)]?.chars || 0);
    save("benchmark.json", {
      revision: LOCAL_REVISION,
      version: LOCAL_VERSION,
      machine: machineFingerprint(),
      createdAt: now(),
      samples: samples.length,
      failures,
      peakRssMiB,
      appLatencyMs,
      expectedDailySeconds: englishChars
        ? (englishSeconds / englishChars) * dailyChars
        : null,
      expectedDailyChars: dailyChars,
      timings,
    });
    console.log(
      "Benchmark saved. Review the audio-linked Urdu and English outputs before enabling preferred Urdu or archive preparation.",
    );
    return;
  }
  if (mode === "import-reviews") {
    const review = z
      .object({
        reviewer: z.string().trim().min(1),
        audioChecked: z.literal(true),
        sourceKind: z.enum(["hindustani", "hindi", "english", "punjabi"]),
        cases: z
          .array(
            z.enum([
              "code-mixing",
              "company-names",
              "financial-figures",
              "negation",
              "conditional",
            ]),
          )
          .max(5),
        names: z.boolean(),
        units: z.boolean(),
        negation: z.boolean(),
        meaning: z.boolean(),
      })
      .strict();
    db.transaction(() => {
      for (const sample of trial())
        for (const target of ["ur", "en"] as const) {
          if (!sample.reviews[target]) continue;
          const r = review.parse(sample.reviews[target]),
            out = z
              .object({
                text: z.string(),
                revision: z.literal(LOCAL_REVISION),
                version: z.literal(LOCAL_VERSION),
              })
              .parse(sample.outputs[target]);
          const current = db
            .prepare(
              "SELECT c.text,v.content_hash FROM chunks c JOIN videos v ON v.id=c.video_id WHERE c.id=?",
            )
            .get(sample.chunkId) as
            { text: string; content_hash: string } | undefined;
          if (!current || sourceHash(current.text) !== sample.sourceHash)
            throw new Error("Trial source changed; collect a new sample");
          validateLocalBlocks(
            [{ id: sample.chunkId, text: current.text }],
            [{ id: sample.chunkId, text: out.text }],
          );
          // A human-labelled result is still only derived text; originals and accuracy records are untouched.
          db.prepare(
            "INSERT OR REPLACE INTO local_translation_blocks VALUES(?,?,?,?,?,?,?,?,?)",
          ).run(
            sample.chunkId,
            current.content_hash,
            sample.sourceHash,
            target,
            LOCAL_REVISION,
            LOCAL_VERSION,
            out.text,
            "local",
            now(),
          );
          if (target === "en") {
            db.prepare(
              "DELETE FROM english_translation_search WHERE rowid=?",
            ).run(sample.chunkId);
            db.prepare(
              "INSERT INTO english_translation_search(rowid,text) VALUES(?,?)",
            ).run(sample.chunkId, normalize(out.text));
          }
          db.prepare(
            "INSERT OR REPLACE INTO translation_reviews VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            sample.chunkId,
            sample.sourceHash,
            target,
            LOCAL_REVISION,
            LOCAL_VERSION,
            r.reviewer,
            1,
            Number(r.names),
            Number(r.units),
            Number(r.negation),
            Number(r.meaning),
            now(),
            r.sourceKind,
            JSON.stringify(r.cases),
          );
        }
    }).immediate();
    console.log(
      JSON.stringify({
        en: translationQuality("en"),
        ur: translationQuality("ur"),
      }),
    );
    return;
  }
  if (mode === "retrieval") {
    const channelIds = (
      db
        .prepare(
          "SELECT id FROM sources WHERE channel_id IS NOT NULL ORDER BY id LIMIT 20",
        )
        .all() as { id: number }[]
    ).map((r) => r.id);
    const original = {
      results: questions.map((q, i) => ({
        number: i + 1,
        filters: {
          question: q.question,
          channelIds,
          symbols: q.symbols,
          topics: [],
          since: sixMonthsAgo(),
          until: today(),
          mode: "transcript",
        },
      })),
    };
    if (original.results.length !== 20)
      throw new Error(
        "Expected the existing twenty-question evidence evaluation",
      );
    const results = [];
    for (const item of original.results) {
      const p = expertChatSchema.parse(item.filters),
        q = await englishQuestion(p.question),
        plan = literalPlan(p),
        pool = retrieveCandidates({ ...p, question: q.text }, plan);
      const result = assembleEvidence(
        p,
        plan,
        pool.candidates.map((c) => c.id),
        pool.required,
      );
      results.push({
        id: item.number,
        question: p.question,
        filters: p,
        evidence: result.evidence,
        reviewer: null,
        passed: null,
      });
    }
    save("retrieval-trial.json", {
      revision: LOCAL_REVISION,
      version: LOCAL_VERSION,
      createdAt: now(),
      note: "Zero synthesis calls. A human must independently label relevance, attribution and chronology. Copy completed labels to retrieval-reviews.json.",
      reviews: results,
    });
    console.log(
      "Saved the existing twenty questions with current original citations for independent labelling.",
    );
    return;
  }
  throw new Error("Use status, sample, benchmark, import-reviews or retrieval");
}
function score(text: string) {
  return (
    Number(/\d/.test(text)) +
    Number(/नहीं|मत|نہیں|نہ|not\b/i.test(text)) +
    Number(/اگر|अगर|if\b/i.test(text))
  );
}
main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
