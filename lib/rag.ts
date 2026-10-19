import { z } from "zod";
import { db, companies } from "./db";
import {
  catalog,
  normalize,
  aliasMatches,
  literalTerms,
  windowBounds,
} from "./knowledge";
import { activeStatementSql } from "./evidence";
import { LOCAL_REVISION, LOCAL_VERSION } from "./local-runtime";
import type { Chunk, ExpertRequest, ExpertEvidence } from "./expert";
const planSchema = z
  .object({
    intent: z.enum(["stock", "chronology", "comparison", "overview"]),
    symbols: z.array(z.string()).max(20),
    phrases: z.array(z.string().trim().min(1).max(70)).max(8),
  })
  .strict();
export type QueryPlan = z.infer<typeof planSchema>;
export function literalPlan(p: ExpertRequest): QueryPlan {
  const q = normalize(p.question);
  const symbols = p.symbols.length
    ? p.symbols
    : catalog()
        .filter((s) =>
          [s.symbol, s.name, ...JSON.parse(s.aliases)].some((a) =>
            aliasMatches(q, a),
          ),
        )
        .map((s) => s.symbol);
  const intent = /chang|earlier|before|پہلے|تبدیل|pehle|badal/.test(q)
    ? "chronology"
    : /compar|disagree|different channels|مختلف|اختلاف|compare|farq/.test(q)
      ? "comparison"
      : !symbols.length &&
          /overview|market|مارکیٹ|بازار|outlook|stocks|حصص/.test(q)
        ? "overview"
        : "stock";
  return { intent, symbols: symbols.slice(0, 20), phrases: [] };
}
const selectChunks =
  "SELECT c.*,v.title,v.url,v.published_at,v.source_id,s.name channel FROM chunks c JOIN videos v ON v.id=c.video_id JOIN sources s ON s.id=v.source_id";
