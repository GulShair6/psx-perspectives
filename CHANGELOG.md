# Changelog

## Unreleased

### Added

- Local research across followed YouTube channels, with saved caption evidence, dated comparisons, stock aliases and independent statement reviews.
- TXT/SRT/VTT imports and original-source citations with retained timestamps.
- Urdu and English reading controls, saved local translation jobs, optional YouTube captions and explicitly selected Ollama fallback.
- English derived-text retrieval and cached Urdu question translation, with at most one cloud synthesis request per uncached expert answer.
- Backed-up maintenance previews and transactional repairs that preserve human decisions and original automatic payloads.
- MIT licensing, contributor/security guidance, isolated browser checks and dependency monitoring for npm, pip and GitHub Actions.

### Fixed

- Numeric caption lines and WebVTT metadata parsing, Hindi action/negation handling, signed financial-number checks and stock attribution within the supporting quote.
- Duplicate review counting across overlapping original evidence, translation-job scope expansion and preprocessing placeholder restoration.
- Worker restart recovery, stale runtime readiness and answer-cache invalidation caused by unrelated Urdu preparation.
- Cross-site GET requests reaching provider-backed endpoints; removed unused cloud planning/reranking paths.
- Python environment creation through symlinked interpreters. Updated SentencePiece to 0.2.1 for its published heap-overflow fix.

### Remaining validation

- Real model inference, Hindi/Punjabi translation quality and local throughput are unverified. Urdu stays provisional and unattended archive preparation stays gated.
- Independent review of thirty real source passages and the twenty-question evidence evaluation are pending; synthetic tests do not establish financial accuracy.
- The remaining optional model-stack advisories need dependency compatibility and security review before release. See [security status](docs/local-runtime-security.md).
- YouTube caption availability and provider quotas vary. No model weights, provider credentials, collected transcripts or personal research data are distributed.
