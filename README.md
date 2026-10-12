# PSX Research Desk

A personal, local Next.js + TypeScript application for researching Pakistan Stock Exchange companies alongside cited expert commentary. Company metrics and expert opinions remain separate. No trades, predicted returns or synthetic market data.

## Run

Requires Node.js 22.13+ and npm. Linux systems without a compatible SQLite prebuilt binary need their usual C++ build tools.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://127.0.0.1:3000. One command starts the Next.js application and a separate ingestion worker. Ctrl+C stops both. Keep all dependencies installed: the worker uses `tsx` in development and production.

Optional: enter `OPENAI_API_KEY` in `.env.local` and restart. Never put the key in a browser input or commit it. Without a key, company refreshes, comparisons, watchlists, transcript imports, exports and classification review work; AI extraction and research answers require the key.

```sh
npm run build
npm start
```

Production also starts both processes and binds to localhost. This application has no authentication and must not be exposed to the internet or a public reverse proxy.

## Research workflow

1. Refresh the ten pilot companies from the official PSX portal. Open each company for source dates, annual and quarterly periods, ratios, announcement links and data gaps.
2. Select up to four companies for comparison; star companies for the watchlist. Sorting is a scorecard view, not an investment ranking.
3. Enabled sources collect captions automatically while the app and worker are running. Due sources are checked on startup and every six hours; the schedule survives restarts. Use **Check now** for an immediate source check. Saved transcripts are skipped, and missing or failed captions are retried at most once a day. You can still import a real YouTube URL, title, speaker, publication date and TXT/SRT/VTT transcript. Correct the actual speaker when the channel contains interviews.
4. Once a server-side API key is configured, extract opinions. Review company, stance, supporting quote, rationale, explicit targets and horizon. Reject hypothetical examples.
5. To assess extraction quality, independently check the source passage, correct the company/stance, and tick the accuracy-reference checkbox. The gate compares your reference against the immutable original extraction, not the corrected result. At least **30 distinct passages and 90% accuracy** are required for consensus. Reviewing multiple opinions from one passage does not increase the sample count. Institutional sources are excluded from expert consensus.
6. Ask research questions. Only dated company observations and approved non-hypothetical commentary are retrieved; cited numbers must occur in referenced evidence. Interpretations stay qualitative. Source validation cannot prove a conclusion is economically correct; check the cited issuer facts.

## Data and limits

- The live PSX proof validates symbols against each page title before saving its quote. Prices, financial summaries, ratios and announcement links are parsed from official pages. Observations retain retrieval times, quote dates, reporting periods, units and source URLs. Financial summaries may be standardized by PSX's data supplier; the P/E quote is based on unconsolidated financials.
- Displayed 1Y price returns exclude payouts. Debt/equity, ROE and dividend yield are not inferred when absent. The payout endpoint can fail or change; these failures are recorded in company notes, with no synthetic fallback.
- Source verification checks that the channel ID appears on the configured official page. The pilot SCS and PSX IDs were found on official sites. InvestKaar is seeded but unresolved and will fail discovery until a valid channel page/identity is supplied. This is identity provenance, not a claim of investment expertise.
- Automatic collection does not need an OpenAI key. Enable or pause each source in Settings; last check, next check, and source errors appear in Video library. Only one queued/running discovery job per channel is allowed, including manual checks and retries. YouTube rate blocks stop the current batch instead of repeatedly hitting a blocked endpoint. Automation stops when the local worker is stopped.
- Channel RSS discovery is capped at ten relevant videos from the preceding 90 days. RSS feeds contain recent uploads, so a complete 90-day historical archive is not promised.
- Captions can be missing or blocked. Both classic second timestamps and srv3 millisecond timestamps are normalized. Manual transcript imports are the supported fallback; no audio is downloaded. Plain transcripts receive video citations without fabricated timestamps.
- Shariah status stays unverified unless you review a dated official PSX classification in Settings. Entries older than 180 days are excluded from the compliant filter. This freshness rule is a research convention, not a certification.
- The interface and evidence storage are local. Selected evidence is sent to OpenAI for extraction and answers. AI evidence is treated as untrusted text; it cannot execute tools or modify your database through instructions in a transcript.
- Budget is **US$10 per calendar month in Asia/Karachi**, covering this application's calls only. Transactions reserve worst-case input/output costs before calls, and usage reconciles afterward. Model is `gpt-4.1-mini`; pricing assumptions are $0.40/million input tokens and $1.60/million output tokens. Review these assumptions if provider pricing changes. Automatic SDK retries are disabled. Definite rejected requests release reservations; ambiguous failures retain them. This is not an account-wide OpenAI billing cap.
- PSX and YouTube source content is not covered by this code's MIT license. Review source access terms for your intended use; do not publicly redistribute market data without the required rights. No PSX Alpha code was copied.

