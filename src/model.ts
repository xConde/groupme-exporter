import moment from 'moment';

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
    text: string;
    name: string;
    attachments?: Attachment[];
}

export interface MediaFile {
    mediaType: 'photo' | 'video';
    mediaUrl: string;
    mediaExt: string;
    sentAt: moment.Moment;
}
