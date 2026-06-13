import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import dayjs from 'dayjs';
import { writeChatHistory, writeJsonExport, writeHtmlExport, writeCsvExport, downloadMediaFiles } from './download.js';
import { UserResolver } from './userResolver.js';
import type { Message, MediaFile } from './model.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeMediaFile(overrides: Partial<MediaFile> & { mediaUrl: string }): MediaFile {
  return { mediaType: 'photo', mediaExt: '.jpeg', sentAt: dayjs.unix(1672531200), ...overrides };
}

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
    const msgs: Message[] = [makeMessage({ id: '1', created_at: 1672531200, name: 'Alice', text: 'Hello' })];
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
        id: '1',
        created_at: 1672531200,
        name: 'Bob',
        text: 'Party!',
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
      makeMessage({ id: '2', created_at: 1720000000, name: 'Bob', text: '2024 msg' }), // 2024-07-03 UTC
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
    const msgs: Message[] = [makeMessage({ id: '1', created_at: 1672531200, name: 'Alice', text: 'Clean' })];
    writeJsonExport(msgs, dir, { exportDate: '2024-01-01', totalMessages: 1 });
    const all = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    expect(all.messages[0]).not.toHaveProperty('reactions');
  });

  it('per-year JSON files are created', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 1688000000, name: 'Alice', text: '2023' }), // 2023-06-29 UTC
      makeMessage({ id: '2', created_at: 1720000000, name: 'Bob', text: '2024' }), // 2024-07-03 UTC
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
    const msgs: Message[] = [makeMessage({ id: '1', created_at: 1672531200, name: 'Alice', text: 'Hello' })];
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
        id: '1',
        created_at: 1672531200,
        name: 'Alice',
        text: 'Woo',
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
    expect(header).toBe(
      'message_id,timestamp,sender,text,attachment_count,attachment_types,like_count,emoji_reaction_count'
    );
  });

  it('like_count and emoji_reaction_count columns are populated correctly', () => {
    const dir = createTmpDir();
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Alice' }]);
    const msgs: Message[] = [
      makeMessage({
        id: 'msg-1',
        created_at: 1672531200,
        name: 'Bob',
        text: 'Hi',
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
        id: 'msg-1',
        created_at: 1672531200,
        name: 'Carol',
        text: 'Hi',
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
    expect(lines.find((l) => l.includes('emoji') && l.includes('🎉'))).toBeDefined();
  });

  it('reactions.csv is written even when there are no reactions (header only)', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [makeMessage({ id: '1', created_at: 1672531200, name: 'Alice', text: 'Plain' })];
    writeCsvExport(msgs, dir);
    const content = fs.readFileSync(path.join(dir, 'csv', 'reactions.csv'), 'utf-8');
    // Header only, no data rows
    expect(content).toBe('message_id,timestamp,sender,reaction_type,reaction_code,reactor_name,reactor_user_id\n');
  });

  it('rows with no reactions have 0 counts in main CSV', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [makeMessage({ id: 'm1', created_at: 1672531200, name: 'Alice', text: 'Plain' })];
    writeCsvExport(msgs, dir);
    const content = fs.readFileSync(path.join(dir, 'csv', 'all.csv'), 'utf-8');
    const dataRow = content.split('\n')[1];
    const cols = dataRow.split(',');
    expect(cols[6]).toBe('0'); // like_count
    expect(cols[7]).toBe('0'); // emoji_reaction_count
  });

  it('neutralizes spreadsheet formula injection in sender and text', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({ id: 'm1', created_at: 1672531200, name: '=cmd', text: '=HYPERLINK("http://evil.example","x")' }),
      makeMessage({ id: 'm2', created_at: 1672531200, name: '+plus', text: '@at' }),
    ];
    writeCsvExport(msgs, dir);
    const content = fs.readFileSync(path.join(dir, 'csv', 'all.csv'), 'utf-8');
    // A dangerous leading character is prefixed with a single quote so spreadsheets treat it as text.
    expect(content).toContain("'=cmd");
    expect(content).toContain("'=HYPERLINK"); // also wrapped in quotes due to the comma; still prefixed with '
    expect(content).toContain("'+plus");
    expect(content).toContain("'@at");
    // No raw formula cell starts directly with '=' after a delimiter
    expect(content).not.toMatch(/,=HYPERLINK/);
  });
});

