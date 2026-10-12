import { db, now } from "./db";
export const LIMIT = 10_000_000;
export function month(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
  }).format(date);
}
export function budget() {
  const used = (
    db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN status='settled' THEN actual_micro ELSE reserved_micro END),0) used FROM usage WHERE month=? AND status!='released'",
      )
      .get(month()) as { used: number }
  ).used;
  return {
    limit: 10,
    used: used / 1e6,
    remaining: Math.max(0, LIMIT - used) / 1e6,
  };
}
export function reserve(purpose: string, micro: number) {
  if (!Number.isSafeInteger(micro) || micro <= 0)
    throw new Error("Invalid budget reservation");
  return db
    .transaction(() => {
      const used = Math.round(budget().used * 1e6);
      if (used + micro > LIMIT)
        throw new Error(
          "Monthly $10 AI budget reached. Cached research remains available.",
        );
      return Number(
        db
          .prepare(
            "INSERT INTO usage(month,purpose,reserved_micro,created_at) VALUES(?,?,?,?)",
          )
          .run(month(), purpose, micro, now()).lastInsertRowid,
      );
    })
    .immediate();
}
export function settle(id: number, input: number, output: number) {
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0
  )
    throw new Error("Invalid AI usage");
  const actual = Math.ceil(input * 0.4 + output * 1.6);
  const r = db
    .prepare(
      "UPDATE usage SET actual_micro=?,status='settled' WHERE id=? AND status='reserved'",
    )
    .run(actual, id);
  if (!r.changes) throw new Error("Reservation already settled or missing");
}
export function release(id: number) {
  db.prepare(
    "UPDATE usage SET status='released' WHERE id=? AND status='reserved'",
  ).run(id);
}
