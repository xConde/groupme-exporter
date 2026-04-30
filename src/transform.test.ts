import { describe, it, expect } from 'vitest';
import { appendMessages, appendMediaMessageIds, groupMessagesByYear, getMediaFiles, chunkArray, generateStats, formatReactions, reactionCount } from './transform.js';
import { Message } from './model.js';
import { UserResolver } from './userResolver.js';

function makeMessage(overrides: Partial<Message> & { id: string; created_at: number; name: string }): Message {
  return { text: null, attachments: [], ...overrides };
}

describe('chunkArray', () => {
  it('should split array into chunks', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('should handle empty array', () => {
    expect(chunkArray([], 3)).toEqual([]);
  });
  it('should handle chunk size larger than array', () => {
    expect(chunkArray([1, 2], 5)).toEqual([[1, 2]]);
  });
});

describe('groupMessagesByYear', () => {
  it('should group messages by year', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', created_at: 1688000000, name: 'Alice' }), // 2023-06-29
      makeMessage({ id: '2', created_at: 1720000000, name: 'Bob' }),   // 2024-07-03
      makeMessage({ id: '3', created_at: 1688086400, name: 'Alice' }), // 2023-06-30
    ];
    const result = groupMessagesByYear(messages);
    expect(Object.keys(result)).toEqual(['2023', '2024']);
    expect(result['2023']).toHaveLength(2);
    expect(result['2024']).toHaveLength(1);
  });
  it('should handle empty array', () => {
    expect(groupMessagesByYear([])).toEqual({});
  });
});

describe('appendMessages', () => {
  it('should concat all messages when saveChatHistory is true', () => {
    const existing = [makeMessage({ id: '1', created_at: 100, name: 'A' })];
    const newMsgs = [makeMessage({ id: '2', created_at: 200, name: 'B' })];
    const result = appendMessages(existing, newMsgs, true);
    expect(result).toHaveLength(2);
  });
  it('should only keep attachment messages when saveChatHistory is false', () => {
    const existing: Message[] = [];
    const newMsgs = [
      makeMessage({ id: '1', created_at: 100, name: 'A' }),
      makeMessage({ id: '2', created_at: 200, name: 'B', attachments: [{ type: 'image', url: 'http://img.jpg', created_at: 200 }] }),
    ];
    const result = appendMessages(existing, newMsgs, false);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });
});

describe('appendMediaMessageIds', () => {
  it('should accumulate IDs of messages with attachments', () => {
    const msgs = [
      makeMessage({ id: '1', created_at: 100, name: 'A' }),
      makeMessage({ id: '2', created_at: 200, name: 'B', attachments: [{ type: 'image', url: 'x', created_at: 200 }] }),
    ];
    const result = appendMediaMessageIds([], msgs, true);
    expect(result).toEqual(['2']);
  });
});

describe('getMediaFiles', () => {
  it('should extract image and video attachments as MediaFile objects', () => {
    const msgs: Message[] = [
      makeMessage({
        id: '1', created_at: 1672531200, name: 'A',
        attachments: [
          { type: 'image', url: 'http://i.groupme.com/100x100.png.abc', created_at: 0 },
          { type: 'video', url: 'http://v.groupme.com/vid.mp4', created_at: 0 },
        ],
      }),
    ];
    const result = getMediaFiles([], msgs);
    expect(result).toHaveLength(2);
    expect(result[0].mediaType).toBe('photo');
    expect(result[0].mediaExt).toBe('.png');
    expect(result[1].mediaType).toBe('video');
    expect(result[1].mediaExt).toBe('.mp4');
  });
  it('should filter by mediaMessageIds when provided', () => {
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 100, name: 'A', attachments: [{ type: 'image', url: 'x', created_at: 0 }] }),
      makeMessage({ id: '2', created_at: 200, name: 'B', attachments: [{ type: 'image', url: 'y', created_at: 0 }] }),
    ];
    const result = getMediaFiles(['1'], msgs);
    expect(result).toHaveLength(1);
  });
  it('should ignore non-media attachment types', () => {
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 100, name: 'A', attachments: [{ type: 'location', url: '', created_at: 0 }] }),
    ];
    const result = getMediaFiles([], msgs);
    expect(result).toHaveLength(0);
  });
});

