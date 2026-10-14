# PSX Perspectives

A personal, local Next.js + TypeScript application for researching expert YouTube commentary through dated, cited transcripts. A separate company view retains Pakistan Stock Exchange fundamentals. Company metrics and expert opinions remain separate. No trades, predicted returns or synthetic market data.

## Run

Requires Node.js 22.13+ and npm. Linux systems without a compatible SQLite prebuilt binary need their usual C++ build tools.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open http://127.0.0.1:3000. One command starts the Next.js application and a separate ingestion worker. Ctrl+C stops both. Keep all dependencies installed: the worker uses `tsx` in development and production.

Enter `OLLAMA_API_KEY` in `.env` for automatic insights, bilingual query expansion and research answers. Enter `YOUTUBE_DATA_API_KEY` for channel-name search and complete uploads-playlist discovery. Enable **YouTube Data API v3** in your Google Cloud project, restrict the key to that API, and keep it server-side. Do not apply browser-referrer restrictions to this server key. Set `.env` permissions to `0600`. Restart after changing configuration. The expert pipeline uses only Ollama Cloud; it has no local model, embedding, or paid-provider fallback. Legacy company research may use the optional OpenAI setting when Ollama is absent.

Both processes load `.env`, then optional `.env.local`; inherited variables take precedence. Credentials never appear in API responses, logs or exports. Without a YouTube key, existing evidence remains usable and legacy official sources can collect their recent feed, explicitly marked incomplete. Without an Ollama key, indexed passages are still searchable; synthesis is unavailable.

```sh
npm run build
npm start
```

Production also starts both processes and binds to localhost. This application has no authentication and must not be exposed to the internet or a public reverse proxy.

## Expert research workflow

1. Open **Expert research** (the default), choose **Add Channel**, search by channel name, `@handle` or `/channel/UC…` URL, inspect the matching identity, then **Confirm and follow**. Names alone never select a person automatically.
2. The sequential worker paginates the channel’s uploads playlist for the last 90 days using Pakistan date boundaries. It saves page checkpoints before caption attempts, covers educational/general-market titles too, and processes available transcripts newest first. Enabled channels check every six hours while the worker runs. **Pause**, **Resume** and **Sync history** are available under each channel’s **Coverage & collection** disclosure. Missing captions retry at most daily; cached transcripts and reviews remain intact.
3. Original segments, languages, caption provenance and supplied times are saved separately from overlapping searchable chunks. Captions prefer creator-supplied tracks, then automatic tracks; neither guarantees word accuracy. Previously saved grouped passages are indexed without inventing unavailable segment end times or provenance. Paste TXT/SRT/VTT through **Transcripts** when public captions are missing.
4. Indexing immediately enables lexical retrieval. Automatic Ollama summaries and stock/topic statements follow independently. Statements distinguish stance from explicit buy/sell/hold/watch/avoid actions, require supporting quotes and explicit targets/horizons, and default attribution to the channel, not its owner or guest. Invalid claims are quarantined individually. Inspect original text, correct or reject statements in the timeline, and save an independent stock/stance accuracy reference if evaluated. Original extraction payloads remain immutable. Summaries include saved supporting quotes.
5. Select channels, dates and optionally a stock, then ask in Urdu, English or mixed language. Retrieval scopes the query before ranking with SQLite FTS, official stock aliases and cached bounded Ollama expansion. Failures fall back to literal/alias search. Neighboring context and SQL-linked earlier/later statements support changes and disagreements. Citations reveal saved passages and original video links, with timestamps only when supplied.
6. “Current” means latest indexed commentary within the selected period. Every answer reports that cutoff, separates reported views, changes, disagreements, interpretation and gaps, and labels automatic output **AI-generated, not human-reviewed**. Company observations are opt-in through the combined evidence setting. Historical targets/prices stay historical. Human-reviewed statements remain distinguishable. Verified company consensus still requires at least **30 independent source passages/chunks and 90% accuracy** and uses approved non-hypothetical expert opinions; automatic statements never count as approved consensus.
7. **Company research** retains the watchlist, four-company comparison, dated official observations and existing reviewed-opinion workflow. The broader official symbol catalog is separate from the ten-company fundamentals dashboard; edit Urdu/English aliases under **Settings → Stock catalog & bilingual aliases**.

