import {
  Conversation,
  GroupMeApiResponse,
  GroupMessagesResponse,
  DirectMessagesResponse,
  Message,
  Group,
  CurrentUser,
} from './model.js';
import { ApiError } from './errors.js';

const API_BASE_URL = 'https://api.groupme.com/v3';
/** GroupMe's max page size for both conversation lists and message history. */
export const PAGE_SIZE = 100;
/** Abort a single HTTP request if the server hasn't responded in this long. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Upper bound on how long we'll honor a server-supplied Retry-After (guards against a hostile/buggy value). */
const MAX_RETRY_AFTER_MS = 120_000;

/** Remove the `token` query parameter from any string before logging, so the secret never lands in console output. */
export function redactToken(message: string): string {
  return message.replace(/([?&]token=)[^&\s]+/gi, '$1<redacted>');
}

export class GroupmeService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getConversations(conversationType: string): Promise<Conversation[]> {
    const allConversations: Conversation[] = [];
    let page = 1;

    while (true) {
      const body = await this.makeRequestWithRetries<GroupMeApiResponse<Conversation[]>>(
        conversationType,
        { token: this.accessToken, page, per_page: PAGE_SIZE },
        5
      );

      const conversations: Conversation[] | undefined = body.response;
      if (!conversations || conversations.length === 0) {
        break;
      }

      allConversations.push(...conversations);

      if (conversations.length < PAGE_SIZE) {
        break;
      }
      page++;
    }

    return allConversations;
  }

  async getGroup(groupId: string): Promise<Group> {
    const body = await this.makeRequestWithRetries<GroupMeApiResponse<Group>>(
      `groups/${groupId}`,
      { token: this.accessToken },
      5
    );
    return body.response;
  }

  async getCurrentUser(): Promise<CurrentUser> {
    const body = await this.makeRequestWithRetries<GroupMeApiResponse<CurrentUser>>(
      'users/me',
      { token: this.accessToken },
      5
    );
    return body.response;
  }

  async getMessages(conversationType: string, chatId: string, beforeId?: string): Promise<Message[]> {
    const url = conversationType === 'groups' ? `groups/${chatId}/messages` : 'direct_messages';
    const params: Record<string, string | number> = {
      token: this.accessToken,
      limit: PAGE_SIZE,
    };
    if (conversationType === 'chats') {
      params.other_user_id = chatId;
    }
    if (beforeId) {
      params.before_id = beforeId;
    }

    try {
      const body =
        conversationType === 'groups'
          ? await this.makeRequestWithRetries<GroupMeApiResponse<GroupMessagesResponse>>(url, params, 5)
          : await this.makeRequestWithRetries<GroupMeApiResponse<DirectMessagesResponse>>(url, params, 5);
      // GroupMe occasionally returns `{ response: null }` for empty/edge states; guard before dereferencing.
      if (!body.response) {
        return [];
      }
      const messages: Message[] | undefined =
        conversationType === 'groups'
          ? (body as GroupMeApiResponse<GroupMessagesResponse>).response.messages
          : (body as GroupMeApiResponse<DirectMessagesResponse>).response.direct_messages;
      return messages || [];
    } catch (error: unknown) {
      // GroupMe returns 304 Not Modified when `before_id` is past the start of
      // history. Treat as end-of-history rather than a fatal error.
      if (error instanceof ApiError && error.statusCode === 304) {
        return [];
      }
      throw error;
    }
  }

  async makeRequestWithRetries<T>(
    url: string,
    params: Record<string, string | number>,
    maxRetries: number
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          searchParams.set(key, String(value));
        }
        const response = await fetch(`${API_BASE_URL}/${url}?${searchParams}`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          const retryAfterHeader = response.headers.get('Retry-After');
          const parsed = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
          const retryAfterSeconds = !isNaN(parsed) ? parsed : undefined;
          throw new ApiError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            retryable,
            retryAfterSeconds
          );
        }

        if (attempt > 0) {
          console.log('Resolved!\n');
        }
        try {
          return (await response.json()) as T;
        } catch {
          // A 2xx with an unparseable body (e.g. an HTML error page from a proxy) is not retryable.
          throw new ApiError('Invalid JSON in API response', response.status, false);
        }
      } catch (error: unknown) {
        const isRetryable = error instanceof ApiError ? error.retryable : true; // network errors are retryable
        const message = redactToken(error instanceof Error ? error.message : String(error));

        if (!isRetryable || attempt >= maxRetries) {
          if (attempt >= maxRetries) {
            console.error(`Max retries (${maxRetries}) reached. Giving up.`);
          }
          throw error;
        }

        let delay: number;
        if (error instanceof ApiError && error.retryAfterSeconds) {
          delay = Math.min(error.retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
          console.error(`Rate limited. Waiting ${delay / 1000}s (Retry-After). Attempt ${attempt + 1}/${maxRetries}`);
        } else {
          delay = Math.min(1000 * Math.pow(2, attempt), 16000); // 1s, 2s, 4s, 8s, 16s
          console.error(`Error: ${message}. Retrying in ${delay / 1000}s (${attempt + 1}/${maxRetries})`);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error('Unreachable: retry loop exited without returning or throwing');
  }
}
