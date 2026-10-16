# Security policy

## Supported use

PSX Perspectives is a single-user application for a trusted local computer. Run the web server on `127.0.0.1` using the supplied launcher. The API checks localhost hosts and same-origin JSON mutations; it has no user authentication. Do not expose it through a public reverse proxy, tunnel, or shared server.

Security fixes target the current default branch. Older snapshots are not maintained separately; back up your database before updating.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/GulShair6/psx-perspectives/security/advisories/new) when enabled. Include the affected revision, reproduction steps using synthetic data, expected impact, and any suggested fix. Never include real credentials, collected transcripts, or personal databases.

If that option is unavailable, open an issue requesting a private security contact without describing the vulnerability. Wait for a private channel before sharing details. Do not publish an exploit or credential in a public issue.

## Data and credentials

Keep `.env`, `.env.local`, SQLite files, backups, and private research out of version control. Set restrictive file permissions on shared computers. Selected evidence and questions are sent to the configured cloud provider; provider account limits and terms apply. Rotate any credential that has been disclosed, including in Git history; deleting the current file does not revoke it.

The code license does not grant rights to redistribute YouTube captions, channel content, or PSX data. Public releases should contain source and synthetic fixtures only.
