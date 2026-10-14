import AxeBuilder from "@axe-core/playwright";
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
delete process.env.OLLAMA_API_KEY;
delete process.env.YOUTUBE_DATA_API_KEY;
const { db, saveSnapshot, gate } = await import("../lib/db");
const { importTranscript } = await import("../lib/transcripts");
// Browser fixtures do not contact external channels; scheduling is tested separately.
db.prepare("UPDATE sources SET enabled=0").run();
db.prepare("UPDATE pipeline_state SET catalog_checked_at=? WHERE id=1").run(
  new Date().toISOString(),
);
db.prepare("INSERT INTO watchlist VALUES('MCB')").run();
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
db.prepare(
  "INSERT INTO opinions(video_id,passage_id,symbol,speaker,stance,rationale,quote,extracted_symbol,extracted_stance) SELECT video_id,passage_id,symbol,'Second test speaker',stance,rationale,quote,extracted_symbol,extracted_stance FROM opinions WHERE video_id=?",
).run(fixture);
const expertFixture = "zzexpert001";
importTranscript({
  url: `https://www.youtube.com/watch?v=${expertFixture}`,
  title: "Expert browser fixture — synthetic evidence",
  speaker: "Unknown guest",
  source_id: 2,
  published_at: "2026-10-02",
  language: "en",
  text: "1\n00:00:12,000 --> 00:00:17,000\nOGDC is discussed in a browser fixture. Do not buy based on this synthetic fixture.",
});
const expertChunk = db
  .prepare("SELECT id,text FROM chunks WHERE video_id=?")
  .get(expertFixture) as { id: number; text: string };