describe('generateStats', () => {
  it('should compute correct stats', () => {
    const msgs: Message[] = [
      makeMessage({ id: '2', created_at: 1672617600, name: 'Bob', attachments: [{ type: 'image', url: 'x', created_at: 0 }] }),
      makeMessage({ id: '1', created_at: 1672531200, name: 'Alice' }),
    ];
    const stats = generateStats(msgs);
    expect(stats.totalMessages).toBe(2);
    expect(stats.messagesPerUser['Alice']).toBe(1);
    expect(stats.messagesPerUser['Bob']).toBe(1);
    expect(stats.mediaCountByType['image']).toBe(1);
  });
  it('should handle empty messages', () => {
    const stats = generateStats([]);
    expect(stats.totalMessages).toBe(0);
    expect(stats.dateRange.first).toBe('N/A');
  });
});

describe('formatReactions', () => {
  it('returns empty arrays for message with no reactions', () => {
    const msg = makeMessage({ id: '1', created_at: 100, name: 'Alice' });
    const result = formatReactions(msg);
    expect(result.likes).toEqual([]);
    expect(result.emojis).toEqual([]);
  });

  it('resolves favorited_by with resolver', () => {
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([
      { user_id: 'u1', nickname: 'Alice' },
      { user_id: 'u2', nickname: 'Bob' },
    ]);
    const msg = makeMessage({ id: '1', created_at: 100, name: 'Carol', favorited_by: ['u1', 'u2'] });
    const result = formatReactions(msg, resolver);
    expect(result.likes).toHaveLength(2);
    expect(result.likes[0]).toEqual({ user_id: 'u1', name: 'Alice' });
    expect(result.likes[1]).toEqual({ user_id: 'u2', name: 'Bob' });
  });

  it('resolves reactions array with resolver', () => {
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Alice' }]);
    const msg = makeMessage({
      id: '1', created_at: 100, name: 'Carol',
      reactions: [{ type: 'emoji', code: '🎉', user_ids: ['u1', 'u99'] }],
    });
    const result = formatReactions(msg, resolver);
    expect(result.emojis).toHaveLength(1);
    expect(result.emojis[0].code).toBe('🎉');
    expect(result.emojis[0].users[0]).toEqual({ user_id: 'u1', name: 'Alice' });
    expect(result.emojis[0].users[1]).toEqual({ user_id: 'u99', name: 'u99' }); // fallback
  });

  it('falls back to user_id as name when no resolver provided', () => {
    const msg = makeMessage({ id: '1', created_at: 100, name: 'Alice', favorited_by: ['uid-abc'] });
    const result = formatReactions(msg);
    expect(result.likes[0]).toEqual({ user_id: 'uid-abc', name: 'uid-abc' });
  });
});

describe('reactionCount', () => {
  it('returns 0 for message with no reactions', () => {
    const msg = makeMessage({ id: '1', created_at: 100, name: 'Alice' });
    expect(reactionCount(msg)).toBe(0);
  });

  it('counts favorited_by only', () => {
    const msg = makeMessage({ id: '1', created_at: 100, name: 'Alice', favorited_by: ['u1', 'u2'] });
    expect(reactionCount(msg)).toBe(2);
  });

  it('counts emoji reaction user_ids only', () => {
    const msg = makeMessage({
      id: '1', created_at: 100, name: 'Alice',
      reactions: [
        { type: 'emoji', code: '🎉', user_ids: ['u1', 'u2'] },
        { type: 'emoji', code: '🔥', user_ids: ['u3'] },
      ],
    });
    expect(reactionCount(msg)).toBe(3);
  });

  it('sums favorited_by + all emoji reaction user_ids', () => {
    const msg = makeMessage({
      id: '1', created_at: 100, name: 'Alice',
      favorited_by: ['u1'],
      reactions: [{ type: 'emoji', code: '🎉', user_ids: ['u2', 'u3'] }],
    });
    expect(reactionCount(msg)).toBe(3);
  });
});