Collection and analysis progress appears beside the research workflow. Provider access or authentication failures pause automatic analysis while transcript indexing stays available. Resume cloud analysis after resolving the cause; completed chunk checkpoints avoid repeating successful calls. Results are cached by transcript hash and analysis version. A failed non-quota analysis can be retried using the progress panel.

## Data and limits

- The live PSX proof validates symbols against each page title before saving its quote. Prices, financial summaries, ratios and announcement links are parsed from official pages. Observations retain retrieval times, quote dates, reporting periods, units and source URLs. Financial summaries may be standardized by PSX's data supplier; the P/E quote is based on unconsolidated financials.
- Displayed 1Y price returns exclude payouts. Debt/equity, ROE and dividend yield are not inferred when absent. The payout endpoint can fail or change; these failures are recorded in company notes, with no synthetic fallback.
- The legacy recent-feed collector verifies that the channel ID appears on its configured official page. The pilot SCS and PSX IDs were found on official sites. InvestKaar is seeded but unresolved and will fail discovery until a valid channel page/identity is supplied. This is identity provenance, not a claim of investment expertise.
- Automatic collection does not need an OpenAI key. Enable or pause each source in Settings; last check, next check, and source errors appear in Transcripts. Only one queued/running discovery job per channel is allowed, including manual checks and retries. YouTube rate blocks stop the current batch instead of repeatedly hitting a blocked endpoint. Automation stops when the local worker is stopped.
- Full collection uses the official channels, playlistItems and videos APIs, including pagination, public-video checks and channel ownership checks. Coverage never claims completion until discovery exhausts the uploads playlist. Recent-feed fallback has no keyword filter but cannot establish full-period coverage. Channel timelines display the newest 500 saved videos and 300 statements; coverage counts include the entire displayed collection period.
- Captions can be missing or blocked. Both classic second timestamps and srv3 millisecond timestamps are normalized. Manual transcript imports are the supported fallback; no audio is downloaded. Plain transcripts receive video citations without fabricated timestamps.
- Shariah status stays unverified unless you review a dated official PSX classification in Settings. Entries older than 180 days are excluded from the compliant filter. This freshness rule is a research convention, not a certification.
- The interface and evidence storage are local. Selected expert evidence is sent to Ollama Cloud for extraction and answers; legacy company research follows its configured provider. AI evidence is treated as untrusted text; it cannot execute tools or modify your database through instructions in a transcript.
- AI calls use the configured provider without an application budget or quota cap. Provider access limits still apply; the app does not purchase credits or automatically switch providers. Structured JSON, exact quote and citation validation remain mandatory.
- PSX and YouTube source content is not covered by this code's MIT license. Review source access terms for your intended use; do not publicly redistribute market data without the required rights. No PSX Alpha code was copied.

