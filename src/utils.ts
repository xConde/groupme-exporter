import * as fs from 'fs';
import * as path from 'path';
import * as moment from 'moment';
import axios from 'axios';
import ora from 'ora';
import prompts from 'prompts';
import { terminal as term } from 'terminal-kit';
import { MediaFile, Message } from './model';

export async function getAccessToken(): Promise<string> {
    const { accessToken } = await prompts({
      type: 'text',
      name: 'accessToken',
      message: 'Enter your GroupMe API access token:',
      validate: value => value.trim() ? true : 'Access token is required',
    });
  
    return accessToken.trim();
  }

export async function getConversationType(): Promise<string> {
    const conversationTypeLabels = {
      'Groups': 'groups',
      'Direct Messages': 'chats',
      'Exit': 'exit'
    };
    const conversationTypes = Object.keys(conversationTypeLabels);
    term.bold('Select conversation type:\n');
  
    const selectedConversationTypeIndex: number = await new Promise((resolve) => {
      term.singleColumnMenu(conversationTypes, (error, response) => {
        if (error) {
          console.error(error);
          process.exit(1);
        }
        resolve(response.selectedIndex);
      });
    });
    
    const conversationTypeKey = conversationTypes[selectedConversationTypeIndex];
    const conversationTypeValue = conversationTypeLabels[conversationTypeKey];
    await term.bold(`Selected ${conversationTypeKey}\n`);
    if (conversationTypeValue === 'exit') { process.exit(0); }
    return conversationTypeValue;
}

export async function getConversationId(conversations: any[], conversationType): Promise<string> {
    const choiceIsGroup = conversationType === 'groups';
    const conversationChoices = conversations.map((c: any) => ({
      title: choiceIsGroup ? c.name : c.other_user.name,
      value: choiceIsGroup ? c.id : c.other_user.id,
    }));
  
    await term.bold(`Select a ${choiceIsGroup ? 'group' : 'chat'} to download:\n`);
  
    const conversationTitles = conversationChoices.map((c: any) => c.title);
    const selectedConversationIndex: number = await new Promise((resolve) => {
      term.singleColumnMenu(conversationTitles.concat(['Exit']), (error, response) => {
        if (error) {
          console.error(error);
          process.exit(1);
        }
        resolve(response.selectedIndex);
      });
    });
  
    if (selectedConversationIndex === conversationTitles.length) { process.exit(0); }
  
    console.log(`Downloading media from ${conversationChoices[selectedConversationIndex].title}\n`);
    return conversationChoices[selectedConversationIndex].value;
}

export async function promptOutputDir(): Promise<string> {
  let outputDir: string;

  while (true) {
    const { inputDir } = await prompts({
      type: 'text',
      name: 'inputDir',
      message: 'Enter the directory where you want the media to be downloaded. If it does not exist, it will be created. (e.g. /path/to/folder)',
      validate: value => {
        if (!value.trim()) return 'Output directory is required';
        if (!value.startsWith('/')) return 'Output directory must start with /';
        return true;
      },
    });

    outputDir = inputDir.trim().replace(/\/{2,}/g, '/');

    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: `Confirm output directory: ${outputDir}`,
      initial: true,
    });

    if (confirmed) {
      break;
    }
  }

  return outputDir;
}

export async function promptSaveChatHistory(): Promise<boolean> {
  const { saveChatHistory } = await prompts({
    type: 'confirm',
    name: 'saveChatHistory',
    message: 'Would you like to save a copy of your chat history to a file? This will generate a separate file for each year in the chat, and one consolidated file for the entire chat history.',
  });

  return saveChatHistory;
}

export function logMessage(messages: Message[], lastMessageId: string): void {
  const randomFactor = Math.floor(Math.random() * 641) + 150;
  if (Number(lastMessageId) % randomFactor === 0) {
    const finalMessageIndex = messages.length - 1;
    const startMessageIndex = finalMessageIndex - 4;
    const finalMessage = messages[finalMessageIndex];
    const timeDiff = moment.unix(finalMessage.created_at).diff(moment.unix(messages[startMessageIndex].created_at), 'hours');
    if (timeDiff < 2) {
      const messagesToShow = messages.slice(startMessageIndex + 1).reverse();
      term.moveTo(1, term.height - 1).deleteLine().moveTo(1, term.height - 1);
      term.bold(`---- ${moment.unix(messages[finalMessageIndex].created_at).format('MMMM Do YYYY')} ----\n`);
      messagesToShow.forEach((message) => {
        term(`${moment.unix(message.created_at).format('h:mm:ss A')} | `).green(`${message.name}: `).white(`${message.text}\n`);
      });
      term('----\n');
    } else {
      term.moveTo(1, term.height - 1).deleteLine().moveTo(1, term.height - 1);
      term(`${moment.unix(finalMessage.created_at).format('MMMM Do YYYY, h:mm:ss A')} | `).green(`${finalMessage.name}: `).white(`${finalMessage.text}\n`);
    }
  }
}

