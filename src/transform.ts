import dayjs from 'dayjs';
import { MediaFile, Message } from './model.js';

export function appendMessages(allMessages: Message[], messages: Message[], saveChatHistory: boolean): Message[] {
  return saveChatHistory ? allMessages.concat(messages) : allMessages.concat(getAttachmentMessages(messages));
}

export function appendMediaMessageIds(mediaMessageIds: string[], messages: Message[], saveChatHistory: boolean): string[] {
  const mediaMessages = getAttachmentMessages(messages);
  const mediaIds = mediaMessages.map(m => m.id);
  return mediaMessageIds.concat(mediaIds);
}

export function groupMessagesByYear(messages: Message[]): { [year: string]: Message[] } {
  const messagesByYear: { [year: string]: Message[] } = {};
  for (const message of messages) {
    const sentAt = new Date(message.created_at * 1000);
    const year = sentAt.getFullYear().toString();

    if (!messagesByYear[year]) {
      messagesByYear[year] = [];
    }
    messagesByYear[year].push(message);
  }
  return messagesByYear;
}

export function getMediaFiles(mediaMessageIds: string[], allMessages: Message[]): MediaFile[] {
  if (mediaMessageIds.length > 0) { allMessages = allMessages.filter(m => mediaMessageIds.includes(m.id)); }
  return allMessages
    .flatMap(m =>
      (m.attachments || [])
        .filter(a => ['image', 'video', 'linked_image', 'file'].includes(a.type))
        .map(a => ({ type: a.type, url: a.url, name: a.name, created_at: m.created_at }))
    )
    .map(a => {
      let mediaType: 'photo' | 'video' | 'file';
      if (a.type === 'image' || a.type === 'linked_image') {
        mediaType = 'photo';
      } else if (a.type === 'video') {
        mediaType = 'video';
      } else {
        mediaType = 'file';
      }

      const mediaExt = mediaType === 'file'
        ? detectFileExtension(a.url, a.name)
        : detectMediaExtension(a.url, mediaType);

      return {
        mediaType,
        mediaUrl: a.url,
        mediaExt,
        sentAt: dayjs.unix(a.created_at),
      };
    });
}

function detectMediaExtension(url: string, mediaType: 'photo' | 'video'): string {
  if (!url) {
    return mediaType === 'photo' ? '.jpeg' : '.mp4';
  }
  try {
    const urlPath = new URL(url).pathname;
    const extensionMatch = urlPath.match(/\.(jpeg|jpg|png|gif|webp|mp4|mov|avi|webm)\b/i);
    if (extensionMatch) {
      return `.${extensionMatch[1].toLowerCase()}`;
    }
  } catch {
    // invalid URL, fall through to default
  }
  return mediaType === 'photo' ? '.jpeg' : '.mp4';
}

function detectFileExtension(url: string, name?: string): string {
  // Try to get extension from the file name first
  if (name) {
    const match = name.match(/\.(\w+)$/);
    if (match) return `.${match[1].toLowerCase()}`;
  }
  // Fall back to URL detection
  if (!url) return '';
  try {
    const urlPath = new URL(url).pathname;
    const match = urlPath.match(/\.(\w{2,5})$/);
    if (match) return `.${match[1].toLowerCase()}`;
  } catch { /* invalid URL */ }
  return '';
}

function getAttachmentMessages(messages: Message[]): Message[] {
  return messages.filter(m => m.attachments && m.attachments.length > 0);
}

export interface ExportStats {
  totalMessages: number;
  dateRange: { first: string; last: string };
  messagesPerUser: Record<string, number>;
  mediaCountByType: Record<string, number>;
  mostActiveDay: string;
  mostActiveMonth: string;
}

export function generateStats(messages: Message[]): ExportStats {
  const chronological = [...messages].reverse();

  const messagesPerUser: Record<string, number> = {};
  const mediaCountByType: Record<string, number> = {};
  const messagesByDay: Record<string, number> = {};
  const messagesByMonth: Record<string, number> = {};

  for (const message of chronological) {
    // Per-user count
    messagesPerUser[message.name] = (messagesPerUser[message.name] || 0) + 1;

    // Media by type
    for (const attachment of message.attachments || []) {
      mediaCountByType[attachment.type] = (mediaCountByType[attachment.type] || 0) + 1;
    }

    // Activity by day and month
    const day = dayjs.unix(message.created_at).format('YYYY-MM-DD');
    const month = dayjs.unix(message.created_at).format('YYYY-MM');
    messagesByDay[day] = (messagesByDay[day] || 0) + 1;
    messagesByMonth[month] = (messagesByMonth[month] || 0) + 1;
  }

  const sortedDays = Object.entries(messagesByDay).sort((a, b) => b[1] - a[1]);
  const sortedMonths = Object.entries(messagesByMonth).sort((a, b) => b[1] - a[1]);

  return {
    totalMessages: chronological.length,
    dateRange: {
      first: chronological.length > 0 ? dayjs.unix(chronological[0].created_at).format('YYYY-MM-DD') : 'N/A',
      last: chronological.length > 0 ? dayjs.unix(chronological[chronological.length - 1].created_at).format('YYYY-MM-DD') : 'N/A',
    },
    messagesPerUser,
    mediaCountByType,
    mostActiveDay: sortedDays[0]?.[0] ?? 'N/A',
    mostActiveMonth: sortedMonths[0]?.[0] ?? 'N/A',
  };
}

export function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  let chunk: T[] = [];

  for (const item of arr) {
    chunk.push(item);

    if (chunk.length === chunkSize) {
      result.push(chunk);
      chunk = [];
    }
  }

  if (chunk.length > 0) {
    result.push(chunk);
  }

  return result;
}
