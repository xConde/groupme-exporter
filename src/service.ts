import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { Conversation, Message } from './model';
import { logMessage, appendMessages, appendMediaMessageIds, initiateDownloadMediaFiles } from './utils';

const API_BASE_URL = "https://api.groupme.com/v3";

export class GroupmeService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getConversations(conversationType: string): Promise<Conversation[]> {
    const response = await axios.get(`${API_BASE_URL}/${conversationType}`, {
      params: {
        token: this.accessToken,
      },
    });
    return response.data.response;
  }

  async downloadContent(
    conversationType: string,
    chatId: string,
    outputDir: string,
    saveChatHistory: boolean
  ) {
    let allMessages: Message[] = [];
    let lastMessageId: string | undefined = undefined;
    let mediaMessageIds: string[] = [];
    const url = conversationType === 'groups' ? `/groups/${chatId}/messages}` : 'direct_messages';
    while (true) {
      const config = this.buildConfig(chatId, lastMessageId);
      const response = await this.makeRequestWithRetries(url, config, 5);

      const messages: Message[] = response.data.response.direct_messages;
      if (messages.length === 0) { break; }
  
      lastMessageId = messages[messages.length - 1].id;
      logMessage(messages, lastMessageId);
  
      allMessages = appendMessages(allMessages, messages, saveChatHistory);
      mediaMessageIds = appendMediaMessageIds(mediaMessageIds, messages, saveChatHistory);
    }
  
    initiateDownloadMediaFiles(allMessages, mediaMessageIds, outputDir, chatId);
  }

  private buildConfig(otherUserId: string, lastMessageId?: string): { [key: string]: any } {
    const params: { [key: string]: any } = {
      token: this.accessToken,
      other_user_id: otherUserId,
      limit: 20,
      timeout: 10000
    };
    if (lastMessageId) {
      params.before_id = lastMessageId;
    }
    return params;
  }
  
  async makeRequestWithRetries(url: string, params: any, maxRetries: number): Promise<AxiosResponse> {
    let numRetries = 0;
    while (numRetries <= maxRetries) {
      try {
        const response = await axios.get(`${API_BASE_URL}/${url}`, { params });
        if (numRetries > 0) { console.log('Resolved!\n'); }
        return response;
      } catch (error: any) {
        console.log(`Error making request: ${error.message}.`);
        if (numRetries < maxRetries) {
          console.log(`Attempting request again (${numRetries + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 4000));
          numRetries++;
        } else {
          console.log(`Max retries (${maxRetries}) reached. Giving up.`);
          throw error;
        }
      }
    }

    const config = params as AxiosRequestConfig;
    return { data: null, status: 500, statusText: 'Internal Server Error', headers: {}, config };
  }
  
}
