# groupme-exporter

Export media, chat history, and data from GroupMe conversations.

## Features

- Download photos, videos, and file attachments from groups and DMs
- Export chat history as text files (per year + consolidated)
- Export as JSON, HTML, CSV formats
- **Export message reactions** — both legacy "likes" (`favorited_by`) and emoji reactions, with reactor names resolved from group members
- Export analytics and stats summary, including top reactors and most-reacted messages
- Smart image format detection from URLs
- Resume interrupted exports with checkpoint support
- Skip already-downloaded media files
- Memory Lane: random conversation snippets displayed during export
- Interactive prompts or full CLI automation

## Requirements

- Node.js 18+
- GroupMe API access token ([get one here](https://dev.groupme.com/))

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/groupme-exporter.git
cd groupme-exporter
npm install
```

## Usage

### Interactive Mode

```bash
npm start
```

You'll be prompted for your token, conversation type, and output directory.

### CLI Mode

```bash
npx tsx src/app.ts --token YOUR_TOKEN --type groups --conversation GROUP_ID --output /path/to/output
```

### Environment Variable

```bash
export GROUPME_TOKEN=your_token_here
npm start
```

Or use a `.env` file:

```bash
cp .env.example .env
# Edit .env with your token
npm run start:env
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-t, --token <token>` | GroupMe API access token |
| `-o, --output <dir>` | Output directory |
| `--type <type>` | Conversation type: `groups` or `chats` |
| `-c, --conversation <id>` | Conversation ID |
| `--no-media` | Skip media download |
| `--no-chat-history` | Skip chat history text export |
| `--help` | Show help |
| `--version` | Show version |

## Output Structure

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

GroupMe surfaces two kinds of reactions on every message:

- **Likes** — the legacy heart, exposed as `favorited_by` (a list of user IDs).
- **Emoji reactions** — exposed as `reactions: [{ type, code, user_ids }]`.

Both are now captured in every export format. Names are resolved by fetching the group's member roster (`GET /groups/:id`) for groups, or `GET /users/me` for DMs. Members who have left the group fall back to the user_id they reacted with.

| Format | How reactions appear |
|--------|----------------------|
| `chat-history/*.txt` | A `  + ❤️ Alice, Bob \| 🎉 Carol` line under each reacted message (ASCII-prefixed so it survives `grep`, `less`, and older terminals) |
| `json/*.json` | `reactions: { likes: [...], emojis: [...] }` block when present (omitted otherwise); `metadata.conversationName` populated for groups |
| `html/chat.html` | Pill-style badges with reactor names visible **inline** (no hover required — works on touch devices) |
| `csv/*.csv` | `message_id`, `like_count`, `emoji_reaction_count` columns. Per-reactor detail lives in a separate **`csv/reactions.csv`** with one row per reactor (joinable by `message_id`) — pandas/Excel friendly |
| `stats.json` | `totalReactions`, `totalLikes`, `totalEmojiReactions`, `topReactors` (top 10), `topReactedMessages` (top 5), `emojiBreakdown` |

`csv/reactions.csv` columns: `message_id, timestamp, sender, reaction_type, reaction_code, reactor_name, reactor_user_id`. `reaction_type` is either `like` (legacy heart) or `emoji`.

## Development

```bash
npm test          # Run tests
npm run test:watch # Watch mode
npm run build     # Type check
```

## Tech Stack

- TypeScript (strict mode, noImplicitAny)
- Native fetch API (no axios)
- dayjs (lightweight date handling)
- @clack/prompts (interactive CLI)
- commander (CLI argument parsing)
- nanospinner (progress spinners)
- picocolors (terminal colors)
- Vitest + MSW (testing)

## License

ISC