## Backup and export

The database lives at `data/research.sqlite`; set `PSX_DB_PATH` to use another path. SQL migrations are versioned and applied transactionally. Data, credentials, browser artifacts and backups are ignored by Git.

```sh
npm run backup
```

Uses SQLite's online backup API, including committed WAL content, to create a dated database in `data/backups/`. To restore, stop both processes and restore the backup to a clean database location, then point `PSX_DB_PATH` at it. Never replace a running database or leave old WAL/SHM files next to a replacement.

Export CSV from the dashboard or Markdown from Settings. Exports are personal local deliverables; CSV cells are escaped against spreadsheet formula injection.

## Validation

```sh
npm test
npm run typecheck
npm run build
npm run proof
npm run refresh
npx playwright install chromium
npm run test:browser
```

Core tests use an isolated temporary database. Automatic collection checks cover persisted scheduling, disabled sources, duplicate jobs, caption saving, normalized timestamps, daily cooldowns and stopping a rate-blocked batch. They cover parsers, aliases, negated evidence, caption units, duplicates, review corrections, the distinct-passage accuracy gate, citations, unsupported figures, failure preservation, job claims and budget reservations across concurrent processes.

The browser check starts its own isolated production server and worker, copies only real saved company observations, and labels any review fixtures as test data. It exercises four-company comparison, watchlists, transcript import, review, source editing, classification filtering, exports, job progress, chat's missing-key message and mobile layout. It removes its isolated database afterward.

Live acceptance questions are in `tests/research-questions.json`. Ten real AI answers and the 30-passage extraction review require your API key and approved real transcripts. The app leaves consensus disabled until that review is actually passed. Synthetic test fixtures never unlock your real workspace.

See `VALIDATION.md` for the checks completed during implementation and limitations.

## Server interfaces

All endpoints live under `/api`, use the Node runtime and are restricted to localhost. Mutations require same-origin JSON requests. Inputs are validated; fetched hosts are allowlisted and redirects are rejected.

- `GET /api/state?since=YYYY-MM-DD`: scorecard, observations, reviewed opinions, sources, recent jobs, budget and worker status.
- `GET /api/export?format=csv|markdown`: local research export.
- `POST /api/refresh`: `{symbols: string[]}`; queue official company retrieval.
- `POST /api/import`: `{url,title,speaker,published_at,text,language,source_id}`; queue a transcript import; language is `ur|en|mixed|unknown`, source ID is nullable.
- `POST /api/extract`: `{id: videoId}`; queue opinion extraction.
- `POST /api/discover`: `{source_id: number}`; verify the source and queue feed/caption ingestion.
- `POST /api/review`: corrected opinion fields, decision and optional human reference assessment.
- `POST /api/watchlist`: `{symbol,watched}`.
- `POST /api/sources`: source identity, URL, nullable channel ID, role and enabled state; optional ID updates an existing source.
- `POST /api/classification`: `{symbol,status,as_of,source_url,confirmed:true}`; save a human-reviewed dated classification.
- `POST /api/chat`: `{question,symbols,since}`; retrieve evidence and return structured facts, expert views, interpretation, gaps and validated citations.
- `POST /api/retry`: `{id: failedJobId}`; queue a new attempt without deleting previous evidence or history.

No NestJS, graph database, automated transcription, overall stock rankings or broker integration.
