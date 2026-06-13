import { describe, it, expect, afterEach, vi } from 'vitest';
import { logMessage } from './display.js';
import type { Message } from './model.js';

function makeMessage(o: Partial<Message> & { id: string; created_at: number; name: string }): Message {
  return { text: null, attachments: [], ...o };
}

// Build 5 messages with created_at values within the same hour (< 2 hours apart).
// All within a 10-minute window starting at the base timestamp.
function makeFiveMessages(baseCreatedAt: number): Message[] {
  return [
    makeMessage({ id: '1', created_at: baseCreatedAt, name: 'Alice', text: 'msg 1' }),
    makeMessage({ id: '2', created_at: baseCreatedAt + 120, name: 'Bob', text: 'msg 2' }),
    makeMessage({ id: '3', created_at: baseCreatedAt + 240, name: 'Carol', text: 'msg 3' }),
    makeMessage({ id: '4', created_at: baseCreatedAt + 360, name: 'Dave', text: 'msg 4' }),
    makeMessage({ id: '5', created_at: baseCreatedAt + 480, name: 'Eve', text: 'msg 5' }),
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logMessage', () => {
  it('prints a snippet when Math.random()=0, factor=150, lastMessageId=300 with >=5 messages within 2 hours', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // factor = floor(0*641)+150 = 150; 300%150===0
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const base = 1672531200; // 2023-01-01T00:00:00Z
    const messages = makeFiveMessages(base);
    logMessage(messages, '300');

    expect(logSpy).toHaveBeenCalled();
  });

  it('is a no-op when the modulo gate does NOT hit (Math.random=0 -> factor=150, lastMessageId=301 -> 301%150!==0)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const base = 1672531200;
    const messages = makeFiveMessages(base);
    logMessage(messages, '301');

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when messages.length < 5 even if the modulo gate hits', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // factor=150; lastMessageId='300' -> hits
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const msgs = [makeMessage({ id: '1', created_at: 1672531200, name: 'Alice', text: 'only msg' })];
    logMessage(msgs, '300');

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('a message with text:null does NOT produce the literal string "null" in console.log output and does not throw', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // factor=150; '300'%150===0
    const loggedStrings: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      loggedStrings.push(args.map((a) => String(a)).join(' '));
    });

    const base = 1672531200;
    const messages = [
      makeMessage({ id: '1', created_at: base, name: 'Alice', text: 'hello' }),
      makeMessage({ id: '2', created_at: base + 60, name: 'Bob', text: null }), // null text
      makeMessage({ id: '3', created_at: base + 120, name: 'Carol', text: 'world' }),
      makeMessage({ id: '4', created_at: base + 180, name: 'Dave', text: 'foo' }),
      makeMessage({ id: '5', created_at: base + 240, name: 'Eve', text: 'bar' }),
    ];

    expect(() => logMessage(messages, '300')).not.toThrow();
    // The gate should have fired (300%150===0, length>=5, timeDiff < 2 hours)
    expect(loggedStrings.length).toBeGreaterThan(0);
    // None of the logged strings should contain the literal word 'null'
    for (const line of loggedStrings) {
      expect(line).not.toContain('null');
    }
  });
});
