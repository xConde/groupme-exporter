import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { GroupmeService } from './service.js';
import { ApiError } from './errors.js';

const API_BASE_URL = 'https://api.groupme.com/v3';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('GroupmeService', () => {
  const service = new GroupmeService('test-token');

  describe('getConversations', () => {
    it('should fetch and return conversations', async () => {
      server.use(
        http.get(`${API_BASE_URL}/groups`, ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('token')).toBe('test-token');
          return HttpResponse.json({
            response: [
              { id: '123', name: 'Test Group' },
            ],
          });
        })
      );

      const conversations = await service.getConversations('groups');
      expect(conversations).toHaveLength(1);
      expect(conversations[0].name).toBe('Test Group');
    });

    it('should paginate through multiple pages', async () => {
      let callCount = 0;
      server.use(
        http.get(`${API_BASE_URL}/groups`, () => {
          callCount++;
          if (callCount === 1) {
            // Return full page (100 items) to trigger pagination
            const items = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Group ${i}` }));
            return HttpResponse.json({ response: items });
          }
          // Second page: partial (triggers break)
          return HttpResponse.json({ response: [{ id: '100', name: 'Group 100' }] });
        })
      );

      const conversations = await service.getConversations('groups');
      expect(conversations).toHaveLength(101);
      expect(callCount).toBe(2);
    });
  });

  describe('getMessages', () => {
    it('should fetch group messages', async () => {
      server.use(
        http.get(`${API_BASE_URL}/groups/123/messages`, () => {
          return HttpResponse.json({
            response: {
              count: 1,
              messages: [
                { id: '1', created_at: 1672531200, text: 'Hello', name: 'Alice', attachments: [] },
              ],
            },
          });
        })
      );

      const messages = await service.getMessages('groups', '123');
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Hello');
    });

    it('should fetch DM messages with other_user_id param', async () => {
      server.use(
        http.get(`${API_BASE_URL}/direct_messages`, ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('other_user_id')).toBe('456');
          return HttpResponse.json({
            response: {
              count: 1,
              direct_messages: [
                { id: '2', created_at: 1672531200, text: 'Hi', name: 'Bob', attachments: [] },
              ],
            },
          });
        })
      );

      const messages = await service.getMessages('chats', '456');
      expect(messages).toHaveLength(1);
      expect(messages[0].name).toBe('Bob');
    });

    it('should return empty array when no messages', async () => {
      server.use(
        http.get(`${API_BASE_URL}/groups/123/messages`, () => {
          return HttpResponse.json({
            response: { count: 0, messages: [] },
          });
        })
      );

      const messages = await service.getMessages('groups', '123');
      expect(messages).toHaveLength(0);
    });
  });

  describe('makeRequestWithRetries', () => {
    it('should retry on 429 with exponential backoff', async () => {
      let attempt = 0;
      server.use(
        http.get(`${API_BASE_URL}/test`, () => {
          attempt++;
          if (attempt < 3) {
            return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '1' } });
          }
          return HttpResponse.json({ response: { data: 'ok' } });
        })
      );

      const result = await service.makeRequestWithRetries<{ response: { data: string } }>('test', { token: 'test-token' }, 5);
      expect(result.response.data).toBe('ok');
      expect(attempt).toBe(3);
    });

    it('should not retry on 401', async () => {
      server.use(
        http.get(`${API_BASE_URL}/test`, () => {
          return new HttpResponse(null, { status: 401 });
        })
      );

      await expect(service.makeRequestWithRetries('test', { token: 'bad' }, 3))
        .rejects.toThrow(ApiError);

      try {
        await service.makeRequestWithRetries('test', { token: 'bad' }, 3);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).statusCode).toBe(401);
        expect((error as ApiError).retryable).toBe(false);
      }
    });

    it('should retry on 500', async () => {
      let attempt = 0;
      server.use(
        http.get(`${API_BASE_URL}/test`, () => {
          attempt++;
          if (attempt < 2) {
            return new HttpResponse(null, { status: 500 });
          }
          return HttpResponse.json({ response: 'ok' });
        })
      );

      const result = await service.makeRequestWithRetries<{ response: string }>('test', { token: 'test-token' }, 5);
      expect(result.response).toBe('ok');
      expect(attempt).toBe(2);
    });
  });
});