Public caption retrieval is best effort: YouTube’s official [caption download API](https://developers.google.com/youtube/v3/docs/captions/download) requires permission to edit the video. An ordinary Data API key enables metadata discovery, not universal transcript access. No audio transcription, vector search, local models, Neo4j, trade execution or expert-performance ranking is included.

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

Core tests use an isolated temporary database. Automatic collection checks cover persisted scheduling, disabled sources, duplicate jobs, caption saving, normalized timestamps, daily cooldowns and stopping a rate-blocked batch. They cover parsers, aliases, negated evidence, caption units, duplicates, review corrections, the distinct-passage accuracy gate, citations, unsupported figures, failure preservation, job claims and uncapped cloud calls with historical usage records.

The browser check starts its own isolated production server and worker, copies only real saved company observations, and labels any review fixtures as test data. It exercises four-company comparison, watchlists, transcript import, review, source editing, classification filtering, exports, job progress, chat's missing-key message and mobile layout. It removes its isolated database afterward.

Live acceptance questions are in `tests/research-questions.json`. Ten real AI answers and the 30-passage extraction review require your API key and approved real transcripts. The app leaves consensus disabled until that review is actually passed. Synthetic test fixtures never unlock your real workspace.

See `VALIDATION.md` for the checks completed during implementation and limitations.

## Server interfaces

All endpoints live under `/api`, use the Node runtime and are restricted to localhost. Mutations require same-origin JSON requests. Inputs are validated; fetched hosts are allowlisted and redirects are rejected.

- `GET /api/state?since=YYYY-MM-DD`: scorecard, observations, reviewed opinions, sources, recent jobs and worker status.
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

## Company research workflow

Switch to Company research. Your watchlist opens by default when populated; the section, filter and four-company selection persist in this browser. Source price dates and retrieval times are separate; cached observations older than 48 hours show Refresh due. Use the comparison tray to compare or ask about the selected companies, and open citations to inspect saved evidence.

Captions index and generate expert insights automatically while the worker runs. Optional extraction for the company opinion scorecard remains user-triggered: Transcripts offers source/status filters, previews, per-video analysis, and Analyze ready transcripts (newest ten). Batch progress stays visible in the current screen. Invalid extractions fail visibly; provider access or authentication failures stop the batch and leave remaining transcripts unprocessed. Review each supported opinion against the original passage; Save and next continues to the next pending review. No supported opinions found is a completed analysis, not an approved recommendation.

`POST /api/extract-batch` accepts `{ids: string[]}` (one to ten unique saved video IDs) and returns `{job: number}`. `GET /api/video?id=VIDEO_ID` returns saved video metadata and timestamped passages. Single and batch analysis cannot overlap for a video. Both interfaces retain the localhost and input-validation restrictions.

## Channel API and verification status

- `GET /api/channels/search?q=…`, `GET /api/channels`, `GET /api/channels/evidence?ids=…&since=…&until=…`, `POST /api/channels/follow` (`id`, `confirmed:true`).
- `POST /api/channels/sync`, `/pause`, `/resume` (`source_id`); `GET /api/channels/insights?id=…&since=…&until=…&symbol=…&topic=…`.
- `GET /api/video?id=…` includes original segments and chunk metadata, while preserving existing passages.
- `POST /api/chat` accepts `question`, `channelIds` (source IDs), `symbols`, optional `topics`, `since`, `until`, `mode` (`transcript` or `combined`). Existing company-chat payloads remain supported.
- `POST /api/insights/resume`, `/api/statements/review`, `/api/catalog/refresh`, `/api/catalog/aliases`. Mutations retain localhost/same-origin enforcement and bounded input validation.

The automated suite contains 20 bilingual synthetic retrieval questions and structured quote/action/negation/attribution cases. Passing them is a regression check, **not the requested live 20-question relevance evaluation or human review of 30 real extracted statements**. Those real-data acceptance checks must be completed after channels are collected. Use `tests/expert-research-questions.json` for the 20-question checklist; independently mark answerability and relevant top-ten evidence before calculating the 90% threshold. The accuracy gate stays locked until independent references establish the required sample and threshold. Browser discovery uses mocked identities; server pagination, quota recovery and duplicate protection use deterministic API fixtures. Live YouTube search/backfill requires the missing Data API credential.

## Editorial workspace

Research uses a compact channel pane, a question-led reading workspace, and an evidence reader. Click a channel’s **Insights & timeline** to switch between **Timeline** and **Videos**. Open cited summaries or supporting passages on demand. Stock selection is searchable by symbol, company name, or catalog alias. At wide desktop sizes, citations open beside the answer; narrower screens use a keyboard-accessible side sheet or full-screen dialog.

Sections, research view, channel selection, date/stock/topic filters and profile tabs are reflected in the URL. Saved local preferences apply when URL values are absent. Comparison selections continue to persist separately. Transcripts, reviews and activity lists paginate in groups of 25.

Transcripts uses independent importer/library scrolling on desktop, with a stacked layout on smaller screens. Historical usage records remain in SQLite for compatibility but do not restrict calls or appear in the interface.
