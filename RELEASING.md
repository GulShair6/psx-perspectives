# Preparing a public release

PSX Perspectives ships as a local research application. Publishing its source is separate from hosting a running workspace. The application has no authentication and must remain bound to localhost.

## Verify the candidate

From a clean checkout using Node.js 22.13+:

```sh
npm ci
npm run check
python3.11 -m unittest discover -s local_translation -p 'test_*.py'
npx playwright install --with-deps chromium
npm run test:browser
npm audit --audit-level=high
```

Inspect the browser screenshots with synthetic data on desktop and mobile. Smoke-test `npm start` against a disposable `PSX_DB_PATH`. Confirm that stopping the launcher stops both web and worker processes, and that saved work survives a restart.

Test upgrades with a backup copy of an older database. Migrations apply automatically; downgrading the code does not undo schema changes. For rollback, stop both processes, restore the pre-upgrade backup to a clean location, and run the matching earlier revision. See [backup and restore](README.md#backup-and-restore).

Live YouTube/PSX/provider checks are separate from deterministic CI. Record which services and credentials were tested. Do not claim complete collection, model accuracy, or investment reliability from synthetic test results. The independent real-corpus evaluation described in [README.md](README.md#limits-and-verification-status) remains a prerequisite for accuracy claims.

Review the optional Python environment separately: `npm audit` does not inspect `local_translation/requirements.txt`. Check direct and resolved transitive Python dependencies against current advisories before release, record reachability and fixed versions, and rerun the pinned-model trial after dependency changes. Lightweight Python tests do not install or validate the model stack. See the [local runtime security review](docs/local-runtime-security.md) for the current unresolved findings.

## Review what becomes public

- Review the full Git history and release archive for credentials and private material. Ignoring a file today does not remove it from old commits. Rotate any disclosed credential before publishing.
- Include source, migrations, documentation, and synthetic fixtures. Exclude environment files, databases, backups, collected captions, private review records, build output, and local agent/cloud configuration.
- Confirm MIT licensing is appropriate for the code being released. Source data and third-party content retain their own rights.
- Review dependencies and the lockfile. An audit covers known advisories, not every supply-chain risk.

## Configure GitHub

The repository owner should enable these settings before accepting contributions:

- Actions enabled, with **Quality and browser checks** required on the default branch and at least one approving review. Run CI once before selecting the check in branch rules.
- Branch rules blocking force pushes and deletion of the default branch.
- Private vulnerability reporting, Dependabot alerts, and secret scanning/push protection where available.

GitHub can restrict branch protections on private repositories by account plan. If the API reports that limitation, record it rather than claiming protections are enabled. After an owner-approved switch to public visibility, configure and verify the required checks and review rules before accepting contributions; a paid plan is not a prerequisite for this local project.

The workflow uses a read-only token, pinned action commits, no provider credentials, and no deployment step. Pull requests from forks run without repository secrets. Dependabot proposes npm, Python and action updates; review and test them before merging.

## Publish deliberately

Review the diff and all release evidence, choose a version, and write release notes describing user-visible changes and remaining limits. Tag the reviewed commit and attach a source release. Changing repository visibility and publishing a tag/release are separate owner actions; local preparation does not perform them.

Start release notes from [CHANGELOG.md](CHANGELOG.md). Confirm that hosted CI passed for the exact proposed release commit, rather than an earlier default-branch revision. Keep collected transcripts, human labels, benchmarks and private security-scan output outside the source archive.
