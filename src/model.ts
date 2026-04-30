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

export interface Reaction {
    type: string;
    code: string;
    user_ids: string[];
}

export interface Message {
    id: string;
    created_at: number;
    text: string | null;
    name: string;
    user_id?: string;
    system?: boolean;
    sender_type?: string;
    favorited_by?: string[];
    reactions?: Reaction[];
    attachments?: Attachment[];
}

export interface GroupMember {
    user_id: string;
    nickname: string;
    image_url?: string;
}

export interface Group {
    id: string;
    name: string;
    members: GroupMember[];
}

export interface CurrentUser {
    // GroupMe's /users/me returns both `id` and `user_id`; some response shapes
    // historically only carry one. Accept either to defensively resolve self.
    id?: string;
    user_id?: string;
    name: string;
}

export interface MediaFile {
    mediaType: 'photo' | 'video' | 'file';
    mediaUrl: string;
    mediaExt: string;
    sentAt: dayjs.Dayjs;
}