const expertHash = (
  db
    .prepare("SELECT content_hash FROM videos WHERE id=?")
    .get(expertFixture) as { content_hash: string }
).content_hash;
db.prepare(
  "INSERT INTO analysis_runs(video_id,transcript_hash,version,status,summary,summary_evidence,updated_at) VALUES(?,?,?,'done',?,?,?)",
).run(
  expertFixture,
  expertHash,
  "expert-1",
  "The fixture discusses OGDC without an investment recommendation.",
  JSON.stringify([
    {
      chunk_id: expertChunk.id,
      quote: expertChunk.text,
      text: "Fixture discusses OGDC.",
    },
  ]),
  new Date().toISOString(),
);
db.prepare(
  "INSERT INTO statements(video_id,chunk_id,quote,stance,rationale,attribution,status,created_at,original_payload,start_seconds,end_seconds) VALUES(?,?,?,'neutral','Synthetic test fixture','channel','unreviewed',?,?,12,17)",
).run(
  expertFixture,
  expertChunk.id,
  expertChunk.text,
  new Date().toISOString(),
  JSON.stringify({
    chunk_id: expertChunk.id,
    quote: expertChunk.text,
    symbol: "OGDC",
    topic: "market",
    stance: "neutral",
    action: null,
    rationale: "Synthetic test fixture",
    target: null,
    horizon: null,
    speaker: null,
    hypothetical: false,
  }),
);
const expertStatement = Number(
  (
    db
      .prepare("SELECT id FROM statements WHERE video_id=?")
      .get(expertFixture) as { id: number }
  ).id,
);
db.prepare("INSERT INTO statement_stocks VALUES(?,'OGDC')").run(
  expertStatement,
);
const perspectiveFixture = "zzexpert002";
importTranscript({
  url: `https://www.youtube.com/watch?v=${perspectiveFixture}`,
  title: "Second perspective browser fixture — synthetic evidence",
  speaker: "Unknown guest",
  source_id: 3,
  published_at: "2026-10-03",
  language: "en",
  text: "1\n00:00:40,000 --> 00:00:45,000\nOGDC: this synthetic second-channel fixture expresses a cautious perspective. It is not investment evidence.",
});
const perspectiveHash = (
  db
    .prepare("SELECT content_hash FROM videos WHERE id=?")
    .get(perspectiveFixture) as { content_hash: string }
).content_hash;
db.prepare(
  "INSERT INTO analysis_runs(video_id,transcript_hash,version,status,updated_at) VALUES(?,?,?,'done',?)",
).run(
  perspectiveFixture,
  perspectiveHash,
  "expert-1",
  new Date().toISOString(),
);
const env = {
  ...process.env,
  PSX_DB_PATH: path,
  OPENAI_API_KEY: "",
  OLLAMA_API_KEY: "",
  YOUTUBE_DATA_API_KEY: "",
};
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const failedResponses: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failedResponses.push(r.status() + " " + r.url());
  });
  let expectedApiError = false;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !expectedApiError) errors.push(m.text());
  });
  const assertAccessible = async () => {
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact || ""),
      ),
    ).toEqual([]);
  };
  await page.goto(origin);
  await expect(page).toHaveTitle("PSX Perspectives");
  await expect(
    page.getByText("Monthly AI budget", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add Channel", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Find an expert channel" }),
  ).toBeVisible();
  await page.route("**/api/channels/search?*", (route) =>
    route.fulfill({
      json: {
        channels: [
          {
            id: "UCjL4aKJhoVQNRJK9vHdaWEA",
            name: "SCS Trade",
            handle: "@fixture",
            thumbnail: "",
            url: "https://www.youtube.com/channel/UCjL4aKJhoVQNRJK9vHdaWEA",
          },
        ],
      },
    }),
  );
  await page.route("**/api/channels/follow", (route) =>
    route.fulfill({ status: 202, json: { source_id: 2, job: 999 } }),
  );
  await assertAccessible();
  await page.getByLabel("Channel name or URL").fill("SCS Trade");
  await page
    .getByRole("button", { name: "Search channels", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and follow SCS Trade", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "SCS Trade — dated insights" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Videos", exact: true }).click();
  await page.getByText("Read cited summary", { exact: true }).click();
  await expect(
    page.getByText(
      "The fixture discusses OGDC without an investment recommendation.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview transcript", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("0:12 → 0:17");
  await expect(page.getByRole("dialog")).toContainText(
    "User-supplied transcript",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page
    .getByRole("button", { name: "Review / correct statement" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(expertChunk.text);
  await assertAccessible();
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Research questions", exact: true })
    .click();
  await page.getByRole("button", { name: "Stock", exact: true }).press("Enter");
  await assertAccessible();
  await page.getByLabel("Search stocks").fill("OGDC");
  await page.getByRole("button", { name: /OGDC/ }).press("Enter");
  await expect(page).toHaveURL(/stock=OGDC/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Stock", exact: true }),
  ).toHaveText(/OGDC/);
  await page
    .getByRole("checkbox", { name: "Ask Pakistan Stock Exchange", exact: true })
    .check();
  await page
    .getByLabel("Research question", { exact: true })
    .fill("What was said about OGDC?");
  await page
    .getByRole("button", { name: "Ask selected channels", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Retrieved passages" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".evidence-result")
      .filter({ hasText: "Pakistan Stock Exchange" }),
  ).toHaveCount(1);
  await page
    .locator(".evidence-result")
    .filter({ hasText: "SCS Trade" })
    .first()
    .click();
  await expect(
    page.getByRole("complementary", { name: "Saved evidence" }),
  ).toContainText("SCS Trade");
  await expect(
    page
      .getByRole("complementary", { name: "Saved evidence" })
      .getByRole("link", { name: "Open original source" }),
  ).toHaveAttribute("href", /t=12s/);
  await assertAccessible();
  await page.screenshot({
    path: "data/browser-artifacts/editorial-evidence.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Close preview", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "data/browser-artifacts/expert-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("h1").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "data/browser-artifacts/expert-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Company research", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Company scorecard" }),
  ).toBeVisible();
  await expect(page.getByLabel("Filter companies")).toHaveValue("watchlist");
  await expect(page.locator(".stock-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Filter companies").selectOption("all");
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
  await expect(page.getByLabel("Comparison selection")).toContainText(
    "4/4 selected",
  );
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Compare OGDC", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page
    .getByRole("button", { name: "Ask about selection", exact: true })
    .click();
  await expect(page.locator("#question")).toBeFocused();
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
  await page.getByRole("button", { name: "Dismiss chat error" }).click();
  // UI-only answer fixture; evidence validation is covered by core tests.
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      json: {
        facts: [
          {
            text: "Saved OGDC company evidence.",
            evidenceIds: ["company:OGDC"],
          },
        ],
        expertViews: [],
        interpretation: "Review source context.",
        gaps: ["Fixture only."],
        citations: [
          {
            evidenceId: "company:OGDC",
            label: "Inspect OGDC evidence",
            url: "https://dps.psx.com.pk/company/OGDC",
          },
        ],
        evidence: [
          {
            id: "company:OGDC",
            kind: "company",
            date: "2026-10-01",
            url: "https://dps.psx.com.pk/company/OGDC",
            start_seconds: null,
            text: "Saved OGDC evidence fixture.",
          },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: "Ask with sources" }).click();
  await page.getByRole("button", { name: "Inspect OGDC evidence" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Saved OGDC evidence fixture.",
  );
  await expect(
    page.getByRole("link", { name: "Open original source" }),
  ).toHaveAttribute("href", "https://dps.psx.com.pk/company/OGDC");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let failPolling = false,
    allowAnalysis = false;
  await page.route("**/api/state?*", async (route) => {
    if (failPolling)
      return route.fulfill({
        status: 503,
        json: { error: "Connection fixture" },
      });
    const response = await route.fetch();
    const data = await response.json();
    if (allowAnalysis) data.aiConfigured = true;
    await route.fulfill({ response, json: data });
  });
  expectedApiError = true;
  failPolling = true;
  await expect(
    page.getByText("Connection interrupted.", { exact: false }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".stock-table tbody tr")).toHaveCount(10);
  failPolling = false;
  await expect(
    page.getByText("Connection interrupted.", { exact: false }),
  ).toHaveCount(0, { timeout: 10000 });
  expectedApiError = false;
  await page.getByRole("button", { name: "Transcripts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Automatic caption collection" }),
  ).toBeVisible();
  await expect(
    page.getByText("Automatic collection paused").first(),
  ).toBeVisible();
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
  const imported = page
    .locator(".video")
    .filter({ hasText: "Imported browser test fixture" });
  await imported.getByRole("button", { name: "Preview transcript" }).click();
  await expect(page.getByRole("dialog")).toContainText("3s");
  await expect(page.getByRole("dialog")).toContainText(
    "OGDC is discussed for this browser test only.",
  );
  await page.keyboard.press("Escape");
  await page
    .getByLabel("Filter transcripts by status")
    .selectOption("Ready to analyze");
  await expect(page.locator(".video")).toHaveCount(1);
  // Enable the UI fixture only; server has no key and safely reports missing configuration.
  allowAnalysis = true;
  await page
    .getByRole("button", { name: "Analyze ready transcripts (1)" })
    .click({ timeout: 10000 });
  await expect(
    page.getByText("0 successful, 1 failed, 0 unprocessed", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  allowAnalysis = false;
  await page
    .getByLabel("Filter transcripts by status")
    .selectOption("Analysis failed");
  await expect(page.locator(".video")).toHaveCount(1);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Review/ })
    .click();
  await page
    .getByRole("button", { name: "Review passage", exact: true })
    .first()
    .click();
  await page.getByLabel("Correct stance").selectOption("bearish");
  await page
    .getByLabel(
      "I checked the original passage; use my corrected company and stance as the accuracy reference",
    )
    .check();
  await expect(page.getByRole("dialog").locator(".passage-text")).toContainText(
    "OGDC is discussed",
  );
  await page
    .getByRole("button", { name: "Save and next", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Speaker", { exact: true })).toHaveValue(
    "Second test speaker",
  );
  await expect(
    page.getByRole("button", { name: "Close review" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
    page.getByText(
      "Transcript indexed and searchable. Automatic insights queued when Ollama is available.",
    ),
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/state?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const sample = data.videos[0];
    data.videos = Array.from({ length: 43 }, (_, i) => ({
      ...sample,
      id: `list${String(i).padStart(7, "0")}`,
      title: `Transcript ${i + 1} — طویل عنوان / mixed-language fixture`,
      analysis_state: "Reviewed",
      pending_count: 0,
    }));
    await route.fulfill({ json: data });
  });
  await page.getByRole("button", { name: "Transcripts", exact: true }).click();
  await page.getByLabel("Filter transcripts by source").selectOption("all");
  await page.getByLabel("Filter transcripts by status").selectOption("all");
  await expect(page.locator(".video")).toHaveCount(25);
  const importer = page.getByRole("region", { name: "Transcript importer" }),
    library = page.getByRole("region", { name: "Transcript library" });
  await library.scrollIntoViewIfNeeded();
  const importerBefore = await importer.boundingBox();
  const leftScroll = await importer.evaluate((el) => el.scrollTop);
  await library.hover();
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => library.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  expect(await importer.evaluate((el) => el.scrollTop)).toBe(leftScroll);
  expect((await importer.boundingBox())?.y).toBe(importerBefore?.y);
  await page.screenshot({
    path: "data/browser-artifacts/transcript-panes.png",
    fullPage: false,
  });

  await page.getByRole("button", { name: "Next transcripts page" }).click();
  await expect(page.locator(".video")).toHaveCount(18);
  await page.getByLabel("Search transcripts").fill("Transcript 43");
  await expect(page.locator(".video")).toHaveCount(1);
  await page.getByLabel("Search transcripts").fill("");
  const sections = [
    "Research",
    "Transcripts",
    "Review",
    "Activity",
    "Settings",
  ];
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const section of sections) {
      await page.getByRole("button", { name: section, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${section} overflow at ${width}`,
      ).toBe(true);
      const result = await new AxeBuilder({ page }).analyze();
      expect(
        result.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact || ""),
        ),
        `${section} accessibility at ${width}`,
      ).toEqual([]);
    }
  }
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await page
    .getByRole("button", { name: "Expert research", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Research questions", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("h1").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "data/browser-artifacts/editorial-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: "data/browser-artifacts/editorial-mobile.png",
    fullPage: true,
  });
  expect(errors, failedResponses.join("\n")).toEqual([]);
  console.log(
    "Browser checks passed: confirmed-channel workflow (mock discovery), coverage, automatic insight fixtures, statement review, scoped raw RAG, exact transcript evidence, expert mobile layout, watchlist defaults, persisted comparison, chat guard, evidence preview, connection recovery, transcript preview/filter, batch progress, review next/keyboard, source editing, exports and mobile layout.",
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
