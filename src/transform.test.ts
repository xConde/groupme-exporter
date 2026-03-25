import { describe, it, expect } from 'vitest';
import { appendMessages, appendMediaMessageIds, groupMessagesByYear, getMediaFiles, chunkArray, generateStats } from './transform.js';
import { Message } from './model.js';

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
