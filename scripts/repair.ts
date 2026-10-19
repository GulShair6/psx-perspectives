import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
const args = process.argv.slice(2);
if (
  args.some(
    (arg, i) =>
      !["--apply", "--preview", "--report"].includes(arg) &&
      args[i - 1] !== "--report",
  )
)
  throw new Error("Use --preview, --apply and optional --report <path>");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = resolve(
  args.includes("--report")
    ? args[args.indexOf("--report") + 1]
    : join("data/repairs", `audit-${stamp}.json`),
);
if (
  !reportPath.endsWith(".json") ||
  reportPath === resolve(process.env.PSX_DB_PATH || "data/research.sqlite")
)
  throw new Error(
    "Choose a separate .json repair report; the database is never a report destination",
  );
if (existsSync(reportPath)) {
  const previous = JSON.parse(readFileSync(reportPath, "utf8"));
  if (previous.version !== "audit-1" || previous.applied)
    throw new Error(
      "Choose a new report path; existing files and completed repair reports are preserved",
    );
}
mkdirSync(dirname(reportPath), { recursive: true });
let backup: string | undefined;
let expected: import("../lib/repair").RepairPlan | undefined;
if (args.includes("--apply")) {
  const preview = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("scripts/repair.ts"),
      "--preview",
      "--report",
      reportPath,
    ],
    { env: process.env, encoding: "utf8" },
  );
  if (preview.status !== 0)
    throw new Error(preview.stderr || "Repair preview failed");
  expected = JSON.parse(readFileSync(reportPath, "utf8"));
  const source = new Database(
    process.env.PSX_DB_PATH || join(process.cwd(), "data/research.sqlite"),
    { readonly: true, fileMustExist: true },
  );
  try {
    const lease = source
      .prepare("SELECT heartbeat FROM worker_lock WHERE id=1")
      .get() as { heartbeat: number } | undefined;
    if (
      (lease && Date.now() - lease.heartbeat < 30_000) ||
      source.prepare("SELECT 1 FROM jobs WHERE status='running'").get()
    )
      throw new Error("Stop the worker before applying repairs");
    backup = join(dirname(reportPath), `before-repair-${stamp}.sqlite`);
    await source.backup(backup);
    chmodSync(backup, 0o600);
  } finally {
    source.close();
  }
  writeFileSync(
    reportPath,
    JSON.stringify({ ...expected, backup, applied: false }, null, 2),
    { mode: 0o600 },
  );
  delete process.env.PSX_DB_READONLY;
} else process.env.PSX_DB_READONLY = "1";
const { repairPlan, applyRepair } = await import("../lib/repair");
const { db } = await import("../lib/db");
try {
  const plan = expected || repairPlan();
  if (expected) applyRepair(plan);
  writeFileSync(
    reportPath,
    JSON.stringify({ ...plan, backup, applied: !!expected }, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      applied: !!expected,
      statements: plan.statements.length,
      opinions: plan.opinions.length,
      imports: plan.imports.length,
      conflicts: plan.conflicts.length,
      missingRaw: plan.missingRaw.length,
      report: reportPath,
      backup,
    }),
  );
} finally {
  db.close();
}
