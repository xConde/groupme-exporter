import * as fs from 'node:fs';
import * as path from 'node:path';
import { Message } from './model.js';
import { GroupmeService } from './service.js';
import { logMessage } from './display.js';
import { appendMessages, appendMediaMessageIds, generateStats } from './transform.js';
import { initiateDownloadMediaFiles, writeChatHistory, writeJsonExport, writeHtmlExport, writeCsvExport } from './download.js';
import { ExportState, loadState, saveState, clearState } from './checkpoint.js';

export class ExportOrchestrator {
  private service: GroupmeService;

  constructor(service: GroupmeService) {
    this.service = service;
  }

  async exportConversation(
    conversationType: string,
    chatId: string,
    outputDir: string,
    saveChatHistory: boolean,
    downloadMedia: boolean = true
  ): Promise<void> {
    let allMessages: Message[] = [];
    let lastMessageId: string | undefined = undefined;
    let mediaMessageIds: string[] = [];
    let fetchCount = 0;
    let isResuming = false;

    // Check for existing state to resume
    const existingState = loadState(outputDir);
    if (existingState && existingState.chatId === chatId && existingState.lastMessageId) {
      lastMessageId = existingState.lastMessageId;
      fetchCount = existingState.messagesProcessed;
      isResuming = true;
      console.log(`Resuming export from message ${lastMessageId} (${fetchCount} messages already processed)`);
      if (saveChatHistory) {
        console.log('Note: Chat history and JSON exports will only contain messages from the resume point forward.');
      }
    }

    const startTime = Date.now();

    try {
      while (true) {
        const messages = await this.service.getMessages(conversationType, chatId, lastMessageId);
        if (!messages || messages.length === 0) { break; }

        lastMessageId = messages[messages.length - 1].id;
        fetchCount += messages.length;
        logMessage(messages, lastMessageId);

        allMessages = appendMessages(allMessages, messages, true);
        mediaMessageIds = appendMediaMessageIds(mediaMessageIds, messages, saveChatHistory);

        // Save checkpoint after each batch
        saveState(outputDir, {
          conversationType,
          chatId,
          lastMessageId,
          messagesProcessed: fetchCount,
          startedAt: existingState?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        console.log(`Fetched ${fetchCount} messages...`);
      }

      const fetchElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\nFetched ${fetchCount} messages in ${fetchElapsed}s`);

      if (downloadMedia) {
        await initiateDownloadMediaFiles(allMessages, mediaMessageIds, outputDir, chatId);
      }

      if (saveChatHistory) {
        writeChatHistory(allMessages, outputDir);
        console.log('Chat history saved.');
      }

      writeJsonExport(allMessages, outputDir, {
        exportDate: new Date().toISOString(),
        totalMessages: fetchCount,
      });
      console.log('JSON export saved.');

      writeHtmlExport(allMessages, outputDir);
      console.log('HTML export saved.');

      writeCsvExport(allMessages, outputDir);
      console.log('CSV export saved.');

      const stats = generateStats(allMessages);
      // Save stats to file
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'stats.json'), JSON.stringify(stats, null, 2));

      // Display summary
      console.log('\n--- Export Summary ---');
      console.log(`Total messages: ${stats.totalMessages}`);
      console.log(`Date range: ${stats.dateRange.first} to ${stats.dateRange.last}`);
      console.log(`Most active day: ${stats.mostActiveDay}`);
      console.log(`Top contributors:`);
      const topUsers = Object.entries(stats.messagesPerUser).sort((a, b) => b[1] - a[1]).slice(0, 5);
      for (const [name, count] of topUsers) {
        console.log(`  ${name}: ${count} messages`);
      }
      if (Object.keys(stats.mediaCountByType).length > 0) {
        console.log(`Media: ${Object.entries(stats.mediaCountByType).map(([type, count]) => `${count} ${type}s`).join(', ')}`);
      }
      console.log('---');

      // Export complete — clean up state file
      clearState(outputDir);
    } catch (error: unknown) {
      console.log('Export interrupted. Progress saved — run again to resume.');
      throw error;
    }
  }
}
