import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
dayjs.extend(advancedFormat);
import { createSpinner } from 'nanospinner';
import { MediaFile, Message } from './model.js';
import { getMediaFiles, chunkArray, groupMessagesByYear } from './transform.js';

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

export function writeJsonExport(allMessages: Message[], outputDir: string, metadata: { conversationName?: string; exportDate: string; totalMessages: number }): void {
  const jsonDir = path.join(outputDir, 'json');
  fs.mkdirSync(jsonDir, { recursive: true });

  const chronologicalMessages = [...allMessages].reverse();
  const messagesByYear = groupMessagesByYear(chronologicalMessages);

  // Per-year files
  for (const year of Object.keys(messagesByYear).sort()) {
    const yearData = {
      metadata: { ...metadata, year, messageCount: messagesByYear[year].length },
      messages: messagesByYear[year].map(formatMessageJson),
    };
    fs.writeFileSync(path.join(jsonDir, `${year}.json`), JSON.stringify(yearData, null, 2));
  }

  // Consolidated file
  const allData = {
    metadata: { ...metadata, messageCount: chronologicalMessages.length },
    messages: chronologicalMessages.map(formatMessageJson),
  };
  fs.writeFileSync(path.join(jsonDir, 'all.json'), JSON.stringify(allData, null, 2));
}

function formatMessageJson(message: Message): Record<string, unknown> {
  return {
    id: message.id,
    created_at: message.created_at,
    timestamp: dayjs.unix(message.created_at).format('YYYY-MM-DD HH:mm:ss'),
    sender: message.name,
    text: message.text,
    attachments: (message.attachments || []).map(a => ({
      type: a.type,
      url: a.url,
    })),
  };
}

export function writeChatHistory(allMessages: Message[], outputDir: string): void {
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
    return `[${timestamp}] ${message.name}: ${text}${attachmentIndicators}`;
  };

  for (const year of Object.keys(messagesByYear)) {
    const lines = messagesByYear[year].map(formatMessage).join('\n');
    fs.writeFileSync(path.join(chatHistoryDir, `${year}.txt`), lines);
  }

  const allLines = chronologicalMessages.map(formatMessage).join('\n');
  fs.writeFileSync(path.join(chatHistoryDir, 'all.txt'), allLines);
}

export function writeHtmlExport(allMessages: Message[], outputDir: string): void {
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

  const renderMessage = (message: Message): string => {
    const timestamp = dayjs.unix(message.created_at).format('YYYY-MM-DD HH:mm:ss');
    const name = escapeHtml(message.name);
    const text = message.text ? escapeHtml(message.text) : '';
    const attachments = (message.attachments || []).map(a => {
      if (a.type === 'image') return `<img src="${escapeHtml(a.url)}" alt="Photo" style="max-width:300px;border-radius:8px;margin-top:4px;">`;
      if (a.type === 'video') return `<a href="${escapeHtml(a.url)}" target="_blank">[Video]</a>`;
      return `<span class="attachment">[${escapeHtml(a.type)}]</span>`;
    }).join('');

    return `<div class="message">
      <div class="meta"><strong>${name}</strong> <span class="time">${timestamp}</span></div>
      <div class="text">${text}</div>
      ${attachments ? `<div class="attachments">${attachments}</div>` : ''}
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

export function writeCsvExport(allMessages: Message[], outputDir: string): void {
  const csvDir = path.join(outputDir, 'csv');
  fs.mkdirSync(csvDir, { recursive: true });

  const chronologicalMessages = [...allMessages].reverse();
  const messagesByYear = groupMessagesByYear(chronologicalMessages);

  const csvHeader = 'timestamp,sender,text,attachment_count,attachment_types\n';

  const escapeCsv = (value: string): string => {
    // RFC 4180: if value contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const formatRow = (message: Message): string => {
    const timestamp = dayjs.unix(message.created_at).format('YYYY-MM-DD HH:mm:ss');
    const sender = escapeCsv(message.name);
    const text = escapeCsv(message.text ?? '');
    const attachments = message.attachments || [];
    const attachmentCount = String(attachments.length);
    const attachmentTypes = escapeCsv(attachments.map(a => a.type).join(';'));
    return `${timestamp},${sender},${text},${attachmentCount},${attachmentTypes}`;
  };

  // Per-year files
  for (const year of Object.keys(messagesByYear).sort()) {
    const rows = messagesByYear[year].map(formatRow).join('\n');
    fs.writeFileSync(path.join(csvDir, `${year}.csv`), csvHeader + rows);
  }

  // Consolidated file
  const allRows = chronologicalMessages.map(formatRow).join('\n');
  fs.writeFileSync(path.join(csvDir, 'all.csv'), csvHeader + allRows);
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
