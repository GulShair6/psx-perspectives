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
