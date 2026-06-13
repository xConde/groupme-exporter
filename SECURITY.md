# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.1.x   | :white_check_mark: |
| < 2.1   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities **privately**. Do not open a public issue
for anything that could put users' data or credentials at risk.

- Open a private GitHub Security Advisory:
  <https://github.com/xConde/groupme-exporter/security/advisories/new>

You can expect an initial acknowledgement within **7 days** and a status update on
the fix or mitigation within **30 days**. Please include reproduction steps and the
affected version where possible.

## Handling Your GroupMe Token

This tool authenticates to the GroupMe API with a personal **access token**. Treat it
like a password:

- The token grants **read access to your GroupMe messages, groups, and contacts**.
- It is read from `--token`, the `GROUPME_TOKEN` environment variable, a `.env` file,
  or an interactive prompt, and is sent to `api.groupme.com` **over HTTPS**.
- **Never commit your `.env` file**. It is listed in `.gitignore`.
- **Do not share** export logs, terminal output, or the hidden checkpoint/cache files
  (`.groupme-export-state.json`, `.groupme-messages.jsonl`) without reviewing them first.
- If you believe a token has been exposed, revoke and regenerate it at
  <https://dev.groupme.com/>.

## Export Hardening

The exporters are written to be safe to open and share:

- **HTML export** only embeds attachment URLs that use an `http(s)` scheme. `javascript:`
  and `data:` URLs are never rendered, preventing stored-XSS when you open the HTML file.
- **CSV export** neutralizes spreadsheet **formula injection**: any cell beginning with
  `=`, `+`, `-`, `@`, tab, or carriage return is prefixed with a single quote so Excel,
  LibreOffice, and Google Sheets treat it as text rather than executing it.
