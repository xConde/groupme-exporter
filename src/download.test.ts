import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeChatHistory, writeJsonExport, writeHtmlExport, writeCsvExport } from './download.js';
import { UserResolver } from './userResolver.js';
import type { Message } from './model.js';

function makeMessage(overrides: Partial<Message> & { id: string; created_at: number; name: string }): Message {
  return { text: null, attachments: [], ...overrides };
}

let tmpDir: string;

function createTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gme-test-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('writeChatHistory', () => {
  it('messages with no reactions produce no reaction line', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1672531200, name: 'Alice', text: 'Hello' }),
    ];
    writeChatHistory(msgs, dir);
    const content = fs.readFileSync(path.join(dir, 'chat-history', 'all.txt'), 'utf-8');
    expect(content).toContain('Alice: Hello');
    expect(content).not.toMatch(/^\s+\+ /m);
  });

  it('messages with favorited_by show "+ ❤️" line with resolved names', () => {
    const dir = createTmpDir();
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([
      { user_id: 'u1', nickname: 'Alice' },
      { user_id: 'u2', nickname: 'Bob' },
    ]);
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1672531200, name: 'Carol', text: 'Hi', favorited_by: ['u1', 'u2'] }),
    ];
    writeChatHistory(msgs, dir, resolver);
    const content = fs.readFileSync(path.join(dir, 'chat-history', 'all.txt'), 'utf-8');
    expect(content).toContain('  + ❤️ Alice, Bob');
  });

  it('messages with emoji reactions show "+ <emoji>" line with code and names', () => {
    const dir = createTmpDir();
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Alice' }]);
    const msgs: Message[] = [
      makeMessage({
        id: '1', created_at: 1672531200, name: 'Bob', text: 'Party!',
        reactions: [{ type: 'emoji', code: '🎉', user_ids: ['u1'] }],
      }),
    ];
    writeChatHistory(msgs, dir, resolver);
    const content = fs.readFileSync(path.join(dir, 'chat-history', 'all.txt'), 'utf-8');
    expect(content).toContain('  + 🎉 Alice');
  });

  it('per-year files exist along with all.txt', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1688000000, name: 'Alice', text: '2023 msg' }), // 2023-06-29 UTC
      makeMessage({ id: '2', created_at: 1720000000, name: 'Bob', text: '2024 msg' }),   // 2024-07-03 UTC
    ];
    writeChatHistory(msgs, dir);
    const chatDir = path.join(dir, 'chat-history');
    expect(fs.existsSync(path.join(chatDir, '2023.txt'))).toBe(true);
    expect(fs.existsSync(path.join(chatDir, '2024.txt'))).toBe(true);
    expect(fs.existsSync(path.join(chatDir, 'all.txt'))).toBe(true);
  });
});

describe('writeJsonExport', () => {
  it('messages with reactions include reactions key in JSON', () => {
    const dir = createTmpDir();
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Alice' }]);
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1672531200, name: 'Bob', text: 'Hi', favorited_by: ['u1'] }),
    ];
    writeJsonExport(msgs, dir, { exportDate: '2024-01-01', totalMessages: 1 }, resolver);
    const all = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    const msg = all.messages[0];
    expect(msg).toHaveProperty('reactions');
    expect(msg.reactions.likes[0].name).toBe('Alice');
  });

  it('messages without reactions omit reactions key', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1672531200, name: 'Alice', text: 'Clean' }),
    ];
    writeJsonExport(msgs, dir, { exportDate: '2024-01-01', totalMessages: 1 });
    const all = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    expect(all.messages[0]).not.toHaveProperty('reactions');
  });

  it('per-year JSON files are created', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1688000000, name: 'Alice', text: '2023' }),   // 2023-06-29 UTC
      makeMessage({ id: '2', created_at: 1720000000, name: 'Bob', text: '2024' }),     // 2024-07-03 UTC
    ];
    writeJsonExport(msgs, dir, { exportDate: '2024-01-01', totalMessages: 2 });
    expect(fs.existsSync(path.join(dir, 'json', '2023.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'json', '2024.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'json', 'all.json'))).toBe(true);
  });
});

