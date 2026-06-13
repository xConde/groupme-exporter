# Contributing to groupme-exporter

Thank you for taking the time to contribute. Please read this guide before opening issues or pull requests.

## Prerequisites

- **Node.js >= 20** (Node 18 is EOL and not supported)
- **npm** (comes with Node)

## Local Development Setup

```bash
git clone https://github.com/xConde/groupme-exporter.git
cd groupme-exporter
npm install
```

Run the CLI during development via `tsx` (no compile step needed):

```bash
npm start
```

This executes `tsx src/app.ts` and picks up source changes immediately.

## Running Tests

Tests are colocated with source files as `src/*.test.ts` and run with [Vitest](https://vitest.dev/).

```bash
# Run all tests once
npm test

# Run tests with coverage report
npm run test:coverage
```

When adding a new feature or fixing a bug, **add or update the corresponding `*.test.ts` file**. PRs without tests for new behavior will be asked to add them before merge.

## Type Checking

```bash
npm run typecheck
```

This runs `tsc --noEmit` against the full source tree. All strict-mode errors must be resolved before a PR can land.

## Lint and Format

The project uses ESLint for static analysis and Prettier for formatting.

```bash
# Check for lint errors
npm run lint

# Apply auto-fixes (lint + format)
npm run format
```

CI enforces both. Fix all lint errors and ensure files are formatted before pushing.

## Building

The package compiles TypeScript to `dist/` and ships only compiled JS:

```bash
npm run build
```

This runs `tsc -p tsconfig.build.json`. The compiled entry point is `dist/app.js`. You do not need to build during development. `npm start` uses `tsx` directly.

## Branching and Pull Request Conventions

- Base all feature branches off `main`.
- Branch names should follow `<type>/<short-description>`, e.g. `fix/resume-checkpoint` or `feat/json-export`.
- Keep pull requests focused: one feature or fix per PR.
- Fill in the pull request template completely; incomplete checklists will block review.

## Commit Message Style

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short imperative description>

[optional body]

[optional footer(s)]
```

Common types:

| Type | When to use |
|------|-------------|
| `feat` | New user-visible feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code restructuring with no behavior change |
| `test` | Adding or fixing tests |
| `chore` | Tooling, CI, dependency updates |
| `perf` | Performance improvement |

Examples:

```
feat(export): add JSON export format
fix(resume): write all messages, not only post-checkpoint ones
docs: update CONTRIBUTING with Node 20 requirement
```

Breaking changes must include `BREAKING CHANGE:` in the commit footer.

## CI Requirements

All pull requests must pass the following CI checks on both **ubuntu-latest** and **windows-latest**, under **Node 20** and **Node 22**:

- `npm run lint`: zero lint errors
- `npm test`: all tests pass

A failing CI check will block merge. Fix the failure locally before requesting another review.

## Code Style Conventions

- 2-space indentation
- Single quotes for strings
- Semicolons required
- TypeScript strict mode, no `any`
- ESM (`"type": "module"`): import paths use explicit `.js` extensions (NodeNext resolution)

## Security

Do not commit `.env` files or GroupMe API tokens. See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process.
