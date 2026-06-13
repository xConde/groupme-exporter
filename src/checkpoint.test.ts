import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getStatePath,
  loadState,
  saveState,
  clearState,
  getMessagesCachePath,
  appendMessagesToCache,
  loadMessagesCache,
  clearMessagesCache,
  type ExportState,
} from './checkpoint.js';
import type { Message } from './model.js';

function makeMessage(o: Partial<Message> & { id: string; created_at: number; name: string }): Message {
  return { text: null, attachments: [], ...o };
}

function makeState(overrides: Partial<ExportState> = {}): ExportState {
  return {
    conversationType: 'groups',
    chatId: 'chat-1',
    messagesProcessed: 42,
    startedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T01:00:00.000Z',
    ...overrides,
  };
}

let tmpDir: string;

function createTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gme-cp-test-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('getStatePath', () => {
  it('returns path.join(outputDir, .groupme-export-state.json)', () => {
    expect(getStatePath('/some/dir')).toBe(path.join('/some/dir', '.groupme-export-state.json'));
  });
});

describe('saveState / loadState', () => {
  it('round-trips an ExportState exactly', () => {
    const dir = createTmpDir();
    const state = makeState({ lastMessageId: 'msg-99' });
    saveState(dir, state);
    const loaded = loadState(dir);
    expect(loaded).toEqual(state);
  });

  it('loadState returns null for a missing file', () => {
    const dir = createTmpDir();
    expect(loadState(dir)).toBeNull();
  });

  it('loadState on a corrupt file returns null and calls console.error', () => {
    const dir = createTmpDir();
    const statePath = getStatePath(dir);
    fs.writeFileSync(statePath, 'not json{');
    const errorSpy = vi.spyOn(console, 'error');
    const result = loadState(dir);
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('clearState', () => {
  it('deletes the state file; loadState after clearState returns null', () => {
    const dir = createTmpDir();
    saveState(dir, makeState());
    expect(fs.existsSync(getStatePath(dir))).toBe(true);
    clearState(dir);
    expect(fs.existsSync(getStatePath(dir))).toBe(false);
    expect(loadState(dir)).toBeNull();
  });

  it('clearState on missing file does not throw', () => {
    const dir = createTmpDir();
    expect(() => clearState(dir)).not.toThrow();
  });
});

describe('getMessagesCachePath', () => {
  it('returns path.join(outputDir, .groupme-messages.jsonl)', () => {
    expect(getMessagesCachePath('/some/dir')).toBe(path.join('/some/dir', '.groupme-messages.jsonl'));
  });
});

describe('appendMessagesToCache / loadMessagesCache', () => {
  it('round-trips messages preserving order', () => {
    const dir = createTmpDir();
    const msgs = [
      makeMessage({ id: '1', created_at: 1000, name: 'Alice', text: 'first' }),
      makeMessage({ id: '2', created_at: 2000, name: 'Bob', text: 'second' }),
    ];
    appendMessagesToCache(dir, msgs);
    const loaded = loadMessagesCache(dir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe('1');
    expect(loaded[1].id).toBe('2');
  });

  it('appending twice accumulates (union)', () => {
    const dir = createTmpDir();
    const batch1 = [makeMessage({ id: '1', created_at: 1000, name: 'Alice', text: 'a' })];
    const batch2 = [makeMessage({ id: '2', created_at: 2000, name: 'Bob', text: 'b' })];
    appendMessagesToCache(dir, batch1);
    appendMessagesToCache(dir, batch2);
    const loaded = loadMessagesCache(dir);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((m) => m.id)).toEqual(['1', '2']);
  });

  it('appendMessagesToCache([]) writes nothing; loadMessagesCache stays []', () => {
    const dir = createTmpDir();
    appendMessagesToCache(dir, []);
    expect(fs.existsSync(getMessagesCachePath(dir))).toBe(false);
    expect(loadMessagesCache(dir)).toEqual([]);
  });

  it('loadMessagesCache returns [] when file is missing', () => {
    const dir = createTmpDir();
    expect(loadMessagesCache(dir)).toEqual([]);
  });

  it('loadMessagesCache skips a truncated final line', () => {
    const dir = createTmpDir();
    const validMsg = makeMessage({ id: 'valid-1', created_at: 5000, name: 'Carol', text: 'ok' });
    appendMessagesToCache(dir, [validMsg]);
    // Manually append a truncated/partial line without closing brace or newline
    fs.appendFileSync(getMessagesCachePath(dir), '{"id":"x"');
    const loaded = loadMessagesCache(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('valid-1');
  });
});

describe('clearMessagesCache', () => {
  it('removes the cache file', () => {
    const dir = createTmpDir();
    const msgs = [makeMessage({ id: '1', created_at: 1000, name: 'Alice', text: 'hi' })];
    appendMessagesToCache(dir, msgs);
    expect(fs.existsSync(getMessagesCachePath(dir))).toBe(true);
    clearMessagesCache(dir);
    expect(fs.existsSync(getMessagesCachePath(dir))).toBe(false);
  });

  it('clearMessagesCache on missing file does not throw', () => {
    const dir = createTmpDir();
    expect(() => clearMessagesCache(dir)).not.toThrow();
  });
});
