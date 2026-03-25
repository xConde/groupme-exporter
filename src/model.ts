import type dayjs from 'dayjs';

export interface GroupMeApiResponse<T> {
  response: T;
  meta: { code: number; errors?: string[] };
}

export interface GroupMessagesResponse {
  count: number;
  messages: Message[];
}

export interface DirectMessagesResponse {
  count: number;
  direct_messages: Message[];
}

export interface Conversation {
    id: string;
    name: string;
    other_user?: {
        id: string;
        name: string;
    };
}

export interface Attachment {
    type: string;
    url: string;
    created_at: number;
    name?: string;
}

export interface Message {
    id: string;
    created_at: number;
    text: string | null;
    name: string;
    attachments?: Attachment[];
}

export interface MediaFile {
    mediaType: 'photo' | 'video' | 'file';
    mediaUrl: string;
    mediaExt: string;
    sentAt: dayjs.Dayjs;
}
