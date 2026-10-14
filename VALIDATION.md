# Implementation validation — 12 October 2026

## Completed

- Installed and locked Next.js 16.4.0, TypeScript, SQLite and focused dependencies. npm reported no known dependency vulnerabilities at install time.
- Retrieved and validated all ten real pilot PSX company pages. Saved prices, reported P/E, annual/quarterly summaries, ratios and announcement links with source and retrieval dates. No synthetic observations were generated.
- Read real PSX and SCS YouTube feeds, each returning 15 recent entries. A sampled SCS video had captions; a sampled PSX video did not. Another SCS sample used Hindi auto-captions for spoken Urdu, showing why mixed-language extraction needs human review.
- Confirmed SCS and PSX channel IDs from their official sites. InvestKaar's identity remains unresolved.
- Identified the caption package's inconsistent timestamp units between srv3 and classic XML and added normalization with a regression check.
- Core tests passed for parsing, missing values, reported losses, periods/units, URL restrictions, caption timestamps, aliases, exact quote/target evidence, negated source preservation, duplicate imports, review corrections, distinct-passage accuracy gating, numerical/citation validation, cached data preservation, atomic job claims, Pakistan month boundaries and cross-process budget reservations.
- Type checking and an optimized Next.js production build passed.
- Chromium browser checks passed against an isolated production server and worker: four-company comparison, watchlist changes, real company detail, missing-key chat response, timestamped transcript import, worker completion, review correction, source editing, classification filtering, CSV download, cross-origin request rejection, activity view, desktop and 390px mobile layout. No unexpected browser console or page errors were observed.
- Confirmed the real workspace retains zero evaluated opinions and disabled consensus; browser fixtures use a disposable database and are never mixed into the personal corpus.
- SQLite online backup command was exercised.

## Not yet verified

- No `OPENAI_API_KEY` was available. Real AI extraction, the 30-distinct-passage human evaluation, and ten live research answers remain unverified. Test fixtures check behavior; they are not evidence of model accuracy. Consensus remains disabled until the real evaluation passes.
- Both attempted PSX payout POST routes returned HTTP 404. The app preserves the error in source notes and leaves dividends/yield unavailable. It does not silently substitute another source.
- Complete historical video discovery is not available through the recent-upload RSS feeds. Caption availability and source page layouts can change.
- Official-source identity and company-page access were checked, but permission for broader market-data redistribution was not established. The app is scoped to a local personal workspace; code licensing does not license source content.

## Live acceptance procedure

Configure the key server-side, import real transcripts from the pilot sources, and extract opinions. Independently assess at least 30 distinct passages in Opinion review, correcting the company/stance before marking a reference. Consensus unlocks only at 90% or higher accuracy. Then ask the ten questions in `tests/research-questions.json`; verify every cited number, date, opinion, source link and timestamp against its underlying evidence, and retain the explicit data gaps.

## Automated caption collection update

Enabled sources are scheduled by the existing worker every six hours, using persisted next-check times and a single active job per source. Video captions are collected without an AI key, deduplicated, and kept with normalized timestamps. Missing captions have a daily cooldown; YouTube rate blocks stop the batch. Video library exposes last/next checks and source failures. No speech-to-text service or audio download was added.

Validation on 12 October 2026: all 19 core tests, type checking, production build, and browser checks passed. A live scheduled run discovered ten SCS Trade videos and seven PSX videos, saving nine and five caption transcripts respectively. Three videos reported disabled captions and remain marked for manual import/daily retry. InvestKaar's official page did not expose a verifiable channel identity, so its scheduled job failed visibly without selecting an assumed channel.

## Ollama Cloud integration (13 October 2026)

Server-side Ollama Cloud configuration takes priority over OpenAI, using `gemma4:31b` through the existing SDK. The supplied credential authenticated successfully; it is stored only in ignored `.env.local` with mode 0600. No provider fallback or account upgrade is performed. Model-credit consumption is estimated at the documented $0.14/million input and $0.40/million output rates, using the existing transactional $10 cap; this does not reveal or enforce the provider account's free-credit balance.

All 20 core tests, type checking, production build and isolated browser checks passed. The live model catalog and connection were verified. A brief OGDC sector question returned a validated company citation and data gap. Broader live research attempts and stock-opinion extraction produced unsupported numerical claims or quotes and were rejected by existing validation. This is not evidence of extraction accuracy: the human evaluation gate remains in place. Cloud JSON schemas are not enforced by Ollama; the app requests JSON, accepts an enclosing JSON code fence, then validates every response. No automatic paid retry/fallback was added.

## Research workflow update (13 October 2026)

