import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { GroupmeService } from './service.js';
import { ExportOrchestrator } from './orchestrator.js';

const API_BASE_URL = 'https://api.groupme.com/v3';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let tmpDir: string;

function createTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gme-orch-test-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('ExportOrchestrator integration', () => {
  it('exports a group end-to-end with reactions resolved and 304 terminating cleanly', async () => {
    const dir = createTmpDir();

    let messagesCalls = 0;
    server.use(
      http.get(`${API_BASE_URL}/groups/g-1`, () => {
        return HttpResponse.json({
          response: {
            id: 'g-1',
            name: 'Test Group',
            members: [
              { user_id: 'u-alice', nickname: 'Alice' },
              { user_id: 'u-bob', nickname: 'Bob' },
              { user_id: 'u-carol', nickname: 'Carol' },
            ],
          },
        });
      }),
      http.get(`${API_BASE_URL}/groups/g-1/messages`, () => {
        messagesCalls++;
        if (messagesCalls === 1) {
          // First call returns a batch
          return HttpResponse.json({
            response: {
              count: 2,
              messages: [
                {
                  id: 'msg-2',
                  created_at: 1700000100,
                  user_id: 'u-bob',
                  name: 'Bob',
                  text: 'Reply',
                  favorited_by: ['u-alice'],
                  reactions: [{ type: 'emoji', code: '🎉', user_ids: ['u-alice', 'u-carol'] }],
                  attachments: [],
                },
                {
                  id: 'msg-1',
                  created_at: 1700000000,
                  user_id: 'u-alice',
                  name: 'Alice',
                  text: 'Hello',
                  favorited_by: [],
                  reactions: [],
                  attachments: [],
                },
              ],
            },
          });
        }
        // Second call: GroupMe returns 304 when before_id is past start of history
        return new HttpResponse(null, { status: 304 });
      })
    );

    const service = new GroupmeService('test-token');
    const orchestrator = new ExportOrchestrator(service);

    // Should NOT throw — 304 is the natural end of history for groups
    await orchestrator.exportConversation('groups', 'g-1', dir, true, false);

    // JSON export populated
    const allJson = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    expect(allJson.metadata.messageCount).toBe(2);

    // Find Bob's reacted message in chronological output
    const bobMsg = allJson.messages.find((m: { id: string }) => m.id === 'msg-2');
    expect(bobMsg.reactions).toBeDefined();
    expect(bobMsg.reactions.likes).toEqual([
      { user_id: 'u-alice', name: 'Alice' },
    ]);
    expect(bobMsg.reactions.emojis).toHaveLength(1);
    expect(bobMsg.reactions.emojis[0].code).toBe('🎉');
    expect(bobMsg.reactions.emojis[0].users.map((u: { name: string }) => u.name).sort()).toEqual(['Alice', 'Carol']);

    // Alice's plain message should NOT have a reactions key
    const aliceMsg = allJson.messages.find((m: { id: string }) => m.id === 'msg-1');
    expect(aliceMsg.reactions).toBeUndefined();

    // Stats include reaction metrics
    const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf-8'));
    expect(stats.totalLikes).toBe(1);
    expect(stats.totalEmojiReactions).toBe(2);
    expect(stats.totalReactions).toBe(3);
    expect(stats.emojiBreakdown['🎉']).toBe(2);
    expect(stats.topReactors).toContainEqual(expect.objectContaining({ name: 'Alice' }));

    // Chat history reaction line present for the reacted message
    const chat = fs.readFileSync(path.join(dir, 'chat-history', 'all.txt'), 'utf-8');
    expect(chat).toContain('Bob: Reply');
    expect(chat).toContain('  + ❤️ Alice');
    expect(chat).toContain('🎉');

    // HTML export contains reaction pills with reactor names visible inline
    const html = fs.readFileSync(path.join(dir, 'html', 'chat.html'), 'utf-8');
    expect(html).toContain('class="reactions"');
    expect(html).toContain('class="names"');
    expect(html).toContain('>Alice<');

    // Main CSV: reaction summary columns
    const csv = fs.readFileSync(path.join(dir, 'csv', 'all.csv'), 'utf-8');
    expect(csv.split('\n')[0]).toContain('like_count');
    expect(csv.split('\n')[0]).not.toContain(',reactions'); // nested column removed

    // Tidy reactions.csv: one row per reactor
    const reactionsCsv = fs.readFileSync(path.join(dir, 'csv', 'reactions.csv'), 'utf-8');
    const reactionLines = reactionsCsv.trim().split('\n');
    expect(reactionLines[0]).toBe('message_id,timestamp,sender,reaction_type,reaction_code,reactor_name,reactor_user_id');
    // msg-2 has 1 like + 2 emoji reactors = 3 rows
    expect(reactionLines.length).toBe(4);
    expect(reactionsCsv).toContain('msg-2');
    expect(reactionsCsv).toContain('like');
    expect(reactionsCsv).toContain('emoji');

    // JSON metadata includes the group name from getGroup
    expect(allJson.metadata.conversationName).toBe('Test Group');

    // Checkpoint cleared on successful completion
    expect(fs.existsSync(path.join(dir, '.groupme-export-state.json'))).toBe(false);

    // Verify the 304 was actually exercised — both message calls happened
    expect(messagesCalls).toBe(2);
  });

  it('exports a DM end-to-end with /users/me seeding the resolver', async () => {
    const dir = createTmpDir();

    let messagesCalls = 0;
    server.use(
      http.get(`${API_BASE_URL}/users/me`, () => {
        return HttpResponse.json({
          response: { user_id: 'u-self', name: 'Self' },
        });
      }),
      http.get(`${API_BASE_URL}/direct_messages`, () => {
        messagesCalls++;
        if (messagesCalls === 1) {
          return HttpResponse.json({
            response: {
              count: 1,
              direct_messages: [
                {
                  id: 'dm-1',
                  created_at: 1700000000,
                  user_id: 'u-other',
                  name: 'Other',
                  text: 'hey',
                  favorited_by: ['u-self'],
                  reactions: [],
                  attachments: [],
                },
              ],
            },
          });
        }
        return HttpResponse.json({
          response: { count: 0, direct_messages: [] },
        });
      })
    );

    const service = new GroupmeService('test-token');
    const orchestrator = new ExportOrchestrator(service);

    await orchestrator.exportConversation('chats', 'u-other', dir, true, false);

    const allJson = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    const msg = allJson.messages[0];
    expect(msg.reactions.likes[0]).toEqual({ user_id: 'u-self', name: 'Self' });
  });

  it('DM: resolver falls back to /users/me `id` when `user_id` is absent', async () => {
    const dir = createTmpDir();

    let messagesCalls = 0;
    server.use(
      // Older /users/me shape: only `id`, no `user_id`
      http.get(`${API_BASE_URL}/users/me`, () => {
        return HttpResponse.json({
          response: { id: 'self-id-only', name: 'Self' },
        });
      }),
      http.get(`${API_BASE_URL}/direct_messages`, () => {
        messagesCalls++;
        if (messagesCalls === 1) {
          return HttpResponse.json({
            response: {
              count: 1,
              direct_messages: [
                {
                  id: 'dm-1',
                  created_at: 1700000000,
                  user_id: 'u-other',
                  name: 'Other',
                  text: 'thx',
                  // Other person liked our message — uses our `id` value
                  favorited_by: ['self-id-only'],
                  reactions: [],
                  attachments: [],
                },
              ],
            },
          });
        }
        return HttpResponse.json({ response: { count: 0, direct_messages: [] } });
      })
    );

    const service = new GroupmeService('test-token');
    const orchestrator = new ExportOrchestrator(service);

    await orchestrator.exportConversation('chats', 'u-other', dir, true, false);

    const allJson = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    const msg = allJson.messages[0];
    // Self resolved to "Self" via fallback to `id` field
    expect(msg.reactions.likes[0]).toEqual({ user_id: 'self-id-only', name: 'Self' });
  });

  it('continues export when getGroup fails — falls back to message-cache', async () => {
    const dir = createTmpDir();

    server.use(
      http.get(`${API_BASE_URL}/groups/g-broken`, () => {
        return new HttpResponse(null, { status: 401 });
      }),
      http.get(`${API_BASE_URL}/groups/g-broken/messages`, () => {
        return new HttpResponse(null, { status: 304 });
      })
    );

    const service = new GroupmeService('test-token');
    const orchestrator = new ExportOrchestrator(service);

    // Should still complete (empty export)
    await orchestrator.exportConversation('groups', 'g-broken', dir, true, false);

    const allJson = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    expect(allJson.metadata.messageCount).toBe(0);
  });
});