describe('writeHtmlExport', () => {
  it('no .reactions div when message has no reactions', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1672531200, name: 'Alice', text: 'Hello' }),
    ];
    writeHtmlExport(msgs, dir);
    const html = fs.readFileSync(path.join(dir, 'html', 'chat.html'), 'utf-8');
    expect(html).not.toContain('class="reactions"');
  });

  it('reaction pills show reactor names inline (no hover required)', () => {
    const dir = createTmpDir();
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([
      { user_id: 'u1', nickname: 'Alice' },
      { user_id: 'u2', nickname: 'Bob' },
    ]);
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1672531200, name: 'Carol', text: 'Hi', favorited_by: ['u1', 'u2'] }),
    ];
    writeHtmlExport(msgs, dir, resolver);
    const html = fs.readFileSync(path.join(dir, 'html', 'chat.html'), 'utf-8');
    expect(html).toContain('class="reactions"');
    expect(html).toContain('class="reaction"');
    expect(html).toContain('class="emoji"');
    expect(html).toContain('class="names"');
    expect(html).toContain('Alice, Bob');
    expect(html).toContain('❤️');
    // No hover-only reliance
    expect(html).not.toMatch(/title="Alice/);
  });

  it('emoji reaction pills render code and reactor names inline', () => {
    const dir = createTmpDir();
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Carol' }]);
    const msgs: Message[] = [
      makeMessage({
        id: '1', created_at: 1672531200, name: 'Alice', text: 'Woo',
        reactions: [{ type: 'emoji', code: '🎉', user_ids: ['u1'] }],
      }),
    ];
    writeHtmlExport(msgs, dir, resolver);
    const html = fs.readFileSync(path.join(dir, 'html', 'chat.html'), 'utf-8');
    expect(html).toContain('class="reactions"');
    expect(html).toContain('🎉');
    expect(html).toContain('>Carol<');
  });
});

describe('writeCsvExport', () => {
  it('header row includes message_id and reaction summary columns, no nested reactions column', () => {
    const dir = createTmpDir();
    writeCsvExport([], dir);
    const content = fs.readFileSync(path.join(dir, 'csv', 'all.csv'), 'utf-8');
    const header = content.split('\n')[0];
    expect(header).toBe('message_id,timestamp,sender,text,attachment_count,attachment_types,like_count,emoji_reaction_count');
  });

  it('like_count and emoji_reaction_count columns are populated correctly', () => {
    const dir = createTmpDir();
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Alice' }]);
    const msgs: Message[] = [
      makeMessage({
        id: 'msg-1', created_at: 1672531200, name: 'Bob', text: 'Hi',
        favorited_by: ['u1'],
        reactions: [{ type: 'emoji', code: '🎉', user_ids: ['u1'] }],
      }),
    ];
    writeCsvExport(msgs, dir, resolver);
    const content = fs.readFileSync(path.join(dir, 'csv', 'all.csv'), 'utf-8');
    const dataRow = content.split('\n')[1];
    const cols = dataRow.split(',');
    // message_id,timestamp,sender,text,attachment_count,attachment_types,like_count,emoji_reaction_count
    expect(cols[0]).toBe('msg-1');
    expect(cols[6]).toBe('1'); // like_count
    expect(cols[7]).toBe('1'); // emoji_reaction_count
  });

  it('writes a separate reactions.csv with one row per reactor', () => {
    const dir = createTmpDir();
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([
      { user_id: 'u1', nickname: 'Alice' },
      { user_id: 'u2', nickname: 'Bob' },
    ]);
    const msgs: Message[] = [
      makeMessage({
        id: 'msg-1', created_at: 1672531200, name: 'Carol', text: 'Hi',
        favorited_by: ['u1', 'u2'],
        reactions: [{ type: 'emoji', code: '🎉', user_ids: ['u1'] }],
      }),
    ];
    writeCsvExport(msgs, dir, resolver);
    const content = fs.readFileSync(path.join(dir, 'csv', 'reactions.csv'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines[0]).toBe('message_id,timestamp,sender,reaction_type,reaction_code,reactor_name,reactor_user_id');
    // 2 likes + 1 emoji = 3 reactor rows
    expect(lines.length).toBe(4);
    expect(lines[1]).toContain('msg-1');
    expect(lines[1]).toContain('like');
    expect(lines[1]).toContain('Alice');
    expect(lines[1]).toContain('u1');
    expect(lines.find(l => l.includes('emoji') && l.includes('🎉'))).toBeDefined();
  });

  it('reactions.csv is written even when there are no reactions (header only)', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1672531200, name: 'Alice', text: 'Plain' }),
    ];
    writeCsvExport(msgs, dir);
    const content = fs.readFileSync(path.join(dir, 'csv', 'reactions.csv'), 'utf-8');
    // Header only, no data rows
    expect(content).toBe('message_id,timestamp,sender,reaction_type,reaction_code,reactor_name,reactor_user_id\n');
  });

  it('rows with no reactions have 0 counts in main CSV', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({ id: 'm1', created_at: 1672531200, name: 'Alice', text: 'Plain' }),
    ];
    writeCsvExport(msgs, dir);
    const content = fs.readFileSync(path.join(dir, 'csv', 'all.csv'), 'utf-8');
    const dataRow = content.split('\n')[1];
    const cols = dataRow.split(',');
    expect(cols[6]).toBe('0'); // like_count
    expect(cols[7]).toBe('0'); // emoji_reaction_count
  });
});