The Ollama credential was moved to ignored `.env` with mode 0600 and removed from `.env.local`, preserving other settings. Both launcher processes load `.env` followed by optional `.env.local`, with inherited variables taking precedence. A fixture launcher test verified these values in both processes; the real web API and worker startup both confirmed Ollama Cloud configuration after restart. The credential was absent from compiled client bundles.

All 25 tests passed, including batch input validation and active-job overlap prevention, continuation after invalid extraction, stopping on provider quota errors, explicit zero-opinion results, and imports never triggering AI analysis. Production compilation/type checking passed. Browser checks covered watchlist defaults, persisted comparison selections, citation previews, recovered polling errors, timestamped transcript previews and filters, batch failure progress without leaving Transcripts, Save and next with keyboard dismissal, source editing, exports and mobile overflow. Browser answers and provider readiness overrides were isolated UI fixtures, not live model quality evaluations. No fixture opinions or watchlist changes were added to the user's database.

Human extraction accuracy and the remaining live research acceptance questions are still unverified. Existing quote/citation/numerical checks and the human review/consensus gate remain unchanged.

## Channel-first expert research — 13 October 2026

- 43 isolated automated tests passed. The new tests cover paginated 100-video backfill beyond recent feeds, identity resolution, quota checkpoint recovery, pause/resume, caption-track preference, original segment start/end mapping, bilingual alias retrieval, channel/date/stock/topic isolation before ranking, partial quarantine, immutable extraction corrections, evidence coverage, cached chunk analysis, missing-key fallback, credential redaction and credential reflection rejection. Additional checks cover fallback imports preserving channel identity, pausing between analysis batches without losing checkpoints or cached summaries, and newest-first insight scheduling. Twenty bilingual synthetic retrieval questions found relevant fixture evidence in the top ten; thirty structured validation cases cover rejected negation, unsupported targets and unestablished speakers. These are regression tests, not live accuracy certification.
- Type checking and the production build passed. Real browser checks passed for mocked channel confirmation, coverage, automatic insight fixtures, original transcript previews, statement correction, raw scoped research, exact timestamp citations, company comparisons, import/batch progress, review navigation, recovered connection errors, keyboard access and mobile overflow. Browser fixtures do not call paid providers or external discovery APIs.
- Official PSX screener retrieval succeeded: 749 symbols with company names were stored in the broader catalog. The ten-company fundamentals dashboard remains separate.
- The actual workspace's 14 saved transcripts were indexed. A real Ollama analysis returned three cited summaries for a saved SCS Trade video; four proposed statements were quarantined for unsupported actions or nonmatching quotes. Valid summaries and raw evidence were retained. Another live video exposed an excessive-summary response; summary records now validate independently, preserving supported statements and summaries when individual records fail.
- A live Ollama research request about PSO returned HTTP 200 with dated saved transcript citations and recorded passage starts. Forecasts are channel statements, not verified company results. The app and worker were restarted with Ollama Cloud; transactional monthly reservations remain active.
- `.env` remains ignored and mode 0600. Browser assets were checked for credential values; none were present. YouTube Data API requests use a server-side header and controlled error messages, not credential-bearing URLs.

Still pending: the user has not configured YOUTUBE_DATA_API_KEY, so real channel-name search and full uploads-playlist backfill could not be exercised. The requested 20-question real-corpus relevance evaluation and 30 independent human statement reviews remain incomplete; verified consensus stays locked. Public caption access is best effort, old grouped imports cannot recover lost segment end times or track provenance, and cloud free-credit availability cannot be verified by the app. Existing source content and credentials remain outside Git.

## Editorial UI redesign — 13 October 2026

All 44 automated tests, explicit type checking and the production build passed. The UI suite passed the existing watchlist/comparison, import, batch outcome, review correction, connection recovery, source editing and export workflows. New coverage verifies channel discovery dialogs, profile tabs, searchable keyboard-operated stock selection, filter restoration after reload, exact evidence links including Shorts, responsive evidence panes, and 25-item transcript pagination with long mixed-language titles.

All five sections were checked at 320, 768, 1024 and 1440 pixels. Axe checks reported no serious or critical violations in the tested sections and discovery, stock selection, statement review and evidence views. Native dialogs preserve keyboard dismissal and focus restoration; Save and next resets focus for the new review. Desktop, evidence and mobile screenshots were visually reviewed and saved under ignored data/browser-artifacts. Browser fixtures are explicitly synthetic and use a disposable database; they do not certify model quality.

The production app and worker were restarted and confirmed online with Ollama Cloud. Credentials remain absent from client assets and .env retains mode 0600. No schema or retrieval changes were introduced by this redesign. Physical-device, assistive-technology and actual browser-zoom testing were not performed. Live YouTube discovery and the real-corpus relevance/human extraction evaluations remain pending as described above.

