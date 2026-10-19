# Contributing to PSX Perspectives

Focused bug fixes, clearer evidence handling, accessibility improvements, and parser fixtures are welcome. Open an issue before a large feature or architectural change so we can agree on scope.

## Set up

Use Node.js 22.13 or newer and npm. Linux is the CI reference platform; native SQLite may require a C++ toolchain on other systems.

```sh
npm ci
cp .env.example .env
npm run dev
```

Provider keys are optional for local development and are never needed by CI. Use synthetic transcripts and a disposable database, not your personal research library. See [README.md](README.md) for configuration and usage.

## Make a change

1. Branch from the default branch and keep one concern per pull request. Separate broad formatting from behavior changes.
2. Follow nearby code. Reuse existing components, validation schemas, and SQLite helpers before adding dependencies or abstractions.
3. Add a regression test for behavior changes. Preserve original evidence, timestamps, review decisions, and resumable jobs. Never invent missing financial values or source provenance.
4. Add a numbered SQL migration for schema changes; do not edit an existing migration. Test migration from an existing database as well as a fresh database. Back up personal data before testing an upgrade.
5. Update user-facing documentation when configuration or behavior changes.

## Verify before opening a pull request

```sh
npm run format
npm run check
npx playwright install --with-deps chromium
npm run test:browser
npm audit --audit-level=high
```

`check` runs formatting verification, TypeScript (including unused declarations), isolated tests, and a production build. Browser checks require that build and start their own server on port 3107 with temporary synthetic data and empty provider credentials. Stop any other browser-check run first. Screenshots go to ignored `data/browser-artifacts/`.

`npm run proof` and `npm run refresh` contact live services. They are optional manual checks and must not be made prerequisites for an ordinary contribution. Tests must be deterministic and must not require paid services.

## Review expectations

Explain the user-visible problem, the change, and the checks you ran. Include before/after screenshots for interface changes and inspect narrow screens, keyboard focus, loading, empty, and error states. State any checks you could not run.

CI runs on pull requests and pushes to the default branches. Maintainers should require its checks and a review before merging. A green test suite verifies implementation behavior, not the accuracy of financial commentary or model output.

Do not include environment files, provider credentials, databases, collected captions, private review records, or real user research in commits, logs, screenshots, or issue attachments. Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

Be constructive and respectful. Critique the code and evidence; explain disagreements and help others reproduce the result.
