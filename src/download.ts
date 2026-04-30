import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
dayjs.extend(advancedFormat);
import { createSpinner } from 'nanospinner';
import { MediaFile, Message } from './model.js';
import { getMediaFiles, chunkArray, groupMessagesByYear, formatReactions } from './transform.js';
import { UserResolver } from './userResolver.js';

export async function initiateDownloadMediaFiles(allMessages: Message[], mediaMessageIds: string[], outputDir: string, chatId: string) {
  const mediaFiles = getMediaFiles(mediaMessageIds, allMessages);

  const batchSize = 10;
  const batches = chunkArray(mediaFiles, batchSize);

  let successfulDownloads = 0;
  let totalDownloads = 0;

  for (const batch of batches) {
    try {
      await downloadMediaFiles(batch, outputDir, chatId, batchSize);
      successfulDownloads += batch.length;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error downloading media: ${message}`);
    }
    totalDownloads += batch.length;
  }

  console.log(`Download complete: ${successfulDownloads} out of ${totalDownloads} media files saved to ${outputDir}`);
}

export async function downloadMediaFiles(mediaFiles: MediaFile[], outputDir: string, chatId: string, batchSize: number = 10): Promise<void> {
  if (mediaFiles.length === 0) { return; }

  console.log(`Processing ${mediaFiles.length} media files...`);

  // Pre-generate all filenames synchronously to avoid race conditions
  const mediaCounts: { [date: string]: number } = {};
  const filePlan = mediaFiles.map(media => {
    const mediaFilename = createFilename(media, mediaCounts);
    const mediaPath = createMediaPath(media, mediaFilename, outputDir);
    return { media, mediaFilename, mediaPath };
  });

  const batchSpinner = createSpinner('Downloading...').start();
  let downloaded = 0;
  let skipped = 0;

  const batches = chunkArray(filePlan, batchSize);
  for (const batch of batches) {
    await Promise.all(batch.map(async ({ media, mediaFilename, mediaPath }) => {
      // Skip if already exists
      if (fs.existsSync(mediaPath)) {
        skipped++;
        return;
      }

      if (!media.mediaUrl || (!media.mediaUrl.startsWith('http://') && !media.mediaUrl.startsWith('https://'))) { return; }
      const response = await fetch(media.mediaUrl);
      if (!response.ok || !response.body) { return; }
      // Cast needed: DOM ReadableStream and Node ReadableStream types are incompatible
      const readable = Readable.fromWeb(response.body as any);
      const stream = readable.pipe(fs.createWriteStream(mediaPath));
      await new Promise(resolve => stream.on('finish', resolve));
      downloaded++;

      batchSpinner.update({ text: `${downloaded} downloaded, ${skipped} skipped / ${mediaFiles.length} total | ${mediaFilename}` });
    }));
  }

  batchSpinner.success({ text: `Complete: ${downloaded} new, ${skipped} skipped out of ${mediaFiles.length} media files` });
}

export function writeJsonExport(allMessages: Message[], outputDir: string, metadata: { conversationName?: string; exportDate: string; totalMessages: number }, resolver?: UserResolver): void {
  const jsonDir = path.join(outputDir, 'json');
  fs.mkdirSync(jsonDir, { recursive: true });

  const chronologicalMessages = [...allMessages].reverse();
  const messagesByYear = groupMessagesByYear(chronologicalMessages);

  // Per-year files
  for (const year of Object.keys(messagesByYear).sort()) {
    const yearData = {
      metadata: { ...metadata, year, messageCount: messagesByYear[year].length },
      messages: messagesByYear[year].map(m => formatMessageJson(m, resolver)),
    };
    fs.writeFileSync(path.join(jsonDir, `${year}.json`), JSON.stringify(yearData, null, 2));
  }

  // Consolidated file
  const allData = {
    metadata: { ...metadata, messageCount: chronologicalMessages.length },
    messages: chronologicalMessages.map(m => formatMessageJson(m, resolver)),
  };
  fs.writeFileSync(path.join(jsonDir, 'all.json'), JSON.stringify(allData, null, 2));
}

function formatMessageJson(message: Message, resolver?: UserResolver): Record<string, unknown> {
  const reactions = formatReactions(message, resolver);
  const hasReactions = reactions.likes.length > 0 || reactions.emojis.length > 0;
  return {
    id: message.id,
    created_at: message.created_at,
    timestamp: dayjs.unix(message.created_at).format('YYYY-MM-DD HH:mm:ss'),
    sender: message.name,
    sender_id: message.user_id,
    text: message.text,
    attachments: (message.attachments || []).map(a => ({
      type: a.type,
      url: a.url,
    })),
    ...(hasReactions ? { reactions } : {}),
  };
}

export function writeChatHistory(allMessages: Message[], outputDir: string, resolver?: UserResolver): void {
  const chatHistoryDir = path.join(outputDir, 'chat-history');
  fs.mkdirSync(chatHistoryDir, { recursive: true });

  const chronologicalMessages = [...allMessages].reverse();
  const messagesByYear = groupMessagesByYear(chronologicalMessages);

  const formatMessage = (message: Message): string => {
    const timestamp = dayjs.unix(message.created_at).format('YYYY-MM-DD HH:mm:ss');
    const text = message.text ?? '';
    const attachmentIndicators = (message.attachments || [])
      .map(a => {
        if (a.type === 'image' || a.type === 'linked_image') return ' [📷 Photo]';
        if (a.type === 'video') return ' [🎥 Video]';
        if (a.type === 'file') return ' [📄 File]';
        if (a.type === 'location') return ' [📍 Location]';
        return ' [📎 Attachment]';
      })
      .join('');
    const main = `[${timestamp}] ${message.name}: ${text}${attachmentIndicators}`;
    const reactionsLine = formatReactionsTextLine(message, resolver);
    return reactionsLine ? `${main}\n${reactionsLine}` : main;
  };

  for (const year of Object.keys(messagesByYear)) {
    const lines = messagesByYear[year].map(formatMessage).join('\n');
    fs.writeFileSync(path.join(chatHistoryDir, `${year}.txt`), lines);
  }

  const allLines = chronologicalMessages.map(formatMessage).join('\n');
  fs.writeFileSync(path.join(chatHistoryDir, 'all.txt'), allLines);
}

function formatReactionsTextLine(message: Message, resolver?: UserResolver): string {
  const r = formatReactions(message, resolver);
  if (r.likes.length === 0 && r.emojis.length === 0) return '';
  const parts: string[] = [];
  if (r.likes.length > 0) {
    parts.push(`❤️ ${r.likes.map(u => u.name).join(', ')}`);
  }
  for (const e of r.emojis) {
    parts.push(`${e.code} ${e.users.map(u => u.name).join(', ')}`);
  }
  // Plain ASCII prefix so the file reads cleanly in older terminals, grep, less.
  return `  + ${parts.join(' | ')}`;
}

export function writeHtmlExport(allMessages: Message[], outputDir: string, resolver?: UserResolver): void {
  const htmlDir = path.join(outputDir, 'html');
  fs.mkdirSync(htmlDir, { recursive: true });

  const chronologicalMessages = [...allMessages].reverse();

  const escapeHtml = (text: string): string => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const renderReactions = (message: Message): string => {
    const r = formatReactions(message, resolver);
    if (r.likes.length === 0 && r.emojis.length === 0) return '';
    const pills: string[] = [];
    if (r.likes.length > 0) {
      const names = escapeHtml(r.likes.map(u => u.name).join(', '));
      pills.push(`<span class="reaction"><span class="emoji">❤️</span><span class="names">${names}</span></span>`);
    }
    for (const e of r.emojis) {
      const names = escapeHtml(e.users.map(u => u.name).join(', '));
      pills.push(`<span class="reaction"><span class="emoji">${escapeHtml(e.code)}</span><span class="names">${names}</span></span>`);
    }
    return `<div class="reactions">${pills.join('')}</div>`;
  };

  const renderMessage = (message: Message): string => {
    const timestamp = dayjs.unix(message.created_at).format('YYYY-MM-DD HH:mm:ss');
    const name = escapeHtml(message.name);
    const text = message.text ? escapeHtml(message.text) : '';
    const attachments = (message.attachments || []).map(a => {
      if (a.type === 'image') return `<img src="${escapeHtml(a.url)}" alt="Photo" style="max-width:300px;border-radius:8px;margin-top:4px;">`;
      if (a.type === 'video') return `<a href="${escapeHtml(a.url)}" target="_blank">[Video]</a>`;
      return `<span class="attachment">[${escapeHtml(a.type)}]</span>`;
    }).join('');
    const reactions = renderReactions(message);

    return `<div class="message">
      <div class="meta"><strong>${name}</strong> <span class="time">${timestamp}</span></div>
      <div class="text">${text}</div>
      ${attachments ? `<div class="attachments">${attachments}</div>` : ''}
      ${reactions}
    </div>`;
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GroupMe Chat Export</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f0f0; padding: 20px; }
  .container { max-width: 800px; margin: 0 auto; }
  h1 { text-align: center; margin-bottom: 20px; color: #333; }
  .message { background: #fff; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
  .meta { margin-bottom: 4px; }
  .meta strong { color: #00aff0; }
  .time { color: #999; font-size: 0.85em; margin-left: 8px; }
  .text { color: #333; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; }
  .attachments { margin-top: 8px; }
  .attachment { color: #666; font-style: italic; }
  .reactions { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
  .reaction { background: #f0f4f8; color: #333; border-radius: 12px; padding: 2px 10px; font-size: 0.85em; display: inline-flex; align-items: center; gap: 4px; }
  .reaction .emoji { font-size: 0.95em; }
  .reaction .names { color: #555; }
  @media (max-width: 480px) { .reaction { font-size: 0.8em; padding: 2px 8px; } }
  img { display: block; }
</style>
</head>
<body>
<div class="container">
<h1>GroupMe Chat Export</h1>
<p style="text-align:center;color:#666;margin-bottom:20px;">${chronologicalMessages.length} messages</p>
${chronologicalMessages.map(renderMessage).join('\n')}
</div>
</body>
</html>`;

  fs.writeFileSync(path.join(htmlDir, 'chat.html'), html);
}

export function writeCsvExport(allMessages: Message[], outputDir: string, resolver?: UserResolver): void {
  const csvDir = path.join(outputDir, 'csv');
  fs.mkdirSync(csvDir, { recursive: true });

  const chronologicalMessages = [...allMessages].reverse();
  const messagesByYear = groupMessagesByYear(chronologicalMessages);

  // Main message CSV: simple numeric reaction summary so analysts can sort/filter
  // without parsing nested formats. Full reactor detail lives in reactions.csv.
  const csvHeader = 'message_id,timestamp,sender,text,attachment_count,attachment_types,like_count,emoji_reaction_count\n';

  const escapeCsv = (value: string): string => {
    // RFC 4180: if value contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const formatRow = (message: Message): string => {
    const timestamp = dayjs.unix(message.created_at).format('YYYY-MM-DD HH:mm:ss');
    const messageId = escapeCsv(message.id);
    const sender = escapeCsv(message.name);
    const text = escapeCsv(message.text ?? '');
    const attachments = message.attachments || [];
    const attachmentCount = String(attachments.length);
    const attachmentTypes = escapeCsv(attachments.map(a => a.type).join(';'));
    const reactions = formatReactions(message, resolver);
    const likeCount = String(reactions.likes.length);
    const emojiReactionCount = String(reactions.emojis.reduce((sum, e) => sum + e.users.length, 0));
    return `${messageId},${timestamp},${sender},${text},${attachmentCount},${attachmentTypes},${likeCount},${emojiReactionCount}`;
  };

  // Per-year files
  for (const year of Object.keys(messagesByYear).sort()) {
    const rows = messagesByYear[year].map(formatRow).join('\n');
    fs.writeFileSync(path.join(csvDir, `${year}.csv`), csvHeader + rows);
  }

  // Consolidated file
  const allRows = chronologicalMessages.map(formatRow).join('\n');
  fs.writeFileSync(path.join(csvDir, 'all.csv'), csvHeader + allRows);

  // Tidy reactions file: one row per reactor, joinable by message_id.
  writeReactionsCsv(chronologicalMessages, csvDir, escapeCsv, resolver);
}

function writeReactionsCsv(
  chronologicalMessages: Message[],
  csvDir: string,
  escapeCsv: (value: string) => string,
  resolver?: UserResolver
): void {
  const header = 'message_id,timestamp,sender,reaction_type,reaction_code,reactor_name,reactor_user_id\n';
  const rows: string[] = [];
  for (const message of chronologicalMessages) {
    const timestamp = dayjs.unix(message.created_at).format('YYYY-MM-DD HH:mm:ss');
    const sender = escapeCsv(message.name);
    const messageId = escapeCsv(message.id);
    const r = formatReactions(message, resolver);
    for (const like of r.likes) {
      rows.push(`${messageId},${timestamp},${sender},like,${escapeCsv('❤️')},${escapeCsv(like.name)},${escapeCsv(like.user_id)}`);
    }
    for (const emoji of r.emojis) {
      for (const user of emoji.users) {
        rows.push(`${messageId},${timestamp},${sender},emoji,${escapeCsv(emoji.code)},${escapeCsv(user.name)},${escapeCsv(user.user_id)}`);
      }
    }
  }
  fs.writeFileSync(path.join(csvDir, 'reactions.csv'), header + rows.join('\n'));
}

function createFilename(media: MediaFile, mediaCounts: { [date: string]: number }) {
  const dateStr = media.sentAt.format('MM-DD-YYYY');
  if (!mediaCounts[dateStr]) { mediaCounts[dateStr] = 0; }
  mediaCounts[dateStr]++;
  const hasDateDupe = mediaCounts[dateStr] > 1 ? `_${mediaCounts[dateStr]}` : '';
  return `${media.sentAt.format('MM-DD-YYYY')}${hasDateDupe}${media.mediaExt}`;
}

function createMediaPath(media: MediaFile, mediaFilename: string, outputDir: string) {
  const year = media.sentAt.year() + '';
  const monthDirName = media.sentAt.format('MMM');
  const monthDirPath = path.join(outputDir, year, monthDirName);
  if (!fs.existsSync(monthDirPath)) {
    fs.mkdirSync(monthDirPath, { recursive: true });
  }

  return path.join(monthDirPath, mediaFilename);
}
