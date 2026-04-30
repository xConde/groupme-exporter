import { describe, it, expect, beforeEach } from 'vitest';
import { UserResolver } from './userResolver.js';
import type { Message, GroupMember } from './model.js';

function makeMessage(overrides: Partial<Message> & { id: string; created_at: number; name: string }): Message {
  return { text: null, attachments: [], ...overrides };
}

describe('UserResolver', () => {
  let resolver: UserResolver;

  beforeEach(() => {
    resolver = new UserResolver();
  });

  describe('resolve', () => {
    it('falls back to user_id when not seeded', () => {
      expect(resolver.resolve('unknown-uid')).toBe('unknown-uid');
    });

    it('returns mapped name after seeding', () => {
      resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Alice' }]);
      expect(resolver.resolve('u1')).toBe('Alice');
    });
  });

  describe('seedFromGroupMembers', () => {
    it('populates members correctly', () => {
      const members: GroupMember[] = [
        { user_id: 'u1', nickname: 'Alice' },
        { user_id: 'u2', nickname: 'Bob', image_url: 'http://img.jpg' },
      ];
      resolver.seedFromGroupMembers(members);
      expect(resolver.resolve('u1')).toBe('Alice');
      expect(resolver.resolve('u2')).toBe('Bob');
      expect(resolver.size()).toBe(2);
    });

    it('skips members with missing user_id or nickname', () => {
      // Cast to bypass TS strictness — simulating bad API data
      resolver.seedFromGroupMembers([
        { user_id: '', nickname: 'NoId' } as GroupMember,
        { user_id: 'u3', nickname: '' } as GroupMember,
      ]);
      expect(resolver.size()).toBe(0);
    });
  });

  describe('observeMessages', () => {
    it('fills missing names from messages', () => {
      const msgs = [
        makeMessage({ id: '1', created_at: 100, name: 'Alice', user_id: 'u1' }),
      ];
      resolver.observeMessages(msgs);
      expect(resolver.resolve('u1')).toBe('Alice');
    });

    it('does NOT overwrite existing mapping', () => {
      resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Seeded Alice' }]);
      const msgs = [
        makeMessage({ id: '1', created_at: 100, name: 'Different Alice', user_id: 'u1' }),
      ];
      resolver.observeMessages(msgs);
      expect(resolver.resolve('u1')).toBe('Seeded Alice');
    });

    it('skips messages without user_id or name', () => {
      resolver.observeMessages([
        makeMessage({ id: '1', created_at: 100, name: '' }),
        makeMessage({ id: '2', created_at: 200, name: 'Bob' }),
      ]);
      expect(resolver.size()).toBe(0);
    });
  });

  describe('seedFromDmParticipants', () => {
    it('seeds both self and other participant', () => {
      resolver.seedFromDmParticipants({ user_id: 'me', name: 'Me' }, 'them', 'Them');
      expect(resolver.resolve('me')).toBe('Me');
      expect(resolver.resolve('them')).toBe('Them');
      expect(resolver.size()).toBe(2);
    });

    it('skips empty user_id or name', () => {
      resolver.seedFromDmParticipants({ user_id: '', name: 'Me' }, '', 'Them');
      // Both are empty strings which are falsy — neither should be seeded
      expect(resolver.size()).toBe(0);
    });

    it('skips empty other values', () => {
      resolver.seedFromDmParticipants({ user_id: 'me', name: 'Me' }, 'them', '');
      // other name is empty — only self seeded
      expect(resolver.size()).toBe(1);
      expect(resolver.resolve('me')).toBe('Me');
    });
  });

  describe('resolveMany', () => {
    it('maps all user_ids to names', () => {
      resolver.seedFromGroupMembers([
        { user_id: 'u1', nickname: 'Alice' },
        { user_id: 'u2', nickname: 'Bob' },
      ]);
      expect(resolver.resolveMany(['u1', 'u2', 'u3'])).toEqual(['Alice', 'Bob', 'u3']);
    });

    it('returns empty array for empty input', () => {
      expect(resolver.resolveMany([])).toEqual([]);
    });
  });

  describe('size', () => {
    it('tracks count across multiple seed operations', () => {
      expect(resolver.size()).toBe(0);
      resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Alice' }]);
      expect(resolver.size()).toBe(1);
      resolver.seedFromDmParticipants({ user_id: 'u2', name: 'Bob' }, 'u3', 'Carol');
      expect(resolver.size()).toBe(3);
    });

    it('does not double-count same user_id', () => {
      resolver.seedFromGroupMembers([{ user_id: 'u1', nickname: 'Alice' }]);
      resolver.observeMessages([makeMessage({ id: '1', created_at: 100, name: 'Alice', user_id: 'u1' })]);
      expect(resolver.size()).toBe(1);
    });
  });
});
