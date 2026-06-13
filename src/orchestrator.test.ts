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

    // Should NOT throw: 304 is the natural end of history for groups
    await orchestrator.exportConversation('groups', 'g-1', dir, true, false);

    // JSON export populated
    const allJson = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    expect(allJson.metadata.messageCount).toBe(2);

    // Find Bob's reacted message in chronological output
    const bobMsg = allJson.messages.find((m: { id: string }) => m.id === 'msg-2');
    expect(bobMsg.reactions).toBeDefined();
    expect(bobMsg.reactions.likes).toEqual([{ user_id: 'u-alice', name: 'Alice' }]);
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
    expect(reactionLines[0]).toBe(
      'message_id,timestamp,sender,reaction_type,reaction_code,reactor_name,reactor_user_id'
    );
    // msg-2 has 1 like + 2 emoji reactors = 3 rows
    expect(reactionLines.length).toBe(4);
    expect(reactionsCsv).toContain('msg-2');
    expect(reactionsCsv).toContain('like');
    expect(reactionsCsv).toContain('emoji');

    // JSON metadata includes the group name from getGroup
    expect(allJson.metadata.conversationName).toBe('Test Group');

    // Checkpoint cleared on successful completion
    expect(fs.existsSync(path.join(dir, '.groupme-export-state.json'))).toBe(false);

    // Verify the 304 was actually exercised: both message calls happened
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
                  // Other person liked our message, uses our `id` value
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

  it('continues export when getGroup fails, falls back to message-cache', async () => {
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

  it('resume reloads cached messages and produces a COMPLETE export', async () => {
    const dir = createTmpDir();

    // Simulate a prior interrupted run: 2 messages already fetched (newest-first) and cached.
    const msgB = {
      id: 'mb',
      created_at: 1700000200,
      user_id: 'u-bob',
      name: 'Bob',
      text: 'newest',
      favorited_by: [],
      reactions: [],
      attachments: [],
    };
    const msgA = {
      id: 'ma',
      created_at: 1700000100,
      user_id: 'u-alice',
      name: 'Alice',
      text: 'middle',
      favorited_by: [],
      reactions: [],
      attachments: [],
    };
    fs.writeFileSync(
      path.join(dir, '.groupme-messages.jsonl'),
      JSON.stringify(msgB) + '\n' + JSON.stringify(msgA) + '\n'
    );
    fs.writeFileSync(
      path.join(dir, '.groupme-export-state.json'),
      JSON.stringify({
        conversationType: 'groups',
        chatId: 'g-1',
        lastMessageId: 'ma',
        messagesProcessed: 2,
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    const observedBeforeIds: (string | null)[] = [];
    let messagesCalls = 0;
    server.use(
      http.get(`${API_BASE_URL}/groups/g-1`, () =>
        HttpResponse.json({
          response: { id: 'g-1', name: 'Test Group', members: [{ user_id: 'u-carol', nickname: 'Carol' }] },
        })
      ),
      http.get(`${API_BASE_URL}/groups/g-1/messages`, ({ request }) => {
        observedBeforeIds.push(new URL(request.url).searchParams.get('before_id'));
        messagesCalls++;
        if (messagesCalls === 1) {
          return HttpResponse.json({
            response: {
              count: 1,
              messages: [
                {
                  id: 'mc',
                  created_at: 1700000000,
                  user_id: 'u-carol',
                  name: 'Carol',
                  text: 'oldest',
                  favorited_by: [],
                  reactions: [],
                  attachments: [],
                },
              ],
            },
          });
        }
        return new HttpResponse(null, { status: 304 }); // end of history
      })
    );

    const orchestrator = new ExportOrchestrator(new GroupmeService('test-token'));
    await orchestrator.exportConversation('groups', 'g-1', dir, true, false);

    // The first resumed request must continue from the cache's oldest id (gapless, no restart).
    expect(observedBeforeIds[0]).toBe('ma');

    // The export contains ALL THREE messages in chronological order, not just the resumed one.
    const allJson = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    expect(allJson.metadata.messageCount).toBe(3);
    expect(allJson.messages.map((m: { id: string }) => m.id)).toEqual(['mc', 'ma', 'mb']);

    // Stats count matches the actual exported messages.
    const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf-8'));
    expect(stats.totalMessages).toBe(3);

    // Checkpoint and cache are cleaned up on success.
    expect(fs.existsSync(path.join(dir, '.groupme-export-state.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.groupme-messages.jsonl'))).toBe(false);
  });

  it('uses the message cache (not the state lastMessageId) as the resume cursor', async () => {
    const dir = createTmpDir();

    // The cache is the source of truth. Even though state.lastMessageId disagrees,
    // the orchestrator must continue from the OLDEST cached message (last cache line).
    const m3 = {
      id: 'm3',
      created_at: 1700000300,
      user_id: 'u1',
      name: 'A',
      text: 'newest',
      favorited_by: [],
      reactions: [],
      attachments: [],
    };
    const m2 = {
      id: 'm2',
      created_at: 1700000200,
      user_id: 'u1',
      name: 'A',
      text: 'mid',
      favorited_by: [],
      reactions: [],
      attachments: [],
    };
    const m1 = {
      id: 'm1',
      created_at: 1700000100,
      user_id: 'u1',
      name: 'A',
      text: 'oldest',
      favorited_by: [],
      reactions: [],
      attachments: [],
    };
    fs.writeFileSync(
      path.join(dir, '.groupme-messages.jsonl'),
      [m3, m2, m1].map((m) => JSON.stringify(m)).join('\n') + '\n'
    );
    fs.writeFileSync(
      path.join(dir, '.groupme-export-state.json'),
      JSON.stringify({
        conversationType: 'groups',
        chatId: 'g-1',
        lastMessageId: 'bogus-state-id',
        messagesProcessed: 99,
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    const observedBeforeIds: (string | null)[] = [];
    server.use(
      http.get(`${API_BASE_URL}/groups/g-1`, () =>
        HttpResponse.json({ response: { id: 'g-1', name: 'G', members: [] } })
      ),
      http.get(`${API_BASE_URL}/groups/g-1/messages`, ({ request }) => {
        observedBeforeIds.push(new URL(request.url).searchParams.get('before_id'));
        return new HttpResponse(null, { status: 304 }); // nothing older
      })
    );

    await new ExportOrchestrator(new GroupmeService('test-token')).exportConversation(
      'groups',
      'g-1',
      dir,
      true,
      false
    );

    expect(observedBeforeIds[0]).toBe('m1'); // oldest cached, NOT 'bogus-state-id'
    const allJson = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    expect(allJson.messages.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('aborts rather than deleting a message cache that has no valid checkpoint', async () => {
    const dir = createTmpDir();
    // A populated cache with NO state file must never be silently destroyed.
    fs.writeFileSync(
      path.join(dir, '.groupme-messages.jsonl'),
      JSON.stringify({ id: 'x', created_at: 1700000000, name: 'A', text: 'precious', attachments: [] }) + '\n'
    );

    await expect(
      new ExportOrchestrator(new GroupmeService('test-token')).exportConversation('groups', 'g-1', dir, true, false)
    ).rejects.toThrow(/cannot be safely resumed/);

    // The cache must still be intact (not deleted).
    expect(fs.existsSync(path.join(dir, '.groupme-messages.jsonl'))).toBe(true);
  });

  it('does NOT resume when the checkpoint is for a different conversation type, starts fresh', async () => {
    const dir = createTmpDir();

    // Stale checkpoint/cache from a DM export, but we now ask for a group with the same id.
    fs.writeFileSync(
      path.join(dir, '.groupme-messages.jsonl'),
      JSON.stringify({
        id: 'stale',
        created_at: 1699999999,
        name: 'Ghost',
        text: 'should be discarded',
        attachments: [],
      }) + '\n'
    );
    fs.writeFileSync(
      path.join(dir, '.groupme-export-state.json'),
      JSON.stringify({
        conversationType: 'chats',
        chatId: 'g-1',
        lastMessageId: 'stale',
        messagesProcessed: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    const observedBeforeIds: (string | null)[] = [];
    let messagesCalls = 0;
    server.use(
      http.get(`${API_BASE_URL}/groups/g-1`, () =>
        HttpResponse.json({
          response: { id: 'g-1', name: 'Test Group', members: [] },
        })
      ),
      http.get(`${API_BASE_URL}/groups/g-1/messages`, ({ request }) => {
        observedBeforeIds.push(new URL(request.url).searchParams.get('before_id'));
        messagesCalls++;
        if (messagesCalls === 1) {
          return HttpResponse.json({
            response: {
              count: 1,
              messages: [
                {
                  id: 'fresh',
                  created_at: 1700000000,
                  user_id: 'u1',
                  name: 'Alice',
                  text: 'fresh start',
                  favorited_by: [],
                  reactions: [],
                  attachments: [],
                },
              ],
            },
          });
        }
        return new HttpResponse(null, { status: 304 });
      })
    );

    const orchestrator = new ExportOrchestrator(new GroupmeService('test-token'));
    await orchestrator.exportConversation('groups', 'g-1', dir, true, false);

    // Fresh start: the first request had no before_id, and the stale cached message is gone.
    expect(observedBeforeIds[0]).toBeNull();
    const allJson = JSON.parse(fs.readFileSync(path.join(dir, 'json', 'all.json'), 'utf-8'));
    expect(allJson.metadata.messageCount).toBe(1);
    expect(allJson.messages[0].id).toBe('fresh');
    expect(allJson.messages.find((m: { id: string }) => m.id === 'stale')).toBeUndefined();
  });
});