## PSX Perspectives naming and transcript panes — 13 October 2026

Renamed the displayed product and browser title to PSX Perspectives. Removed the application budget meter, state/settings fields, monthly cap, reservation enforcement and pricing calculations. Historical usage rows and the original schema are preserved without affecting calls. Cloud errors still pause analysis when the provider denies access; no provider limit or authentication check is bypassed.

All 43 tests passed, including successful structured calls with historical usage above the former cap, successful calls without provider usage metadata, unchanged JSON/evidence validation and a state response containing no budget or quota fields. Two obsolete cap-specific tests were removed and replaced by the new uncapped behavior/API checks. Type checking and a production build passed. Browser checks passed all existing workflows and all five sections at 320, 768, 1024 and 1440px, including axe checks. A wheel-scroll test verified that the transcript library scrolls independently while the import pane's position and scroll offset remain unchanged. Narrow screens retain a stacked layout. Reviewed screenshot: data/browser-artifacts/transcript-panes.png (disposable test data).

The app and worker were restarted with Ollama Cloud and the live state endpoint confirmed the budget field is absent. Provider account limits, live YouTube credential requirements and real-corpus accuracy evaluations remain unchanged. No live AI requests were needed to validate the removal.

## Reliable Ollama research RAG — 14 October 2026

Implemented six-calendar-month Karachi date windows and one-time resumable checkpoint extension; existing longer checkpoints, paused channels, captions, chunks and review decisions are preserved. The additive migration records statement extraction versions and transcript hashes. Extraction `expert-2` reconstructs quotations from selected contiguous original segments and keeps missing timestamps missing. Saved perspectives are separate from original transcript text, including approved opinion corrections.

Retrieval now combines scoped SQLite FTS and structured stock/topic relationships, reciprocal-rank fusion, bounded channel/date-balanced candidates, explicit chronology pairs, market-overview breadth, cached bilingual query planning and one bounded Ollama reranking call. Unsupported or malformed cloud results retain saved evidence without manufacturing a conclusion. Answers expose coverage and retrieval fallback metadata. No embeddings, external AI provider, graph database, audio transcription or portfolio allocation was added.

Verification:
- All 57 automated tests passed, including the environment suite, calendar clamping, checkpoint preservation, segment selection, extraction array limits, scoped historical retrieval beyond the former global statement limit, reanalysis/review preservation, malformed/partial/invented-ID reranking, byte limits, original-quote integrity and synthesis failure.
- Type checking and the optimized Next.js production build passed. The initial sandbox failures (`tsx` IPC socket permission and empty TypeScript subprocess output) were resolved by running the authorized checks with the needed process permissions; no tests were skipped or assertions weakened.
- A source-segment order mutation was detected by the regression tests and restored immediately.
- The existing browser suite was extended for current-version extraction counts and answer coverage. An in-flight mocked response disposal during teardown was fixed by draining route handlers before browser closure. The final browser suite passed with exit code zero, including coverage and extraction counts, scoped raw RAG, reviews, exact source citations, responsive layout and accessibility checks. The resulting desktop citation screenshot was inspected: original transcript text and readable saved perspectives are separate, and coverage gaps are visible.
- Online pre-migration backup: `data/backups/pre-rag-2026-10-14T08-25-11-411Z.sqlite`. After migration the workspace still contains 22 videos, 19 saved transcripts, 160 chunks and 48 original statements; both review/evaluation tables remain empty. Test and cloud-smoke runs used isolated database copies.

Live checks and pending acceptance:
- Ollama is configured; YouTube Data API credentials are absent, so complete six-month uploads discovery is not verified.
- A real PSO question against saved SCS Trade transcripts successfully exercised query planning. The first relevance response omitted candidates; requiring a judgment for every candidate fixed this in a subsequent real run (all 13 candidates judged).
- The real synthesis response introduced unsupported numbers. Existing numerical validation rejected it and returned dated saved evidence, coverage gaps and an explicit fallback; this is a verified safety behavior, not a successful answer-quality evaluation.
- The 20-question real-data evaluation and independent review of at least 30 real source chunks remain pending. Neither fixture success nor the smoke check establishes the 18/20 relevance or 90% extraction thresholds. Consensus remains locked. The saved corpus includes Hindi auto-captions for spoken Urdu, so transcription/alias quality remains a material limitation.
- After restarting the application and worker, collection and versioned reanalysis resume sequentially. Restoring the backup requires stopping both processes and using a clean database location without stale WAL/SHM files.
