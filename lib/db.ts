import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Company, Snapshot, Opinion } from "./types";
export const dbPath =
  process.env.PSX_DB_PATH || join(process.cwd(), "data", "research.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.exec("CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY)");
for (const name of readdirSync(join(process.cwd(), "migrations"))
  .filter((x) => x.endsWith(".sql"))
  .sort()) {
  db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM migrations WHERE name=?").get(name)) {
      db.exec(readFileSync(join(process.cwd(), "migrations", name), "utf8"));
      db.prepare("INSERT INTO migrations VALUES(?)").run(name);
    }
  }).immediate();
}
export const seeds = [
  [
    "OGDC",
    "Oil & Gas Development Company",
    ["OGDCL", "Oil and Gas Development", "او جی ڈی سی"],
  ],
  ["PPL", "Pakistan Petroleum", ["پاکستان پیٹرولیم"]],
  ["POL", "Pakistan Oilfields", ["پاکستان آئل فیلڈز"]],
  ["FFC", "Fauji Fertilizer Company", ["Fauji Fertilizer", "فوجی فرٹیلائزر"]],
  ["EFERT", "Engro Fertilizers", ["اینگرو فرٹیلائزر"]],
  ["LUCK", "Lucky Cement", ["لکی سیمنٹ"]],
  ["HUBC", "Hub Power Company", ["Hubco", "حبکو"]],
  ["MEBL", "Meezan Bank", ["Meezan", "میزان", "میزان بینک"]],
  ["MCB", "MCB Bank", ["Muslim Commercial Bank"]],
  ["SYS", "Systems Limited", ["سسٹمز لمیٹڈ"]],
] as const;
db.transaction(() => {
  for (const [symbol, name, aliases] of seeds)
    db.prepare(
      "INSERT OR IGNORE INTO companies(symbol,name,aliases) VALUES(?,?,?)",
    ).run(symbol, name, JSON.stringify(aliases));
  db.exec(
    "INSERT OR IGNORE INTO stock_catalog(symbol,name,aliases,source_url,verified_at) SELECT symbol,name,aliases,'https://dps.psx.com.pk/screener',validated_at FROM companies",
  );
  if (
    !(db.prepare("SELECT COUNT(*) n FROM sources").get() as { n: number }).n
  ) {
    for (const [name, url, channel, kind] of [
      ["InvestKaar", "https://investkaar.com/youtube", null, "expert"],
      [
        "SCS Trade",
        "https://scstrade.com/MediaGallery.aspx",
        "UCjL4aKJhoVQNRJK9vHdaWEA",
        "expert",
      ],
      [
        "Pakistan Stock Exchange",
        "https://dps.psx.com.pk/",
        "UC1ilKViIpulidQm5UL6mGTQ",
        "institutional",
      ],
    ])
      db.prepare(
        "INSERT INTO sources(name,url,channel_id,kind) VALUES(?,?,?,?)",
      ).run(name, url, channel, kind);
  }
}).immediate();
export const now = () => new Date().toISOString();
export function companies(): Company[] {
  const rows = db
    .prepare(
      `SELECT c.*,o.payload,o.retrieved_at,o.source_url,EXISTS(SELECT 1 FROM watchlist w WHERE w.symbol=c.symbol) watched FROM companies c LEFT JOIN observations o ON o.id=(SELECT MAX(id) FROM observations WHERE symbol=c.symbol) ORDER BY c.symbol`,
    )
    .all() as (Omit<Company, "aliases" | "snapshot" | "watched"> & {
    aliases: string;
    payload: string | null;
    watched: number;
  })[];
  return rows.map(({ payload, ...r }) => ({
    ...r,
    aliases: JSON.parse(r.aliases),
    snapshot: payload ? JSON.parse(payload) : null,
    watched: !!r.watched,
  }));
}
export function saveSnapshot(symbol: string, snapshot: Snapshot) {
  db.transaction(() => {
    db.prepare(
      "INSERT INTO observations(symbol,retrieved_at,source_url,payload) VALUES(?,?,?,?)",
    ).run(
      symbol,
      now(),
      `https://dps.psx.com.pk/company/${symbol}`,
      JSON.stringify(snapshot),
    );
    db.prepare(
      "UPDATE companies SET name=?,sector=?,validated_at=? WHERE symbol=?",
    ).run(snapshot.name, snapshot.sector, now(), symbol);
  }).immediate();
}
export function opinions(): Opinion[] {
  return db
    .prepare(
      `SELECT o.*,v.published_at,v.title,v.url,p.start_seconds,e.correct,COALESCE(s.kind,'expert') kind FROM opinions o JOIN videos v ON v.id=o.video_id JOIN passages p ON p.id=o.passage_id LEFT JOIN evaluations e ON e.opinion_id=o.id LEFT JOIN sources s ON s.id=v.source_id ORDER BY v.published_at DESC,o.id DESC`,
    )
    .all() as Opinion[];
}
export function gate() {
  const r = db
    .prepare(
      "SELECT COUNT(*) reviewed,COALESCE(SUM(correct),0) correct FROM (SELECT o.passage_id,MIN(e.correct) correct FROM evaluations e JOIN opinions o ON o.id=e.opinion_id GROUP BY o.passage_id UNION ALL SELECT 'statement:'||st.chunk_id,MIN(e.correct) correct FROM statement_evaluations e JOIN statements st ON st.id=e.statement_id GROUP BY st.chunk_id)",
    )
    .get() as { reviewed: number; correct: number };
  return {
    ...r,
    accuracy: r.reviewed ? r.correct / r.reviewed : 0,
    enabled: r.reviewed >= 30 && r.correct / r.reviewed >= 0.9,
  };
}
export function consensus(symbol: string, since: string) {
  if (!gate().enabled) return null;
  const latest = new Map<string, Opinion>();
  for (const o of opinions())
    if (
      o.symbol === symbol &&
      o.status === "approved" &&
      !o.hypothetical &&
      o.kind === "expert" &&
      o.published_at >= since &&
      !latest.has(o.speaker.trim().toLocaleLowerCase())
    )
      latest.set(o.speaker.trim().toLocaleLowerCase(), o);
  return {
    bullish: [...latest.values()].filter((o) => o.stance === "bullish").length,
    bearish: [...latest.values()].filter((o) => o.stance === "bearish").length,
    neutral: [...latest.values()].filter((o) => o.stance === "neutral").length,
    sample: latest.size,
  };
}
export function queue(type: string, payload: unknown) {
  const stamp = now();
  return Number(
    db
      .prepare(
        "INSERT INTO jobs(type,payload,created_at,updated_at) VALUES(?,?,?,?)",
      )
      .run(type, JSON.stringify(payload), stamp, stamp).lastInsertRowid,
  );
}
