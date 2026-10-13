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
