# PSX Perspectives

A local research workspace for exploring what YouTube channels say about Pakistan Stock Exchange companies. Ask questions in English, Urdu, or mixed language, compare dated perspectives, and inspect the original transcript behind each citation.

PSX Perspectives keeps expert commentary separate from company fundamentals. It helps you inspect evidence; it does not place trades, predict returns, or certify investment recommendations.

## What you can do

- Follow a channel after confirming its identity and collect up to six calendar months of public video metadata and available captions.
- Read channel timelines, cited summaries, and stock/topic statements. Correct or reject automatic statements against the original transcript.
- Ask across selected channels, dates, and stocks. Open saved evidence beside the answer, with video timestamps when the source supplies them.
- Import TXT, SRT, or VTT transcript text when captions are unavailable.
- Translate saved transcripts and source passages into Urdu or English alongside the original, with reusable saved results.
- Use Company research for a ten-company fundamentals dashboard, watchlists, four-company comparisons, and dated official PSX observations.
- Edit bilingual stock aliases, inspect collection jobs, and export company research as CSV or Markdown.

## Quick start

Requires **Node.js 22.13+** and npm. Linux may need C++ build tools if a compatible `better-sqlite3` binary is unavailable.

```sh
git clone https://github.com/GulShair6/psx-perspectives.git
cd psx-perspectives
npm ci
cp .env.example .env
npm run dev
```