export function appendMessages(allMessages: Message[], messages: Message[], saveChatHistory: boolean): Message[] {
  return saveChatHistory ? allMessages.concat(messages) : allMessages.concat(getAttachmentMessages(messages));
}

export function appendMediaMessageIds(mediaMessageIds: string[], messages: Message[], saveChatHistory): string[] {
  if (!saveChatHistory) { return []; }
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

export async function initiateDownloadMediaFiles(allMessages, mediaMessageIds, outputDir, chatId) {
  const mediaFiles = getMediaFiles(mediaMessageIds, allMessages);
  
  const batchSize = 10;
  const batches = chunkArray(mediaFiles, batchSize);

  let successfulDownloads = 0;
  let totalDownloads = 0;

  for (const batch of batches) {
    try {
      await downloadMediaFiles(mediaFiles, outputDir, chatId, batchSize);
      successfulDownloads += batch.length;
    } catch (error: any) {
      console.error(`Error downloading media: ${error.message}`);
    }
    totalDownloads += batch.length;
  }

  console.log(`Download complete: ${successfulDownloads} out of ${totalDownloads} media files saved to ${outputDir}`);
}

function getMediaFiles(mediaMessageIds: string[], allMessages: Message[]): MediaFile[] {
  if (mediaMessageIds) { allMessages.filter(m => mediaMessageIds.includes(m.id)); }
  return allMessages
    .flatMap(m => {
      const attachments = (m.attachments || []).map(attachment => ({
        ...attachment,
        created_at: m.created_at,
      }));
      return attachments;
    })
    .map(a => {
      const media = a as { type: 'image' | 'video'; url: string; created_at: number };
      const mediaType = media.type === 'image' ? 'photo' : 'video';

      return {
        mediaType: mediaType,
        mediaUrl: media.url,
        mediaExt: mediaType === 'photo' ? '.jpeg' : '.mp4',
        sentAt: moment.unix(media.created_at),
      };
    });
}

export async function downloadMediaFiles(mediaFiles: MediaFile[], outputDir: string, otherUserId: string, batchSize: number = 10): Promise<void> {
  console.log(`Downloading ${mediaFiles.length} media files...`);
  
  const totalBatches = Math.ceil(mediaFiles.length / batchSize);
  const batchSpinner = ora().start();
  let lastProgress = 0;

  for (let i = 0; i < totalBatches; i++) {
    const batch = mediaFiles.slice(i * batchSize, (i + 1) * batchSize);
    const mediaCounts: { [date: string]: number } = {};
    await Promise.all(batch.map(async (media) => {
      const mediaFilename = createFilename(media, mediaCounts);
      const mediaPath = createMediaPath(media, mediaFilename, outputDir);

      if (!media.mediaUrl) { return; }
      const response = await axios({
        method: 'get',
        url: media.mediaUrl,
        responseType: 'stream',
      });

      const stream = response.data.pipe(fs.createWriteStream(mediaPath));
      await new Promise(resolve => stream.on('finish', resolve));
      const progress = Math.floor((i * batchSize + mediaFiles.indexOf(media) + 1) / mediaFiles.length * 100);
      if (progress - lastProgress >= 3) {
        lastProgress = progress;
        batchSpinner.text = `Downloaded ${i * batchSize + mediaFiles.indexOf(media) + 1} / ${mediaFiles.length} media files | ${mediaFilename}`;
        batchSpinner.render();
      }
    }));
  }

  batchSpinner.succeed(`Download complete: ${mediaFiles.length} media files saved to ${outputDir}`);
  batchSpinner.stop();
}

function createFilename(media: MediaFile, mediaCounts: { [date: string]: number }) {
  const dateStr = media.sentAt.format('MM-DD-YYYY');
  if (!mediaCounts[dateStr]) { mediaCounts[dateStr] = 0; }
  mediaCounts[dateStr]++;
  const hasDateDupe = mediaCounts[dateStr] > 1 ? `_${mediaCounts[dateStr]}` : '';
  return `${media.sentAt.format('MM-DD-YYYY')}${hasDateDupe}${media.mediaExt}`
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

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
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

function getAttachmentMessages(messages: Message[]) {
  return messages.filter(m => m.attachments && m.attachments.length > 0)
}
