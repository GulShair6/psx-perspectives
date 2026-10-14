import { db, now } from "./db";
import { fetchText } from "./sources";
export function normalize(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export type Segment = {
  text: string;
  start_seconds: number | null;
  end_seconds?: number | null;
};
export function indexVideo(
  id: string,
  segments?: Segment[],
  language = "unknown",
  provenance = "legacy import",
) {
  db.transaction(() => {
    const video = db
      .prepare("SELECT title,caption_attempted_at FROM videos WHERE id=?")
      .get(id) as {
      title: string;
      caption_attempted_at: string | null;
    };
    for (const c of db
      .prepare(
        "SELECT id,text FROM chunks WHERE video_id=? AND metadata_indexed=0",
      )
      .all(id) as { id: number; text: string }[])
      db.prepare(
        "UPDATE chunks SET searchable=?,metadata_indexed=1 WHERE id=?",
      ).run(normalize(c.text + " " + video.title), c.id);
    if (db.prepare("SELECT 1 FROM chunks WHERE video_id=?").get(id)) return;
    if (
      !db.prepare("SELECT 1 FROM caption_segments WHERE video_id=?").get(id)
    ) {
      const original =
        segments ||
        (db
          .prepare(
            "SELECT text,start_seconds FROM passages WHERE video_id=? ORDER BY id",
          )
          .all(id) as Segment[]);
      original.forEach((s, i) =>
        db
          .prepare(
            "INSERT INTO caption_segments(video_id,ordinal,text,start_seconds,end_seconds,language,provenance,retrieved_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            i,
            s.text,
            s.start_seconds,
            s.end_seconds ?? null,
            language,
            provenance,
            segments ? now() : video.caption_attempted_at || "",
          ),
      );
    }
    const saved = db
      .prepare(
        "SELECT * FROM caption_segments WHERE video_id=? ORDER BY ordinal",
      )
      .all(id) as (Segment & { id: number })[];
    let ordinal = 0;
    for (let i = 0; i < saved.length;) {
      let end = i,
        size = 0;
      while (end < saved.length && (size < 1400 || end === i)) {
        size += saved[end].text.length + 1;
        end++;
      }
      const parts = saved.slice(i, end),
        text = parts.map((s) => s.text).join(" ");
      const chunk = Number(
        db
          .prepare(
            "INSERT INTO chunks(video_id,ordinal,text,searchable,start_seconds,end_seconds,metadata_indexed) VALUES(?,?,?,?,?,?,1)",
          )
          .run(
            id,
            ordinal++,
            text,
            normalize(text + " " + video.title),
            parts[0].start_seconds,
            parts.at(-1)?.end_seconds ?? null,
          ).lastInsertRowid,
      );
      for (const s of parts)
        db.prepare("INSERT INTO chunk_segments VALUES(?,?)").run(chunk, s.id);
      i = end === saved.length ? end : Math.max(i + 1, end - 2);
    }
  }).immediate();
}
export function windowBounds(since: string, until: string) {
  return [since + "T00:00:00+05:00", until + "T23:59:59.999+05:00"].map((v) =>
    new Date(v).toISOString(),
  );
}
export function catalog() {
  return db.prepare("SELECT * FROM stock_catalog ORDER BY symbol").all() as {
    symbol: string;
    name: string;
    aliases: string;
    verified_at: string | null;
  }[];
}
export async function refreshCatalog() {
  const html = await fetchText("https://dps.psx.com.pk/screener");
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
  let count = 0;
  db.transaction(() => {
    for (const row of rows) {
      const match = row[0].match(
        /href="\/company\/([A-Z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/,
      );
      if (!match) continue;
      const cells = [...row[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
        (m) =>
          m[1]
            .replace(/<[^>]*>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/\s+/g, " ")
            .trim(),
      );
      const name = (
        row[0].match(/data-title="([^"]+)"/)?.[1] ||
        cells.find((c) => c !== match[1] && c.length > 4 && /[a-z]/.test(c)) ||
        match[1]
      )
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '\"')
        .replace(/&#039;/g, "'");
      db.prepare(
        "INSERT INTO stock_catalog(symbol,name,source_url,verified_at) VALUES(?,?,'https://dps.psx.com.pk/screener',?) ON CONFLICT(symbol) DO UPDATE SET name=CASE WHEN excluded.name=excluded.symbol THEN stock_catalog.name ELSE excluded.name END,verified_at=excluded.verified_at",
      ).run(match[1], name, now());
      count++;
    }
    if (!count)
      throw new Error(
        "PSX catalog parser found no symbols; cached catalog preserved",
      );
    db.prepare("UPDATE pipeline_state SET catalog_checked_at=? WHERE id=1").run(
      now(),
    );
  }).immediate();
  return `${count} official PSX symbols saved`;
}

export function aliasMatches(text: string, alias: string) {
  const a = normalize(alias),
    t = normalize(text);
  if (!a) return false;
  if (/^[a-z0-9-]+$/.test(a))
    return new RegExp(
      `(?<![a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`,
      "u",
    ).test(t);
  return t.includes(a);
}
export function literalTerms(question: string, symbols: string[] = []) {
  const terms = [...question.matchAll(/[\p{L}\p{N}][\p{L}\p{N}.-]{1,50}/gu)]
    .map((m) => normalize(m[0]))
    .filter(
      (t) =>
        ![
          "what",
          "said",
          "about",
          "their",
          "does",
          "have",
          "with",
          "which",
          "that",
          "this",
          "were",
          "been",
          "they",
          "when",
          "stock",
          "stocks",
          "the",
          "and",
          "for",
          "کیا",
          "کے",
          "کی",
          "کا",
          "ہے",
          "نے",
          "میں",
          "اور",
        ].includes(t),
    );
  for (const s of catalog())
    if (
      symbols.includes(s.symbol) ||
      [s.symbol, s.name, ...JSON.parse(s.aliases)].some((a) =>
        aliasMatches(question, a),
      )
    )
      terms.push(s.symbol, s.name, ...JSON.parse(s.aliases));
  return [...new Set(terms.map(normalize))].slice(0, 40);
}
