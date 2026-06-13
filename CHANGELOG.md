# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-06-13

### Fixed

- **Resume now produces complete exports.** Previously, resuming an interrupted export
  wrote only the messages fetched after the checkpoint; earlier batches were lost. Each
  fetched batch is now persisted to an on-disk cache (`.groupme-messages.jsonl`) and
  reloaded on resume, so the final files always contain the full conversation.
- **Media downloads are atomic.** Files are written to a `.part` temp file and renamed on
  success, so an interrupted download no longer leaves a truncated file that future runs
  would silently skip.
- **Media downloads no longer hang on stream errors.** A connection reset or CDN timeout
  mid-download now fails that single file cleanly instead of stalling the whole export.
- **Accurate download counts.** The summary reports real `downloaded` / `skipped` /
  `failed` totals instead of always claiming success.
- **HTML export blocks `javascript:` and `data:` URL schemes** (stored-XSS hardening) and
  now renders `linked_image` attachments as images.
- **CSV export neutralizes spreadsheet formula injection** (`=`, `+`, `-`, `@`, tab, CR).
- **API requests now have a 30s network timeout** and a **bounded `Retry-After`** so a
  slow or hostile server can't hang the process indefinitely.
- **`getMessages` guards against a null API `response`** and treats invalid JSON on a 2xx
  as a non-retryable error.
- **Windows absolute paths are accepted** in the interactive output-directory prompt
  (was Unix-only `/`).
- A corrupt checkpoint file now logs a warning instead of silently restarting.

### Changed

- **The package now compiles to `dist/` and ships compiled JavaScript**, so
  `npx groupme-exporter` and global installs work without `tsx` on the user's PATH.
  `bin`/`main` point to `dist/app.js`.
- **Minimum Node.js version is now 20** (Node 18 is end-of-life).
- **License is declared `Apache-2.0`** in `package.json`, matching the `LICENSE` file
  (the README previously said ISC).
- The CLI version is read from `package.json` so it can no longer drift.
- Resume requires the checkpoint to match both the conversation **id and type**; a
  mismatched checkpoint is ignored and a fresh export starts.

### Added

- ESLint (flat config) + Prettier, with `lint`, `format`, and coverage scripts.
- Expanded test coverage: media download, resume, HTML/CSV hardening, checkpoint cache,
  display, and API client error-handling tests.
- Community docs: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, this changelog,
  and GitHub issue/PR templates.
- CI now runs lint + format checks, type-check, build, and the test suite on Ubuntu and
  Windows across Node 20 and 22.

## [2.0.0] - earlier

- Export message reactions (legacy likes + emoji reactions) across all formats.
- Fix HTTP 304 crash when paginating past the start of group history.
- JSON, HTML, CSV exports; analytics/stats; checkpoint-based resume; media download.
