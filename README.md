# groupme-exporter

Export your media, chat history, and reactions from GroupMe to plain files you own.

[![CI](https://github.com/xConde/groupme-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/xConde/groupme-exporter/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

A command-line tool that runs on your own machine. The only network traffic is between you and GroupMe's official API. You need a GroupMe access token; no other account, server, or third-party service is involved.

## Quick start

```bash
# 1. Get a GroupMe API token from https://dev.groupme.com/ (see "Getting a token").
# 2. Run it and follow the prompts:
npx groupme-exporter
```

You will be asked to paste your token, pick a group or DM from a list, and choose an output folder. You do not need to look up any IDs. To use flags instead, see [Usage](#usage).

## Features

- Download photos, videos, and file attachments from groups and DMs
- Export chat history as text files (per year, plus a consolidated file)
- Export as JSON, HTML, and CSV
- Export message reactions: both legacy "likes" (`favorited_by`) and emoji reactions, with reactor names resolved from group members
- Export an analytics summary, including top reactors and most-reacted messages
- Detect image format from URLs
- Resume interrupted exports from a checkpoint
- Skip already-downloaded media files
- Memory Lane: occasional conversation snippets shown during export
- Interactive prompts or full CLI automation

## Requirements

- Node.js 20 or newer
- A GroupMe API access token

### Getting a token

1. Go to [dev.groupme.com](https://dev.groupme.com/) and sign in with your GroupMe account.
2. Click **Access Token** (top right) and copy the token.
3. Provide it via the interactive prompt, the `--token` flag, or the `GROUPME_TOKEN` environment variable.

The token is tied to your account and grants read access to your own GroupMe data. Keep it private, and revoke it anytime from the same page. See [Security](#security).

## Installation

### Run without installing (npx)

Once published to npm, run it directly with npx:

```bash
npx groupme-exporter --help
npx groupme-exporter --token YOUR_TOKEN --type groups --conversation GROUP_ID --output ./export
```

### Global install

```bash
npm install -g groupme-exporter
groupme-exporter --help
```

### Install from source (development)

```bash
git clone https://github.com/xConde/groupme-exporter.git
cd groupme-exporter
npm install
npm start
```

To produce a compiled build:

```bash
npm run build   # compiles TypeScript to dist/
```

The compiled entry point is `dist/app.js`.

## Usage

### Interactive mode

```bash
npm start
```

You will be prompted for your token, conversation type, and output directory.

### CLI mode

```bash
groupme-exporter --token YOUR_TOKEN --type groups --conversation GROUP_ID --output /path/to/output
```

Any flag you omit falls back to an interactive prompt, so you can mix and match. Leave off `--conversation` (and `--type`) to pick from a list of your groups and DMs instead of looking up an ID.

When developing from source, use `npm start --` to pass flags through tsx:

```bash
npm start -- --token YOUR_TOKEN --type groups --conversation GROUP_ID --output /path/to/output
```

### Environment variable

```bash
export GROUPME_TOKEN=your_token_here
groupme-exporter --type groups --conversation GROUP_ID --output ./export
```

Or use a `.env` file in the working directory:

```env
GROUPME_TOKEN=your_token_here
```

The token is resolved in this order: `--token` flag, then `GROUPME_TOKEN` environment variable, then `.env` file, then interactive prompt.

### CLI options

| Option | Description |
|--------|-------------|
| `-t, --token <token>` | GroupMe API access token |
| `-o, --output <dir>` | Output directory |
| `--type <type>` | Conversation type: `groups` or `chats` |
| `-c, --conversation <id>` | Conversation ID |
| `--no-media` | Skip media download |
| `--chat-history` | Save chat history (skip the prompt) |
| `--no-chat-history` | Skip chat history text export |
| `--help` | Show help |
| `--version` | Show version |

## Output structure

```
output/
├── 2023/
│   ├── Jan/
│   │   ├── 01-15-2023.jpeg
│   │   └── 01-15-2023_2.png
│   └── Feb/
│       └── 02-20-2023.mp4
├── chat-history/
│   ├── 2023.txt
│   ├── 2024.txt
│   └── all.txt
├── json/
│   ├── 2023.json
│   ├── 2024.json
│   └── all.json
├── html/
│   └── chat.html
├── csv/
│   ├── 2023.csv
│   ├── 2024.csv
│   ├── all.csv
│   └── reactions.csv
└── stats.json
```

## Reactions

GroupMe surfaces two kinds of reactions on a message:

- Likes: the legacy heart, exposed as `favorited_by` (a list of user IDs).
- Emoji reactions: exposed as `reactions: [{ type, code, user_ids }]`.

Both are captured in every export format. Names are resolved by fetching the group's member roster (`GET /groups/:id`) for groups, or `GET /users/me` for DMs. Members who have left the group fall back to the user ID they reacted with.

| Format | How reactions appear |
|--------|----------------------|
| `chat-history/*.txt` | A `  + ❤️ Alice, Bob \| 🎉 Carol` line under each reacted message (ASCII-prefixed so it survives `grep`, `less`, and older terminals) |
| `json/*.json` | A `reactions: { likes: [...], emojis: [...] }` block when present (omitted otherwise); `metadata.conversationName` populated for groups |
| `html/chat.html` | Pill-style badges with reactor names shown inline (no hover required, so it works on touch devices) |
| `csv/*.csv` | `message_id`, `like_count`, and `emoji_reaction_count` columns. Per-reactor detail lives in a separate `csv/reactions.csv` with one row per reactor, joinable by `message_id` (pandas/Excel friendly) |
| `stats.json` | `totalReactions`, `totalLikes`, `totalEmojiReactions`, `topReactors` (top 10), `topReactedMessages` (top 5), `emojiBreakdown` |

`csv/reactions.csv` columns: `message_id, timestamp, sender, reaction_type, reaction_code, reactor_name, reactor_user_id`. `reaction_type` is either `like` (legacy heart) or `emoji`.

## Resume support

If an export is interrupted, re-run the same command with the same `--output` directory to resume. A hidden state file and a message cache inside the output directory track progress, and the resumed run reloads the cached messages so the final export is complete. Both files are removed automatically on successful completion, leaving a clean export. Re-running a completed export is safe: media files already on disk are skipped.

## Security

Your GroupMe API token is a secret credential.

- The token is read from `--token`, the `GROUPME_TOKEN` environment variable, a `.env` file, or an interactive prompt, in that order of precedence.
- It is sent to `api.groupme.com` over HTTPS only (GroupMe's documented authentication mechanism), and it is never written to logs or error output.
- Do not commit your `.env` file. It is listed in `.gitignore`.
- To revoke or rotate a token, visit [dev.groupme.com](https://dev.groupme.com/).
- HTML exports reject non-`http(s)` attachment URLs to prevent script injection, and CSV exports escape values that spreadsheets would otherwise treat as formulas.

See [SECURITY.md](SECURITY.md) for the project's vulnerability disclosure policy.

## Known limitations

- The full set of messages is held in memory during export. For groups with hundreds of thousands of messages, make sure enough RAM is available before running.

## Development

### Prerequisites

Node.js 20 or newer, and npm.

### Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Run from source via tsx (dev mode) |
| `npm run build` | Compile TypeScript to `dist/` via tsc |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the Vitest unit and integration tests |
| `npm run test:coverage` | Run tests with a V8 coverage report |
| `npm run lint` | Lint with ESLint |
| `npm run format` | Format with Prettier |

### Running tests

```bash
npm test
```

Tests are colocated with source files as `src/*.test.ts` and use Vitest with MSW for HTTP mocking.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, branching conventions, and the PR checklist.

## Tech stack

- TypeScript (strict mode), compiled to `dist/` via `tsc`
- tsx for running from source in development (a dev dependency only)
- Native fetch API (no axios)
- dayjs for date handling
- @clack/prompts for interactive prompts
- commander for CLI argument parsing
- nanospinner for progress spinners
- picocolors for terminal colors
- Vitest and MSW for testing

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before opening an issue or pull request. In short: open an issue to discuss larger changes, keep pull requests focused, add tests for new behavior, and make sure `npm test`, `npm run lint`, and `npm run typecheck` pass.

## License

[Apache-2.0](LICENSE). Copyright 2026 Edward Conde.
