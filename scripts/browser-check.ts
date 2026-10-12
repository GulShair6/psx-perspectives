import { chromium, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
const temp = mkdtempSync(join(tmpdir(), "psx-browser-"));
const path = join(temp, "research.sqlite");
process.env.PSX_DB_PATH = path;
delete process.env.OPENAI_API_KEY;
const { db, saveSnapshot, gate } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
// Browser fixtures do not contact external channels; scheduling is tested separately.
db.prepare("UPDATE sources SET enabled=0").run();
const existing = join(process.cwd(), "data", "research.sqlite");
if (existsSync(existing)) {
  const source = new Database(existing, { readonly: true });
  for (const row of source
    .prepare(
      "SELECT symbol,payload FROM observations WHERE id IN (SELECT MAX(id) FROM observations GROUP BY symbol)",
    )
    .all() as { symbol: string; payload: string }[])
    saveSnapshot(row.symbol, JSON.parse(row.payload));
  source.close();
}
const fixture = "zztest00001";
importTranscript({
  url: `https://www.youtube.com/watch?v=${fixture}`,
  title: "Browser test fixture — not real commentary",
  speaker: "Test speaker",
  published_at: "2026-10-01",
  text: "OGDC is discussed in this clearly labeled browser test transcript fixture. It is not an investment recommendation.",
  language: "en",
});
const passage = db
  .prepare("SELECT id FROM passages WHERE video_id=?")
  .get(fixture) as { id: number };
db.prepare(
  "INSERT INTO opinions(video_id,passage_id,symbol,speaker,stance,rationale,quote,extracted_symbol,extracted_stance) VALUES(?,?,?,?,?,?,?,?,?)",
).run(
  fixture,
  passage.id,
  "OGDC",
  "Test speaker",
  "neutral",
  "Test fixture only",
  "OGDC is discussed in this clearly labeled browser test transcript fixture.",
  "OGDC",
  "neutral",
);
const env = { ...process.env, PSX_DB_PATH: path, OPENAI_API_KEY: "" };
let logs = "";
const web = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3107",
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
const worker = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/worker.ts"],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
for (const child of [web, worker])
  for (const out of [child.stdout, child.stderr])
    out?.on("data", (b) => {
      logs += b.toString();
    });
const origin = "http://127.0.0.1:3107";
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${origin}/api/state`);
      if (r.ok) break;
    } catch {}
    if (i === 89) throw new Error(`Server not ready: ${logs}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors: string[] = [];
  let expectedApiError = false;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !expectedApiError) errors.push(m.text());
  });
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "Company scorecard" }),
  ).toBeVisible();
  for (const symbol of ["OGDC", "PPL", "FFC", "MEBL"])
    await page
      .getByRole("checkbox", { name: `Compare ${symbol}`, exact: true })
      .check();
  await expect(
    page.getByRole("heading", { name: "OGDC", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "MEBL", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add OGDC to watchlist", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Remove OGDC from watchlist",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "OGDC Oil & Gas Development Company Limited" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Annual financials" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to scorecard" }).click();
  await page
    .locator("#question")
    .fill("Compare OGDC and PPL using the saved financial data.");
  expectedApiError = true;
  await page.getByRole("button", { name: "Ask with sources" }).click();
  await expect(page.locator(".alert.danger")).toContainText("OPENAI_API_KEY");
  expectedApiError = false;
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await page
    .getByRole("button", { name: "Video library", exact: true })
    .click();
  await expect(page.getByRole("heading", {name:"Automatic caption collection"})).toBeVisible();
  await expect(page.getByText("Automatic collection paused").first()).toBeVisible();
  await page
    .getByLabel("Video URL", { exact: true })
    .fill("https://www.youtube.com/watch?v=zztest00002");
  await page
    .getByLabel("Video title", { exact: true })
    .fill("Imported browser test fixture");
  await page
    .getByLabel("Speaker", { exact: true })
    .fill("Browser fixture speaker");
  await page.getByLabel("Published on").fill("2026-10-01");
  await page
    .getByLabel("Transcript", { exact: true })
    .fill(
      "1\n00:00:03,000 --> 00:00:06,000\nOGDC is discussed for this browser test only.",
    );
  await page
    .getByRole("button", { name: "Import transcript", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Imported browser test fixture ↗" }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /^Opinion review/ }).click();
  await page
    .getByRole("button", { name: "Review passage", exact: true })
    .click();
  await page.getByLabel("Correct stance").selectOption("bearish");
  await page
    .getByLabel(
      "I checked the original passage; use my corrected company and stance as the accuracy reference",
    )
    .check();
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByText("Extraction needed correction")).toBeVisible();
  assertGate();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByLabel("Source name").fill("InvestKaar browser fixture");
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(
    page.getByText("InvestKaar browser fixture", { exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Company/).selectOption("OGDC");
  await page
    .getByLabel("Official classification date")
    .fill(new Date().toISOString().slice(0, 10));
  await page
    .getByLabel("Official PSX source URL")
    .fill("https://www.psx.com.pk/psx/");
  await page
    .getByLabel("I checked this company against the dated official source.")
    .check();
  await page.getByRole("button", { name: "Save classification" }).click();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await page.getByLabel("Filter companies").selectOption("shariah");
  await expect(page.locator(".stock-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Filter companies").selectOption("all");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  await expect((await download).suggestedFilename()).toBe("psx-research.csv");
  const rejected = await page.request.post(`${origin}/api/watchlist`, {
    headers: { origin: "https://evil.example" },
    data: { symbol: "OGDC", watched: true },
  });
  expect(rejected.status()).toBe(400);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText("Transcript imported. Add an API key to extract opinions."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  mkdirSync("data/browser-artifacts", { recursive: true });
  await page.screenshot({
    path: "data/browser-artifacts/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Company scorecard" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "data/browser-artifacts/mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "Browser checks passed: comparison, watchlist, detail, chat guard, worker import, review correction, source edit, classification filter, export, CSRF, jobs and mobile layout.",
  );
} finally {
  await browser?.close();
  for (const child of [web, worker]) {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  db.close();
  rmSync(temp, { recursive: true, force: true });
}
function assertGate() {
  expect(gate().enabled).toBe(false);
  expect(gate().reviewed).toBe(1);
  expect(gate().accuracy).toBe(0);
}