Open [PSX Perspectives locally](http://127.0.0.1:3000). The launcher starts the website and a separate ingestion worker. Stop both with Ctrl+C.

The first run creates a SQLite database and seeds the company/source catalog. It does not ship someone else's research corpus. Import transcripts or configure collection to build your own evidence library. Without provider keys you can inspect saved evidence and use lexical search; cloud synthesis and channel-name discovery require their respective keys.

For a production build on your own computer:

```sh
npm run build
npm start
```

**Run on localhost only.** This app has no user authentication and is not designed as a public hosted service. Sharing the source repository is supported; exposing your running research workspace to the internet is not.

## Configuration

Set keys in `.env`, never in source code. On Unix, use `chmod 600 .env`. Restart the app after editing configuration.

- `OLLAMA_API_KEY`: enables expert summaries, extraction, bilingual query planning, relevance ranking, and answers through Ollama Cloud (`gemma4:31b`). Expert research uses this provider only.
- `YOUTUBE_DATA_API_KEY`: enables channel search and paginated uploads discovery. Enable YouTube Data API v3 and restrict the server key to that API. Browser-referrer restrictions are unsuitable for this server-side integration.
- `OPENAI_API_KEY`: optional provider for company research when Ollama is absent; it does not enable expert cloud research.
- `PSX_DB_PATH`: optional database path; defaults to `data/research.sqlite`.

Both processes load `.env`, then `.env.local`; inherited environment variables take precedence. Keep development dependencies installed in production because the worker uses `tsx`.

Selected questions and evidence are sent to the configured cloud provider. Calls have no application spending cap; provider account limits still apply. Credentials remain server-side. Environment files, collected data, backups, and browser artifacts are ignored by Git.

## A first research session

1. In **Expert research**, choose **Add Channel**, search a name, `@handle`, or channel URL, inspect the identity, then confirm it.
2. Inspect **Coverage & collection** for discovery/indexing progress, missing captions, errors, pause/resume, and history synchronization. Enabled channels check every six hours while the worker runs.
3. Open **Insights & timeline** to browse statements or videos. Cited summaries and transcript previews preserve original text and supplied times. Automatic claims can be reviewed and corrected independently of the immutable extraction payload.
4. Select channels, dates, and optionally a stock. Ask a question such as “How did these channels' views on OGDC change during the selected period?”
5. Open each citation and check its context. An answer's cutoff is the latest indexed commentary in the selected period, not a live market view. Missing or invalid cloud responses leave retrieved evidence available with an explicit gap.

For manual imports, switch to **Company research → Transcripts**. Paste the transcript with its video URL, title, speaker, publication date, and language. Plain text receives video citations without fabricated timestamps.

Company observations can be included in expert answers through the combined evidence setting. Company prices, historical channel targets, and opinions remain distinct. Company collection can be queued from the interface or with `npm run refresh`.

### Read a translation

Open a transcript, a transcript citation, or **Review / correct statement**, then choose **Translate to Urdu** or **Translate to English**. The full transcript viewer translates the entire saved transcript; citation and review panels translate only their displayed source passage and context. The original remains visible beside the translation, or above it on smaller screens. Original timestamps and video links are retained.

Translation uses the existing Ollama Cloud key and ingestion worker. Requested saved caption text, the video title and the source-language hint are sent to the provider; there is no automatic bulk translation or audio transcription. Source-language labels are hints, so a mislabeled track can still be translated. Long transcripts run as background jobs and continue after closing the viewer. Progress and partial results appear in the panel. Reopening and choosing the language reuses saved results. **Retry translation** resumes missing segments after a failure; provider quota/authentication failures require restoring the connection and resuming cloud analysis first.

Translations are labeled **AI translation — not human-reviewed**. Only structurally valid output with unchanged numerical notation is saved. Cached results remain readable without a provider key, and a changed transcript or translation version does not reuse stale results. The original source still drives search, answers, citations and review scores; translation alone does not count as an independent accuracy review. Confirm the original caption or audio before selecting the accuracy-reference checkbox. Caption mistakes, mistranslated names, units and meaning can survive these checks.

## How it works

The Next.js/React interface talks to a localhost-only API. SQLite stores original caption segments, searchable chunks, company snapshots, review decisions, and resumable job checkpoints. A sequential worker discovers videos, retrieves available captions, indexes transcripts, and queues cloud analysis.

Retrieval scopes SQLite full-text search and stock/topic relationships to your filters before ranking. It combines deterministic retrieval with optional cached bilingual planning and bounded cloud reranking. Selected evidence feeds a structured answer whose quotations, numbers, and citations are validated. A rejected synthesis can receive one correction attempt using the same evidence and validation rules. If correction fails, the app returns evidence and gaps instead of an unsupported conclusion.

This is lexical and structured retrieval, without embeddings, a vector database, or GraphRAG. The broader stock-symbol catalog is separate from the ten-company fundamentals dashboard.

The source is organized into `app/` (interface and API), `lib/` (collection, retrieval, validation, and storage), `migrations/` (transactional schema updates), `scripts/` (launch/maintenance/browser checks), and `tests/` (isolated regressions and acceptance questions).

## Limits and verification status

- Captions may be missing, blocked, or inaccurate. Automatic tracks can mislabel spoken Urdu. A YouTube Data API key enables metadata discovery, not universal caption download. Manual imports are the supported fallback; no audio is downloaded or transcribed.
- Collection coverage is explicit. Recent-feed fallback cannot establish complete history; bounded retrieval cannot establish exhaustive agreement between channels. Historical imports cannot recover timestamps or provenance that were never saved.
- AI output is labeled as automatic and needs human review. Independent real-corpus evaluation is still pending: the 20-question relevance checklist in `tests/expert-research-questions.json` (at least 18 must retrieve independently labeled required evidence, including chronological and cross-channel context, or correctly identify its absence), and at least 30 independently reviewed real passages/chunks with 90% stock/stance accuracy. Fixture success does not certify model quality. Verified company consensus remains gated by independent review.
- Public source layouts, captions, provider availability, and quotas can change. Source failures remain visible. Missing company metrics are not synthesized; 1Y price returns exclude payouts. Dividend endpoints may be unavailable.
- Shariah classification requires a dated human-reviewed official source. Classifications older than 180 days are excluded from the compliant filter; this convention is not a certification.
- Seeded InvestKaar identity remains unresolved until a valid channel identity is supplied. Channel-name search and full uploads discovery require a YouTube key. Discovery completeness and transcript availability are reported separately.

## Tests

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:browser
```

The automated suites cover parsers, calendar boundaries, resumable collection, source identity, scoped retrieval, extraction validation, review preservation, provider failures, credential redaction, and request validation. Browser checks launch an isolated production server/worker and exercise research, evidence, imports, reviews, watchlists, comparison, settings, exports, connection recovery, keyboard interactions, accessibility, and responsive layouts. Synthetic browser fixtures are labeled and never added to your database.

Browser checks require a completed build. Screenshots are saved under ignored `data/browser-artifacts/`. Tests validate implementation behavior; they do not guarantee live source availability or financial/model accuracy.

`npm run proof` is an optional live PSX/feed/caption smoke check. `npm run refresh` retrieves official observations and updates your database. Both depend on external services and are separate from deterministic tests.

Before live release sign-off:

1. Configure the YouTube key locally and restart. Confirm a searched channel, synchronize its history, and inspect coverage, saved transcripts, and pause/resume behavior. Record missing captions and discovery errors.
2. Use [the 20-question checklist](tests/expert-research-questions.json). Fix the channel/date filters for each question, independently identify the required source passages before asking, and check the top-ten retrieved evidence, answer citations, dates, and timestamps. Record each result; at least 18 of 20 must meet the evidence requirement or correctly report its absence.
3. Open a channel's timeline and choose **Review / correct statement**. Check the original passage, correct the stock and stance, then select **Use corrected stock and stance as my independent accuracy reference** before saving. Evaluate at least 30 distinct real source passages/chunks; stock/stance accuracy must reach 90%. Keep these private review records outside the public repository.

## Backup and restore

```sh
npm run backup
```

The backup uses SQLite's online backup API, including committed WAL content, and saves a dated file under `data/backups/`. If you use a custom database path, run the command with the same `PSX_DB_PATH` environment variable. The standalone maintenance scripts do not automatically load `.env`.

Take a backup before upgrading; migrations run automatically on database initialization. Restarting the worker resumes collection and analysis.

To restore, stop the website and worker, copy the backup to a clean database location, set `PSX_DB_PATH` to it, and restart. Do not replace a running database or reuse stale WAL/SHM files beside a replacement.

## Contributing and licensing

Bug reports and focused pull requests are welcome. Include reproduction steps and relevant checks; use disposable data for tests. Never attach credentials, personal database files, or collected transcripts to an issue or pull request. For a security concern, use the repository's private vulnerability-reporting option if available; do not publish credentials or an exploit containing private data.

The code is [MIT licensed](LICENSE). PSX, YouTube, and channel content have their own rights and access terms; the code license does not grant permission to redistribute that content. Share the source, not your private research database or someone else's transcripts.
