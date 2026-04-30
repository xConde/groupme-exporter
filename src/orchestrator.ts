import * as fs from 'node:fs';
import * as path from 'node:path';
import { Message } from './model.js';
import { GroupmeService } from './service.js';
import { logMessage } from './display.js';
import { appendMessages, appendMediaMessageIds, generateStats } from './transform.js';
import { initiateDownloadMediaFiles, writeChatHistory, writeJsonExport, writeHtmlExport, writeCsvExport } from './download.js';
import { ExportState, loadState, saveState, clearState } from './checkpoint.js';
import { UserResolver } from './userResolver.js';

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
    const resolver = new UserResolver();
    let conversationName: string | undefined;

    try {
      if (conversationType === 'groups') {
        try {
          const group = await this.service.getGroup(chatId);
          resolver.seedFromGroupMembers(group.members ?? []);
          conversationName = group.name;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`Could not fetch group members for reaction name resolution: ${message}. Falling back to message-cache only.`);
        }
      } else {
        try {
          const me = await this.service.getCurrentUser();
          // /users/me may return either `user_id` or `id`; prefer user_id, fall back to id.
          const selfId = me.user_id ?? me.id ?? '';
          resolver.seedFromDmParticipants({ user_id: selfId, name: me.name }, '', '');
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`Could not fetch current user for DM reaction resolution: ${message}. Falling back to message-cache only.`);
        }
      }

      let batchesFetched = 0;
      while (true) {
        const messages = await this.service.getMessages(conversationType, chatId, lastMessageId);
        if (!messages || messages.length === 0) {
          // GroupMe returns 304/empty when before_id is past start of history. If
          // this happens before any batch was fetched, the conversation is empty.
          // If it happens mid-export *before* a partial batch (< 100), it's a real
          // anomaly — log it so we'd notice rather than silently truncate.
          if (batchesFetched > 0 && lastMessageId !== undefined) {
            const partial = fetchCount % 100 !== 0;
            if (!partial) {
              console.log('Note: end-of-history signaled at a 100-multiple boundary. If the conversation is unexpectedly short, re-run to verify.');
            }
          }
          break;
        }
        batchesFetched++;

        resolver.observeMessages(messages);
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
        writeChatHistory(allMessages, outputDir, resolver);
        console.log('Chat history saved.');
      }

      writeJsonExport(allMessages, outputDir, {
        conversationName,
        exportDate: new Date().toISOString(),
        totalMessages: fetchCount,
      }, resolver);
      console.log('JSON export saved.');

      writeHtmlExport(allMessages, outputDir, resolver);
      console.log('HTML export saved.');

      writeCsvExport(allMessages, outputDir, resolver);
      console.log('CSV export saved.');

      const stats = generateStats(allMessages, resolver);
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
