import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
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
const { EXTRACTION_VERSION } = await import("../lib/evidence");
// Browser fixtures do not contact external channels; scheduling is tested separately.
db.prepare("UPDATE sources SET enabled=0").run();
db.prepare("UPDATE pipeline_state SET catalog_checked_at=? WHERE id=1").run(
  new Date().toISOString(),
);
db.prepare("INSERT INTO watchlist VALUES('MCB')").run();
// Synthetic company data lives only in this disposable browser-test database.
const { parsePsx } = await import("../lib/sources");
saveSnapshot(
  "OGDC",
  parsePsx(
    '<title>OGDC - Quote</title><div class="quote__name">Oil &amp; Gas Development Company Limited — synthetic browser fixture, not market data</div><div class="quote__close">Rs.100</div><div id="financials"><div class="tabs__panel" data-name="Annual"><table><thead><tr><th></th><th>2025</th></tr></thead><tbody><tr><td>EPS</td><td>1</td></tr></tbody></table></div></div>',
    "OGDC",
  ),
);
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
  text: "1\n00:00:12,000 --> 00:00:17,000\nOGDC is discussed in a browser fixture. Do not buy based on this synthetic fixture.\n\n2\n00:00:18,000 --> 00:00:22,000\nOGDC fixture price 100.5; do not buy.",
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
  EXTRACTION_VERSION,
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
  "INSERT INTO statements(video_id,chunk_id,quote,stance,rationale,attribution,status,created_at,original_payload,start_seconds,end_seconds,analysis_version,transcript_hash) VALUES(?,?,?,'neutral','Synthetic test fixture','channel','unreviewed',?,?,12,22,?,?)",
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
  EXTRACTION_VERSION,
  expertHash,
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
  EXTRACTION_VERSION,
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
  const recoveryContext = await browser.newContext();
  const recoveryPage = await recoveryContext.newPage();
  await recoveryPage.route("**/api/state?*", (route) =>
    route.fulfill({ json: { companies: [], opinions: [], videos: [] } }),
  );
  await recoveryPage.goto(origin);
  await expect(
    recoveryPage.getByRole("heading", {
      name: "The workspace could not be displayed",
    }),
  ).toBeVisible();
  await recoveryPage.unroute("**/api/state?*");
  await recoveryPage.getByRole("button", { name: "Try again" }).click();
  await expect(
    recoveryPage.getByRole("heading", { name: "Expert perspectives" }),
  ).toBeVisible();
  await recoveryContext.close();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  // Translation UI fixtures stay inside the disposable test app; no cloud keys are loaded.
  let translationPosts = 0,
    failTranslation = false,
    translationAvailable = true,
    delayTranslationRead = true;
  const translationScopes: string[] = [];
  let ollamaPosts = 0;
  const youtubeCache = new Map<
    string,
    {
      sourceLanguage: string;
      provenance: string;
      retrievedAt: string;
      cues: {
        id: number;
        text: string;
        startSeconds: number;
        endSeconds: number;
      }[];
    }
  >();
  const translationCache = new Map<
    string,
    {
      segmentId: number;
      text: string;
      provider: string;
      model: string;
      createdAt: string;
    }
  >();
  const translationJobs = new Map<
    string,
    {
      phase: number;
      failed: boolean;
      ids: number[];
      videoId: string;
      target: string;
    }
  >();
  await page.route("**/api/translations**", async (route) => {
    const request = route.request(),
      query = new URL(request.url()).searchParams;
    const p =
      request.method() === "POST"
        ? (request.postDataJSON() as {
            videoId: string;
            target: string;
            method?: "local" | "youtube" | "ollama";
            segmentIds?: number[];
          })
        : {
            videoId: query.get("videoId")!,
            target: query.get("target")!,
            method: (query.get("method") || "local") as
              "local" | "youtube" | "ollama",
            ...(query.has("segmentIds")
              ? { segmentIds: query.get("segmentIds")!.split(",").map(Number) }
              : {}),
          };
    const segments = db
      .prepare(
        "SELECT id,text,start_seconds,end_seconds FROM caption_segments WHERE video_id=? ORDER BY ordinal",
      )
      .all(p.videoId) as {
      id: number;
      text: string;
      start_seconds: number;
      end_seconds: number;
    }[];
    const ids = segments
      .filter((s) => !p.segmentIds || p.segmentIds.includes(s.id))
      .map((s) => s.id);
    const method = p.method || "local";
    const key = JSON.stringify([
      p.videoId,
      p.target,
      method,
      ...(method === "youtube" ? [] : [ids]),
    ]);
    if (request.method() === "POST") {
      translationPosts++;
      if (method === "ollama") ollamaPosts++;
      translationScopes.push(p.segmentIds ? "passage" : "full");
      translationJobs.set(key, {
        phase: 0,
        failed: failTranslation,
        ids,
        videoId: p.videoId,
        target: p.target,
      });
      failTranslation = false;
      return route.fulfill({
        status: 202,
        json: { job: 9000 + translationPosts },
      });
    }
    if (p.segmentIds) translationScopes.push("passage-read");
    if (delayTranslationRead) {
      delayTranslationRead = false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const response = await route.fetch(),
      data = await response.json(),
      job = translationJobs.get(key);
    if (job && !job.failed && method !== "youtube") {
      const ready =
        job.phase === 0 ? [] : job.phase === 1 ? job.ids.slice(0, 1) : job.ids;
      for (const id of ready) {
        const original = segments.find((s) => s.id === id)!.text;
        translationCache.set(`${p.videoId}:${p.target}:${id}`, {
          segmentId: id,
          text:
            p.target === "ur"
              ? `یہ مصنوعی ترجمہ ہے، خریداری کی سفارش نہیں۔ ${(original.match(/\d+(?:\.\d+)*/g) || []).join(" ")}`
              : original,
          provider: "Ollama Cloud",
          model: "synthetic translation fixture",
          createdAt: new Date().toISOString(),
        });
      }
    }
    if (job && !job.failed && method === "youtube" && job.phase >= 2) {
      youtubeCache.set(key, {
        sourceLanguage: "hi",
        provenance: "YouTube auto-translation",
        retrievedAt: new Date().toISOString(),
        cues: segments.map((s, i) => ({
          id: i,
          startSeconds: s.start_seconds + 0.25,
          endSeconds: s.end_seconds - 0.25,
          text:
            p.target === "ur"
              ? "یہ مصنوعی ترجمہ ہے، خریداری کی سفارش نہیں۔ 999"
              : s.text,
        })),
      });
    }
    data.method = method;
    data.captionTrack =
      method === "youtube" ? youtubeCache.get(key) || null : null;
    data.numberWarning = method === "youtube" && !!data.captionTrack;
    data.translations = (method !== "youtube" ? ids : [])
      .map((id) => translationCache.get(`${p.videoId}:${p.target}:${id}`))
      .filter(Boolean);
    data.blocks =
      method === "local"
        ? (
            db
              .prepare(
                "SELECT DISTINCT c.id,c.start_seconds,c.end_seconds FROM chunks c JOIN chunk_segments cs ON cs.chunk_id=c.id WHERE c.video_id=? AND cs.segment_id IN (SELECT value FROM json_each(?))",
              )
              .all(p.videoId, JSON.stringify(ids)) as {
              id: number;
              start_seconds: number;
              end_seconds: number;
            }[]
          ).flatMap((c) => {
            const mapped = (
              db
                .prepare(
                  "SELECT segment_id FROM chunk_segments WHERE chunk_id=?",
                )
                .all(c.id) as { segment_id: number }[]
            ).map((r) => r.segment_id);
            const ready = mapped.map((id) =>
              translationCache.get(`${p.videoId}:${p.target}:${id}`),
            );
            return ready.every(Boolean)
              ? [
                  {
                    chunkId: c.id,
                    segmentIds: mapped,
                    text: ready.map((r) => r!.text).join(" "),
                    provider: "local",
                    createdAt: new Date().toISOString(),
                    startSeconds: c.start_seconds,
                    endSeconds: c.end_seconds,
                  },
                ]
              : [];
          })
        : [];
    data.quality = { validated: false, reviewed: 0, passed: 0, channels: 0 };
    data.complete =
      method === "youtube"
        ? !!data.captionTrack
        : data.translations.length === ids.length;
    const sourceUnavailable =
      method === "youtube" ? data.unavailableReason : null;
    data.available = translationAvailable && !sourceUnavailable;
    data.workerOnline = translationAvailable;
    data.unavailableReason =
      sourceUnavailable ||
      (translationAvailable
        ? null
        : method === "youtube"
          ? "YouTube caption retrieval is unavailable in this fixture."
          : method === "local"
            ? "Local runtime is unavailable in this fixture. Saved translations remain readable."
            : "Set OLLAMA_API_KEY to generate translations. Saved translations remain readable.");
    data.job = job
      ? {
          id: 9000,
          status: job.failed
            ? "failed"
            : job.phase === 0
              ? "queued"
              : job.phase === 1
                ? "running"
                : "done",
          progress: "Synthetic translation progress",
          error: job.failed
            ? method === "youtube"
              ? "[YoutubeTranscript] YouTube is receiving too many requests from this IP and now requires solving a captcha to continue. " +
                "long-fixture-token".repeat(30)
              : "Translation fixture failed; saved original preserved"
            : null,
        }
      : null;
    if (job) job.phase++;
    await route.fulfill({ response, json: data });
  });
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
  const home = await page.goto(origin);
  expect(home?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(home?.headers()["x-frame-options"]).toBe("DENY");
  expect(home?.headers()["referrer-policy"]).toBe("no-referrer");
  expect((await page.request.get(`${origin}/icon.svg`)).ok()).toBe(true);
  const missingPage = await page.request.get(`${origin}/missing-release-check`);
  expect(missingPage.status()).toBe(404);
  expect(await missingPage.text()).toContain("Open PSX Perspectives");
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
  await expect(
    page.getByText("1 accepted statements · 0 quarantined claims", {
      exact: true,
    }),
  ).toBeVisible();
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
  const transcript = page
    .getByRole("dialog")
    .getByRole("region", { name: "Transcript translation" });
  await transcript
    .getByRole("button", { name: "Translate to Urdu", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect.poll(() => translationPosts).toBe(1);
  await page
    .getByRole("button", { name: "Preview transcript", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Translate to Urdu", exact: true })
    .click();
  expect(translationPosts).toBe(1);
  await expect(transcript.getByRole("status")).toContainText(
    /Queued for translation|Translating|Translation completed/,
  );
  await expect(transcript.getByRole("status")).toContainText(
    "Translation completed",
    { timeout: 10000 },
  );
  await expect(
    transcript.locator('[lang="ur"][dir="rtl"]').first(),
  ).toContainText("مصنوعی ترجمہ");
  await expect(transcript).toContainText(
    "Do not buy based on this synthetic fixture.",
  );
  await expect(transcript).toContainText("Provisional translation");
  await transcript
    .getByRole("button", { name: "Try YouTube captions", exact: true })
    .click();
  await expect(transcript.getByRole("status")).toContainText(
    "YouTube captions ready",
    { timeout: 15000 },
  );
  await expect(transcript).toContainText("Numbers or their formatting differ");
  await expect(transcript).toContainText("YouTube auto-translation");
  await expect(transcript).toContainText("0:12 → 0:16");
  expect(ollamaPosts).toBe(0);
  await assertAccessible();
  await page.screenshot({
    path: "data/browser-artifacts/translation-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "data/browser-artifacts/translation-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.keyboard.press("Escape");
  const savedPosts = translationPosts;
  await page
    .getByRole("button", { name: "Preview transcript", exact: true })
    .click();
  translationAvailable = false;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Translate to Urdu", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Translation completed",
  );
  expect(translationPosts).toBe(savedPosts);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Translate to English", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "The ingestion worker is offline",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "Local runtime is unavailable",
  );
  expect(ollamaPosts).toBe(0);
  expect(translationPosts).toBe(savedPosts);
  translationAvailable = true;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page
    .getByRole("button", { name: "Review / correct statement" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(expertChunk.text);
  const reviewDialog = page.getByRole("dialog");
  await reviewDialog.getByLabel(/^Rationale/).fill("Unsaved review edit");
  await reviewDialog.getByLabel(/^Stance/).selectOption("bearish");
  failTranslation = true;
  await reviewDialog
    .getByRole("button", { name: "Translate to English", exact: true })
    .click();
  await expect(reviewDialog).toContainText("Translation failed.");
  failTranslation = true;
  await reviewDialog
    .getByRole("button", { name: "Try YouTube captions", exact: true })
    .click();
  await expect(reviewDialog).toContainText("YouTube captions unavailable.");
  await expect(reviewDialog).toContainText(
    "YouTube is temporarily limiting caption requests",
  );
  await reviewDialog.getByText("Technical details", { exact: true }).click();
  for (const width of [1440, 864, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await reviewDialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const pre = await reviewDialog.locator(".error-details pre").boundingBox();
    const column = await reviewDialog.locator(".review-original").boundingBox();
    expect(pre!.x + pre!.width).toBeLessThanOrEqual(
      column!.x + column!.width + 1,
    );
  }
  await page.screenshot({
    path: "data/browser-artifacts/translation-error-mobile.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: "data/browser-artifacts/translation-error-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  expect(ollamaPosts).toBe(0);
  await expect(
    reviewDialog.getByRole("button", {
      name: "Retry YouTube captions",
      exact: true,
    }),
  ).toBeVisible();
  failTranslation = true;
  await reviewDialog
    .getByRole("button", { name: "Retry YouTube captions", exact: true })
    .click();
  await expect(
    reviewDialog.getByRole("button", { name: "Use Ollama Cloud", exact: true }),
  ).toBeVisible();
  expect(ollamaPosts).toBe(0);
  await expect(reviewDialog).toContainText("uses cloud quota");
  failTranslation = true;
  await reviewDialog
    .getByRole("button", { name: "Use Ollama Cloud", exact: true })
    .click();
  await expect(reviewDialog).toContainText("Translation failed.");
  expect(ollamaPosts).toBe(1);
  await reviewDialog
    .getByRole("button", { name: "Retry translation", exact: true })
    .click();
  await expect(reviewDialog.getByRole("status")).toContainText(
    "Translation completed",
    { timeout: 15000 },
  );
  const savedOllamaPosts = ollamaPosts;
  failTranslation = true;
  await reviewDialog
    .getByRole("button", { name: "Translate to English", exact: true })
    .click();
  await reviewDialog
    .getByRole("button", { name: "Try YouTube captions", exact: true })
    .click();
  await expect(
    reviewDialog.getByRole("button", { name: "Use Ollama Cloud", exact: true }),
  ).toBeVisible();
  await reviewDialog
    .getByRole("button", { name: "Use Ollama Cloud", exact: true })
    .click();
  await expect(reviewDialog.getByRole("status")).toContainText(
    "Translation completed",
  );
  expect(ollamaPosts).toBe(savedOllamaPosts);
  await expect(reviewDialog.getByLabel(/^Rationale/)).toHaveValue(
    "Unsaved review edit",
  );
  await expect(reviewDialog.getByLabel(/^Stance/)).toHaveValue("bearish");
  expect(translationScopes).toContain("passage");
  await reviewDialog.getByLabel(/^Rationale/).fill("Synthetic test fixture");
  await reviewDialog.getByLabel(/^Stance/).selectOption("neutral");
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
    page.getByText(/discovered videos.*indexed.*missing transcripts/),
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
  const evidenceTranslation = page.getByRole("complementary", {
    name: "Saved evidence",
  });
  const beforeEvidencePosts = translationPosts;
  await evidenceTranslation
    .getByRole("button", { name: "Translate to Urdu", exact: true })
    .click();
  await expect(evidenceTranslation.getByRole("status")).toContainText(
    "Translation completed",
  );
  expect(translationPosts).toBe(beforeEvidencePosts);
  expect(translationScopes).toContain("passage-read");
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
  const untimedPosts = translationPosts;
  translationAvailable = false;
  await page
    .locator(".video")
    .filter({ hasText: "Browser test fixture — not real commentary" })
    .getByRole("button", { name: "Preview transcript", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Translate to English", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Try YouTube captions", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "untimed source passage",
  );
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Use Ollama Cloud", exact: true }),
  ).toBeVisible();
  expect(translationPosts).toBe(untimedPosts);
  translationAvailable = true;
  await page.keyboard.press("Escape");
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
  await expect(page.getByRole("dialog")).toContainText("0:03 → 0:06");
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
  await expect((await download).suggestedFilename()).toBe(
    "psx-perspectives.csv",
  );
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
  for (const context of browser?.contexts() || [])
    for (const page of context.pages())
      await page.unrouteAll({ behavior: "wait" });
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