describe('writeHtmlExport URL-scheme hardening', () => {
  it('does NOT embed javascript: or data: attachment URLs', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({
        id: '1',
        created_at: 1672531200,
        name: 'Mallory',
        text: 'x',
        attachments: [
          { type: 'image', url: 'javascript:alert(document.cookie)', created_at: 1672531200 },
          { type: 'video', url: 'javascript:alert(1)', created_at: 1672531200 },
          { type: 'image', url: 'data:text/html,<script>1</script>', created_at: 1672531200 },
        ],
      }),
    ];
    writeHtmlExport(msgs, dir);
    const html = fs.readFileSync(path.join(dir, 'html', 'chat.html'), 'utf-8');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    // Falls back to a plain text marker instead of an executable href/src
    expect(html).toContain('class="attachment"');
  });

  it('embeds safe http(s) images, renders linked_image as <img>, and adds rel=noopener on video links', () => {
    const dir = createTmpDir();
    const msgs: Message[] = [
      makeMessage({
        id: '1',
        created_at: 1672531200,
        name: 'Alice',
        text: 'pics',
        attachments: [
          { type: 'image', url: 'https://i.groupme.com/a.png', created_at: 1672531200 },
          { type: 'linked_image', url: 'https://example.com/b.png', created_at: 1672531200 },
          { type: 'video', url: 'https://v.groupme.com/c.mp4', created_at: 1672531200 },
        ],
      }),
    ];
    writeHtmlExport(msgs, dir);
    const html = fs.readFileSync(path.join(dir, 'html', 'chat.html'), 'utf-8');
    expect(html).toContain('src="https://i.groupme.com/a.png"');
    expect(html).toContain('src="https://example.com/b.png"'); // linked_image rendered as <img>
    expect(html).toContain('href="https://v.groupme.com/c.mp4"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('downloadMediaFiles', () => {
  it('downloads a file atomically and reports an accurate count', async () => {
    const dir = createTmpDir();
    server.use(http.get('https://i.groupme.com/photo.jpeg', () => HttpResponse.text('IMG-BYTES')));
    const result = await downloadMediaFiles([makeMediaFile({ mediaUrl: 'https://i.groupme.com/photo.jpeg' })], dir);
    expect(result).toEqual({ downloaded: 1, skipped: 0, failed: 0 });
    // The file exists with expected content, and no .part temp remains.
    const written = findFile(dir, (f) => f.endsWith('.jpeg'));
    expect(written).toBeTruthy();
    expect(fs.readFileSync(written!, 'utf-8')).toBe('IMG-BYTES');
    expect(findFile(dir, (f) => f.endsWith('.part'))).toBeNull();
  });

  it('skips a file that already exists on a second run', async () => {
    const dir = createTmpDir();
    server.use(http.get('https://i.groupme.com/photo.jpeg', () => HttpResponse.text('IMG')));
    const media = [makeMediaFile({ mediaUrl: 'https://i.groupme.com/photo.jpeg' })];
    const first = await downloadMediaFiles(media, dir);
    expect(first.downloaded).toBe(1);
    const second = await downloadMediaFiles(media, dir);
    expect(second).toEqual({ downloaded: 0, skipped: 1, failed: 0 });
  });

  it('counts a non-2xx response as failed and writes nothing', async () => {
    const dir = createTmpDir();
    server.use(http.get('https://i.groupme.com/missing.jpeg', () => new HttpResponse(null, { status: 404 })));
    const result = await downloadMediaFiles([makeMediaFile({ mediaUrl: 'https://i.groupme.com/missing.jpeg' })], dir);
    expect(result).toEqual({ downloaded: 0, skipped: 0, failed: 1 });
    expect(findFile(dir, (f) => f.endsWith('.jpeg'))).toBeNull();
    expect(findFile(dir, (f) => f.endsWith('.part'))).toBeNull();
  });

  it('counts a non-http URL as failed without making a request', async () => {
    const dir = createTmpDir();
    // No handler registered; onUnhandledRequest:'error' would throw if a request were attempted.
    const result = await downloadMediaFiles([makeMediaFile({ mediaUrl: 'ftp://example.com/x.jpeg' })], dir);
    expect(result).toEqual({ downloaded: 0, skipped: 0, failed: 1 });
  });

  it('handles a network error gracefully (no hang) and cleans up partial files', async () => {
    const dir = createTmpDir();
    server.use(http.get('https://i.groupme.com/boom.jpeg', () => HttpResponse.error()));
    const result = await downloadMediaFiles([makeMediaFile({ mediaUrl: 'https://i.groupme.com/boom.jpeg' })], dir);
    expect(result).toEqual({ downloaded: 0, skipped: 0, failed: 1 });
    expect(findFile(dir, (f) => f.endsWith('.part'))).toBeNull();
  });

  it('removes the partial .part file when the stream errors MID-download', async () => {
    const dir = createTmpDir();
    server.use(
      http.get('https://i.groupme.com/partial.jpeg', () => {
        // Emit some bytes, then error the body stream mid-transfer.
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial-bytes'));
            controller.error(new Error('stream boom'));
          },
        });
        return new HttpResponse(stream, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
      })
    );
    const result = await downloadMediaFiles([makeMediaFile({ mediaUrl: 'https://i.groupme.com/partial.jpeg' })], dir);
    expect(result).toEqual({ downloaded: 0, skipped: 0, failed: 1 });
    // Neither a leftover .part temp nor a (corrupt) final file should remain.
    expect(findFile(dir, (f) => f.endsWith('.part'))).toBeNull();
    expect(findFile(dir, (f) => f.endsWith('.jpeg'))).toBeNull();
  });
});

/** Recursively find the first file path under dir whose basename matches the predicate. */
function findFile(dir: string, pred: (name: string) => boolean): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, pred);
      if (found) return found;
    } else if (pred(entry.name)) {
      return full;
    }
  }
  return null;
}