describe('generateStats reactions metrics', () => {
  it('totalLikes, totalEmojiReactions, totalReactions are computed correctly', () => {
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 100, name: 'Alice', favorited_by: ['u1', 'u2'] }),
      makeMessage({
        id: '2', created_at: 200, name: 'Bob',
        reactions: [{ type: 'emoji', code: '🎉', user_ids: ['u1', 'u3'] }],
      }),
    ];
    const stats = generateStats(msgs);
    expect(stats.totalLikes).toBe(2);
    expect(stats.totalEmojiReactions).toBe(2);
    expect(stats.totalReactions).toBe(4);
  });

  it('topReactors ordered desc and truncated to 10', () => {
    // Create 12 unique reactor users, with varying counts
    const msgs: Message[] = Array.from({ length: 12 }, (_, i) => {
      const uid = `u${i}`;
      return makeMessage({
        id: String(i), created_at: 100 + i, name: 'Sender',
        // user i likes messages 0..i (so u0 has 1, u1 has 2, ..., u11 has 12)
        favorited_by: Array.from({ length: i + 1 }, (_, j) => `u${j}`),
      });
    });
    const stats = generateStats(msgs);
    expect(stats.topReactors).toHaveLength(10);
    // u0 appears in all 12 messages so should be first
    expect(stats.topReactors[0].user_id).toBe('u0');
    // descending order
    for (let i = 1; i < stats.topReactors.length; i++) {
      expect(stats.topReactors[i].count).toBeLessThanOrEqual(stats.topReactors[i - 1].count);
    }
  });

  it('topReactors resolves names via resolver', () => {
    const resolver = new UserResolver();
    resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Alice' }]);
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 100, name: 'Sender', favorited_by: ['u1'] }),
    ];
    const stats = generateStats(msgs, resolver);
    expect(stats.topReactors[0].name).toBe('Alice');
  });

  it('topReactedMessages truncated to 5 and sorted desc by reactionCount', () => {
    const msgs: Message[] = Array.from({ length: 7 }, (_, i) =>
      makeMessage({
        id: String(i), created_at: 100 + i, name: 'Alice',
        favorited_by: Array.from({ length: i + 1 }, (_, j) => `u${j}`),
      })
    );
    const stats = generateStats(msgs);
    expect(stats.topReactedMessages).toHaveLength(5);
    for (let i = 1; i < stats.topReactedMessages.length; i++) {
      expect(stats.topReactedMessages[i].reactionCount).toBeLessThanOrEqual(stats.topReactedMessages[i - 1].reactionCount);
    }
  });

  it('emojiBreakdown counts emoji reactions by code', () => {
    const msgs: Message[] = [
      makeMessage({
        id: '1', created_at: 100, name: 'Alice',
        reactions: [
          { type: 'emoji', code: '🎉', user_ids: ['u1', 'u2'] },
          { type: 'emoji', code: '🔥', user_ids: ['u3'] },
        ],
      }),
      makeMessage({
        id: '2', created_at: 200, name: 'Bob',
        reactions: [{ type: 'emoji', code: '🎉', user_ids: ['u4'] }],
      }),
    ];
    const stats = generateStats(msgs);
    expect(stats.emojiBreakdown['🎉']).toBe(3);
    expect(stats.emojiBreakdown['🔥']).toBe(1);
  });

  it('returns zero reaction fields for messages with no reactions', () => {
    const msgs: Message[] = [
      makeMessage({ id: '1', created_at: 100, name: 'Alice' }),
    ];
    const stats = generateStats(msgs);
    expect(stats.totalReactions).toBe(0);
    expect(stats.totalLikes).toBe(0);
    expect(stats.totalEmojiReactions).toBe(0);
    expect(stats.topReactors).toEqual([]);
    expect(stats.topReactedMessages).toEqual([]);
    expect(stats.emojiBreakdown).toEqual({});
  });
});