const quoted = (terms: string[]) =>
  [...new Set(terms.map(normalize).filter(Boolean))]
    .map((t) => '"' + t.replace(/"/g, '""') + '"')
    .join(" OR ");
function overlapping(a: Chunk, b: Chunk) {
  if (a.video_id !== b.video_id) return false;
  if (normalize(a.text) === normalize(b.text)) return true;
  if (
    a.start_seconds === null ||
    b.start_seconds === null ||
    a.end_seconds === null ||
    b.end_seconds === null
  )
    return false;
  const shorter = Math.min(
    a.end_seconds - a.start_seconds,
    b.end_seconds - b.start_seconds,
  );
  return (
    shorter > 0 &&
    (Math.min(a.end_seconds, b.end_seconds) -
      Math.max(a.start_seconds, b.start_seconds)) /
      shorter >
      0.8
  );
}
const translatedMatch = `EXISTS(SELECT 1 FROM english_translation_search JOIN local_translation_blocks b ON b.chunk_id=english_translation_search.rowid WHERE b.chunk_id=c.id AND b.transcript_hash=v.content_hash AND b.target='en' AND b.revision='${LOCAL_REVISION}' AND b.version='${LOCAL_VERSION}' AND english_translation_search MATCH ?)`;
function scoped(p: ExpertRequest, plan: QueryPlan) {
  const [start, end] = windowBounds(p.since, p.until);
  const args: unknown[] = [...p.channelIds, start, end];
  let where = `v.source_id IN (${p.channelIds.map(() => "?").join(",")}) AND julianday(v.published_at)>=julianday(?) AND julianday(v.published_at)<=julianday(?)`;
  if (plan.symbols.length) {
    const aliases = plan.symbols.flatMap((symbol) => {
      const stock = catalog().find((s) => s.symbol === symbol);
      return stock
        ? [symbol, stock.name, ...JSON.parse(stock.aliases)]
        : [symbol];
    });
    where += ` AND (EXISTS(SELECT 1 FROM chunk_search WHERE rowid=c.id AND chunk_search MATCH ?) OR ${translatedMatch} OR EXISTS(SELECT 1 FROM statements st JOIN statement_stocks ss ON ss.statement_id=st.id WHERE st.chunk_id=c.id AND ${activeStatementSql} AND ss.symbol IN (${plan.symbols.map(() => "?").join(",")})))`;
    args.push(quoted(aliases), quoted(aliases), ...plan.symbols);
  }
  if (p.topics.length) {
    where += ` AND (EXISTS(SELECT 1 FROM chunk_search WHERE rowid=c.id AND chunk_search MATCH ?) OR ${translatedMatch} OR EXISTS(SELECT 1 FROM statements st JOIN statement_topics t ON t.statement_id=st.id WHERE st.chunk_id=c.id AND ${activeStatementSql} AND t.topic IN (${p.topics.map(() => "?").join(",")})))`;
    args.push(quoted(p.topics), quoted(p.topics), ...p.topics.map(normalize));
  }
  return { where, args };
}
function diverse(rows: Chunk[]) {
  const result: Chunk[] = [];
  const counts = new Map<string, number>();
  const channels = new Set<number>();
  const add = (c: Chunk) => {
    if (!result.some((r) => r.id === c.id)) {
      result.push(c);
      counts.set(c.video_id, (counts.get(c.video_id) || 0) + 1);
    }
  };
  for (const c of rows)
    if (!channels.has(c.source_id)) {
      channels.add(c.source_id);
      add(c);
    }
  for (const c of rows) if ((counts.get(c.video_id) || 0) < 3) add(c);
  rows.forEach(add);
  return result;
}
export function retrieveCandidates(p: ExpertRequest, plan: QueryPlan) {
  const { where, args } = scoped(p, plan);
  const match = quoted([
    ...literalTerms(p.question, plan.symbols),
    ...plan.phrases,
    ...p.topics,
  ]);
  const lexical = match
    ? (db
        .prepare(
          `${selectChunks} JOIN chunk_search f ON f.rowid=c.id WHERE ${where} AND chunk_search MATCH ? ORDER BY bm25(chunk_search),v.published_at DESC,c.id LIMIT 81`,
        )
        .all(...args, match) as Chunk[])
    : [];
  const translated = match
    ? (db
        .prepare(
          `${selectChunks} JOIN english_translation_search ON english_translation_search.rowid=c.id WHERE ${where} AND ${translatedMatch} ORDER BY bm25(english_translation_search),v.published_at DESC,c.id LIMIT 81`,
        )
        .all(...args, match) as Chunk[])
    : [];
  const structured = db
    .prepare(
      `${selectChunks} WHERE ${where} AND EXISTS(SELECT 1 FROM statements st WHERE st.chunk_id=c.id AND ${activeStatementSql}) ORDER BY v.published_at DESC,c.id LIMIT 81`,
    )
    .all(...args) as Chunk[];
  const seeds: Chunk[] = [];
  if (plan.intent === "overview") {
    for (const source of p.channelIds) {
      const rows = db
        .prepare(
          `${selectChunks} WHERE ${where} AND v.source_id=? ORDER BY v.published_at DESC,c.ordinal LIMIT 4`,
        )
        .all(...args, source) as Chunk[];
      seeds.push(...rows);
    }
    // One latest supported passage per stock and channel gives overview breadth.
    const rows = db
      .prepare(
        `WITH ranked AS (SELECT c.id,ROW_NUMBER() OVER(PARTITION BY ss.symbol,v.source_id ORDER BY v.published_at DESC,st.id DESC) position FROM chunks c JOIN videos v ON v.id=c.video_id JOIN statements st ON st.chunk_id=c.id JOIN statement_stocks ss ON ss.statement_id=st.id WHERE ${where} AND ${activeStatementSql}) ${selectChunks} WHERE c.id IN (SELECT id FROM ranked WHERE position=1) ORDER BY v.published_at DESC LIMIT 81`,
      )
      .all(...args) as Chunk[];
    seeds.unshift(...rows);
  }
  const required: number[] = [];
  if (plan.intent === "chronology" || plan.intent === "comparison") {
    for (const symbol of plan.symbols.length ? plan.symbols : [null]) {
      for (const source of p.channelIds) {
        const extra = symbol
          ? ` AND (EXISTS(SELECT 1 FROM chunk_search WHERE rowid=c.id AND chunk_search MATCH ?) OR ${translatedMatch})`
          : "";
        const stock = catalog().find((s) => s.symbol === symbol);
        const stockMatch = symbol
          ? quoted([
              symbol,
              stock?.name || symbol,
              ...JSON.parse(stock?.aliases || "[]"),
            ])
          : null;
        const pair: Chunk[] = [];
        for (const direction of plan.intent === "chronology"
          ? ["ASC", "DESC"]
          : ["DESC"]) {
          const row = db
            .prepare(
              `${selectChunks} WHERE ${where} AND v.source_id=? ${extra} ORDER BY v.published_at ${direction},c.ordinal LIMIT 1`,
            )
            .get(
              ...args,
              source,
              ...(stockMatch ? [stockMatch, stockMatch] : []),
            ) as Chunk | undefined;
          if (row) pair.push(row);
        }
        if (
          plan.intent !== "chronology" ||
          (pair.length === 2 && pair[0].published_at !== pair[1].published_at)
        ) {
          seeds.push(...pair);
          required.push(...pair.map((c) => c.id));
        }
      }
    }
  }
  const scores = new Map<
    number,
    {
      row: Chunk;
      score: number;
    }
  >();
  for (const list of [lexical, translated, structured, seeds])
    list.forEach((row, i) => {
      const old = scores.get(row.id);
      scores.set(row.id, { row, score: (old?.score || 0) + 1 / (60 + i + 1) });
    });
  let rows = diverse(
    [...scores.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.row.published_at.localeCompare(a.row.published_at),
      )
      .map((r) => r.row),
  );
  const allRequired = [...new Set(required)];
  const must = allRequired.slice(0, 12);
  rows = [
    ...must
      .map((id) => rows.find((c) => c.id === id))
      .filter((c): c is Chunk => !!c),
    ...rows.filter((c) => !must.includes(c.id)),
  ];
  const truncated =
    rows.length > 80 ||
    allRequired.length > 12 ||
    lexical.length > 80 ||
    translated.length > 80 ||
    structured.length > 80;
  const seen: Chunk[] = [];
  rows = rows.slice(0, 80).filter((c) => {
    if (seen.some((other) => overlapping(c, other)) && !must.includes(c.id))
      return false;
    seen.push(c);
    return true;
  });
  return { candidates: rows, required: must, truncated };
}
function chunkEvidence(c: Chunk): ExpertEvidence {
  return {
    id: `chunk:${c.id}`,
    text: c.text,
    url: c.url,
    date: c.published_at,
    start_seconds: c.start_seconds,
    end_seconds: c.end_seconds,
    channel: c.channel,
    title: c.title,
    kind: "transcript",
    review: "Original captions; AI interpretation unreviewed",
    video_id: c.video_id,
  };
}
export function assembleEvidence(
  p: ExpertRequest,
  plan: QueryPlan,
  ids: number[],
  required: number[],
) {
  const { where, args } = scoped(p, plan);
  const ordered = [...new Set([...required, ...ids])].slice(0, 12);
  const primary = ordered
    .map(
      (id) =>
        db
          .prepare(`${selectChunks} WHERE ${where} AND c.id=?`)
          .get(...args, id) as Chunk | undefined,
    )
    .filter((c): c is Chunk => !!c);
  const evidence: ExpertEvidence[] = [];
  let truncated = ordered.length < new Set([...required, ...ids]).size;
  const add = (e: ExpertEvidence) => {
    if (evidence.some((old) => old.id === e.id)) return;
    if (Buffer.byteLength(JSON.stringify([...evidence, e])) > 50000) {
      truncated = true;
      return;
    }
    evidence.push(e);
  };
  primary.forEach((c) => add(chunkEvidence(c)));
  if (primary.length) {
    const selected = primary.map((c) => c.id);
    const statements = db
      .prepare(
        `SELECT st.*,(SELECT group_concat(symbol) FROM statement_stocks WHERE statement_id=st.id) symbols,v.url,v.title,v.published_at,s.name channel FROM statements st JOIN videos v ON v.id=st.video_id JOIN sources s ON s.id=v.source_id JOIN chunks c ON c.id=st.chunk_id WHERE ${where} AND ${activeStatementSql} AND st.chunk_id IN (${selected.map(() => "?").join(",")}) ${plan.symbols.length ? `AND EXISTS(SELECT 1 FROM statement_stocks ss WHERE ss.statement_id=st.id AND ss.symbol IN (${plan.symbols.map(() => "?").join(",")}))` : ""} ${p.topics.length ? `AND EXISTS(SELECT 1 FROM statement_topics t WHERE t.statement_id=st.id AND t.topic IN (${p.topics.map(() => "?").join(",")}))` : ""} ORDER BY st.status='reviewed' DESC,v.published_at DESC LIMIT 40`,
      )
      .all(
        ...args,
        ...selected,
        ...plan.symbols,
        ...p.topics.map(normalize),
      ) as {
      id: number;
      chunk_id: number;
      symbols: string | null;
      quote: string;
      stance: string;
      action: string | null;
      rationale: string;
      target: string | null;
      horizon: string | null;
      speaker: string | null;
      status: string;
      original_payload: string | null;
      video_id: string;
      url: string;
      title: string;
      published_at: string;
      channel: string;
      start_seconds: number | null;
      end_seconds: number | null;
    }[];
    for (const st of statements) {
      const parent = evidence.find((e) => e.id === `chunk:${st.chunk_id}`);
      if (parent) {
        if (st.status === "reviewed")
          parent.review = "Original captions; reviewed statement";
        // Attach structured context to the original citation without duplicating its quote.
        const symbols = st.symbols?.split(",") || [];
        const detail = {
          symbols,
          stance: st.stance,
          explicitAction: st.action,
          rationale: st.rationale,
          historicalTarget: st.target,
          explicitHorizon: st.horizon,
          speaker: st.speaker,
          hypothetical: st.original_payload
            ? (JSON.parse(st.original_payload).hypothetical ?? null)
            : null,
          review: st.status,
        };
        parent.statements ??= [];
        parent.statements.push(detail);
        if (Buffer.byteLength(JSON.stringify(evidence)) > 50000) {
          parent.statements.pop();
          truncated = true;
        }
      }
    }
    for (const c of primary.slice(0, 5)) {
      const neighbors = db
        .prepare(
          `${selectChunks} WHERE ${where} AND c.video_id=? AND abs(c.ordinal-(SELECT ordinal FROM chunks WHERE id=?))=1 ORDER BY c.ordinal`,
        )
        .all(...args, c.video_id, c.id) as Chunk[];
      neighbors
        .filter((c) => !primary.some((other) => overlapping(c, other)))
        .forEach((c) => add(chunkEvidence(c)));
    }
    const [start, end] = windowBounds(p.since, p.until);
    const argsOpinions: unknown[] = [...p.channelIds, start, end];
    let filter = "";
    if (plan.symbols.length) {
      filter += ` AND o.symbol IN (${plan.symbols.map(() => "?").join(",")})`;
      argsOpinions.push(...plan.symbols);
    }
    if (p.topics.length) {
      filter +=
        " AND (" +
        p.topics.map(() => "instr(LOWER(o.quote),?)>0").join(" OR ") +
        ")";
      argsOpinions.push(...p.topics.map(normalize));
    }
    const opinions = db
      .prepare(
        `SELECT o.*,v.url,v.title,v.published_at,v.source_id,p.start_seconds,s.name channel FROM opinions o JOIN videos v ON v.id=o.video_id JOIN passages p ON p.id=o.passage_id JOIN sources s ON s.id=v.source_id WHERE v.source_id IN (${p.channelIds.map(() => "?").join(",")}) AND julianday(v.published_at)>=julianday(?) AND julianday(v.published_at)<=julianday(?) AND o.status='approved' AND o.hypothetical=0 ${filter} ORDER BY v.published_at DESC LIMIT 8`,
      )
      .all(...argsOpinions) as {
      id: number;
      quote: string;
      symbol: string;
      speaker: string;
      stance: string;
      video_id: string;
      url: string;
      title: string;
      published_at: string;
      channel: string;
      start_seconds: number | null;
    }[];
    for (const o of opinions) {
      if (
        !plan.symbols.length &&
        !primary.some((c) => c.video_id === o.video_id)
      )
        continue;
      const parent = evidence.find(
        (e) => e.video_id === o.video_id && e.text.includes(o.quote),
      );
      if (parent) {
        parent.review = "Original captions; approved opinion";
        const previous = parent.statements;
        parent.statements = [
          ...(previous || []).filter(
            (s) => s.review === "reviewed" || !s.symbols.includes(o.symbol),
          ),
          {
            symbols: [o.symbol],
            stance: o.stance,
            explicitAction: null,
            rationale: "Human-approved opinion",
            historicalTarget: null,
            explicitHorizon: null,
            speaker: o.speaker,
            hypothetical: false,
            review: "reviewed",
          },
        ];
        if (Buffer.byteLength(JSON.stringify(evidence)) > 50_000) {
          parent.statements = previous;
          truncated = true;
        }
        continue;
      }
      add({
        id: `opinion:${o.id}`,
        text: JSON.stringify({
          quote: o.quote,
          symbol: o.symbol,
          speaker: o.speaker,
          stance: o.stance,
        }),
        url: o.url,
        date: o.published_at,
        start_seconds: o.start_seconds,
        end_seconds: null,
        channel: o.channel,
        title: o.title,
        kind: "transcript",
        review: "Human-approved opinion",
        video_id: o.video_id,
      });
    }
  }
  if (p.mode === "combined")
    for (const c of companies().filter(
      (c) => plan.symbols.includes(c.symbol) && c.snapshot,
    ))
      add({
        id: `company:${c.symbol}`,
        text: JSON.stringify(c.snapshot),
        url: c.source_url!,
        date: c.retrieved_at!,
        start_seconds: null,
        end_seconds: null,
        channel: "Official PSX",
        title: c.symbol,
        kind: "company",
        review: "Official company observations; retrieval date is separate",
      });
  return { evidence, truncated };
}
