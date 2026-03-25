import { Conversation, GroupMeApiResponse, GroupMessagesResponse, DirectMessagesResponse, Message } from './model.js';
import { ApiError } from './errors.js';

const API_BASE_URL = "https://api.groupme.com/v3";

export class GroupmeService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getConversations(conversationType: string): Promise<Conversation[]> {
    let allConversations: Conversation[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const body = await this.makeRequestWithRetries<GroupMeApiResponse<Conversation[]>>(
        conversationType,
        { token: this.accessToken, page, per_page: perPage },
        5
      );

      const conversations: Conversation[] = body.response;
      if (!conversations || conversations.length === 0) { break; }

      allConversations = allConversations.concat(conversations);

      if (conversations.length < perPage) { break; }
      page++;
    }

    return allConversations;
  }

  async getMessages(conversationType: string, chatId: string, beforeId?: string): Promise<Message[]> {
    const url = conversationType === 'groups' ? `groups/${chatId}/messages` : 'direct_messages';
    const params: Record<string, string | number> = {
      token: this.accessToken,
      limit: 100
    };
    if (conversationType === 'chats') {
      params.other_user_id = chatId;
    }
    if (beforeId) {
      params.before_id = beforeId;
    }

    const body = conversationType === 'groups'
      ? await this.makeRequestWithRetries<GroupMeApiResponse<GroupMessagesResponse>>(url, params, 5)
      : await this.makeRequestWithRetries<GroupMeApiResponse<DirectMessagesResponse>>(url, params, 5);
    const messages: Message[] | undefined = conversationType === 'groups'
      ? (body as GroupMeApiResponse<GroupMessagesResponse>).response.messages
      : (body as GroupMeApiResponse<DirectMessagesResponse>).response.direct_messages;
    return messages || [];
  }

  async makeRequestWithRetries<T>(url: string, params: Record<string, string | number>, maxRetries: number): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          searchParams.set(key, String(value));
        }
        const response = await fetch(`${API_BASE_URL}/${url}?${searchParams}`);

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

        if (attempt > 0) { console.log('Resolved!\n'); }
        return await response.json() as T;
      } catch (error: unknown) {
        const isRetryable = error instanceof ApiError ? error.retryable : true; // network errors are retryable
        const message = error instanceof Error ? error.message : String(error);

        if (!isRetryable || attempt >= maxRetries) {
          if (attempt >= maxRetries) {
            console.log(`Max retries (${maxRetries}) reached. Giving up.`);
          }
          throw error;
        }

        let delay: number;
        if (error instanceof ApiError && error.retryAfterSeconds) {
          delay = error.retryAfterSeconds * 1000;
          console.log(`Rate limited. Waiting ${delay / 1000}s (Retry-After). Attempt ${attempt + 1}/${maxRetries}`);
        } else {
          delay = Math.min(1000 * Math.pow(2, attempt), 16000); // 1s, 2s, 4s, 8s, 16s
          console.log(`Error: ${message}. Retrying in ${delay / 1000}s (${attempt + 1}/${maxRetries})`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('Unreachable: retry loop exited without returning or throwing');
  }

}
