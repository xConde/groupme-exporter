import * as fs from 'node:fs';
import * as path from 'node:path';
import { Message } from './model.js';

export interface ExportState {
  conversationType: string;
  chatId: string;
  lastMessageId?: string;
  messagesProcessed: number;
  startedAt: string;
  updatedAt: string;
}

const STATE_FILENAME = '.groupme-export-state.json';
const MESSAGES_CACHE_FILENAME = '.groupme-messages.jsonl';

export function getStatePath(outputDir: string): string {
  return path.join(outputDir, STATE_FILENAME);
}

export function loadState(outputDir: string): ExportState | null {
  const statePath = getStatePath(outputDir);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(data) as ExportState;
  } catch (error: unknown) {
    // The file exists but is unreadable/corrupt (e.g. truncated by a power loss).
    // Warn rather than silently restarting a potentially large export from scratch.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: found ${STATE_FILENAME} but could not parse it (${message}). Starting a fresh export.`);
    return null;
  }
}

export function saveState(outputDir: string, state: ExportState): void {
  const statePath = getStatePath(outputDir);
  // Write temp file in same directory to avoid cross-filesystem rename failures (EXDEV)
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = path.join(path.dirname(statePath), `.groupme-state-${Date.now()}.tmp`);
  // Atomic write: write to temp, then rename
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, statePath);
}

export function clearState(outputDir: string): void {
  const statePath = getStatePath(outputDir);
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}

// --- Message cache (NDJSON) ---------------------------------------------------
// Each fetched batch is appended to a newline-delimited JSON file so that a
// resumed export can reload everything fetched in prior runs and still produce
// COMPLETE export files (not just messages from the resume point forward).

export function getMessagesCachePath(outputDir: string): string {
  return path.join(outputDir, MESSAGES_CACHE_FILENAME);
}

export function appendMessagesToCache(outputDir: string, messages: Message[]): void {
  if (messages.length === 0) {
    return;
  }
  const cachePath = getMessagesCachePath(outputDir);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const lines = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  fs.appendFileSync(cachePath, lines);
}

export function loadMessagesCache(outputDir: string): Message[] {
  const cachePath = getMessagesCachePath(outputDir);
  if (!fs.existsSync(cachePath)) {
    return [];
  }
  const data = fs.readFileSync(cachePath, 'utf-8');
  const messages: Message[] = [];
  for (const line of data.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      messages.push(JSON.parse(trimmed) as Message);
    } catch {
      // A crash mid-append can leave a truncated final line; skip unparseable lines.
    }
  }
  return messages;
}

export function clearMessagesCache(outputDir: string): void {
  const cachePath = getMessagesCachePath(outputDir);
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
  }
}
