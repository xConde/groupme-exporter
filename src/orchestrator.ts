import * as fs from 'node:fs';
import * as path from 'node:path';
import { Message } from './model.js';
import { GroupmeService, PAGE_SIZE, redactToken } from './service.js';
import { logMessage } from './display.js';
import { generateStats } from './transform.js';
import {
  initiateDownloadMediaFiles,
  writeChatHistory,
  writeJsonExport,
  writeHtmlExport,
  writeCsvExport,
} from './download.js';
import {
  loadState,
  saveState,
  clearState,
  loadMessagesCache,
  appendMessagesToCache,
  clearMessagesCache,
  getMessagesCachePath,
} from './checkpoint.js';
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
    const allMessages: Message[] = [];
    let lastMessageId: string | undefined = undefined;
    const mediaMessageIds: string[] = [];
    let fetchCount = 0;

    // Resume only when the checkpoint matches BOTH this conversation id and type.
    const existingState = loadState(outputDir);
    const cached = loadMessagesCache(outputDir);
    const validResume =
      !!existingState && existingState.chatId === chatId && existingState.conversationType === conversationType;

    if (validResume && cached.length > 0) {
      // Reload everything fetched in prior runs so the final export is COMPLETE,
      // not just messages from the resume point forward. The cache is the cursor:
      // it is written in fetch order (each batch newest-first), so the LAST element of
      // the whole cache is the oldest message fetched, the correct next `before_id`.
      allMessages.push(...cached);
      for (const m of cached) {
        if (m.attachments && m.attachments.length > 0) {
          mediaMessageIds.push(m.id);
        }
      }
      lastMessageId = cached[cached.length - 1].id;
      fetchCount = cached.length;
      console.log(`Resuming export: ${fetchCount} messages already cached. Continuing from message ${lastMessageId}.`);
    } else if (existingState && !validResume && cached.length > 0) {
      // The checkpoint identifies the cache as belonging to a DIFFERENT conversation, so
      // it is safe to discard.
      console.error(
        `Found a checkpoint/cache for a different conversation (type=${existingState.conversationType}, id=${existingState.chatId}) ` +
          `in ${outputDir}. Discarding it and starting a fresh export.`
      );
      clearState(outputDir);
      clearMessagesCache(outputDir);
    } else if (cached.length > 0) {
      // A message cache exists but there is no valid checkpoint to identify which
      // conversation it belongs to (state missing or corrupt). Refuse to silently
      // destroy potentially valuable data. Make the user decide.
      throw new Error(
        `A message cache (${getMessagesCachePath(outputDir)}, ${cached.length} messages) exists but its checkpoint is ` +
          `missing or unreadable, so it cannot be safely resumed or validated. Delete that file to start fresh, ` +
          `or choose a different --output directory.`
      );
    } else {
      // No prior messages to resume. Clear any stale (empty) checkpoint and start fresh.
      if (existingState) {
        console.error('Checkpoint found but no cached messages to resume; starting a fresh export.');
      }
      clearState(outputDir);
      clearMessagesCache(outputDir);
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
          const message = redactToken(error instanceof Error ? error.message : String(error));
          console.error(
            `Could not fetch group members for reaction name resolution: ${message}. Falling back to message-cache only.`
          );
        }
      } else {
        try {
          const me = await this.service.getCurrentUser();
          // /users/me may return either `user_id` or `id`; prefer user_id, fall back to id.
          const selfId = me.user_id ?? me.id ?? '';
          resolver.seedFromDmParticipants({ user_id: selfId, name: me.name }, '', '');
        } catch (error: unknown) {
          const message = redactToken(error instanceof Error ? error.message : String(error));
          console.error(
            `Could not fetch current user for DM reaction resolution: ${message}. Falling back to message-cache only.`
          );
        }
      }

      const startedAt = validResume && existingState ? existingState.startedAt : new Date().toISOString();
      let newMessagesThisRun = 0;
      while (true) {
        const messages = await this.service.getMessages(conversationType, chatId, lastMessageId);
        if (!messages || messages.length === 0) {
          // GroupMe returns 304/empty when before_id is past start of history. If
          // this happens before any batch was fetched this run, the conversation is empty
          // (or already fully cached). If it happens mid-run at a full-page boundary, it's
          // plausibly a real end-of-history, so note it when a surprisingly short export is noticeable.
          if (newMessagesThisRun > 0 && newMessagesThisRun % PAGE_SIZE === 0) {
            console.log(
              `Note: end-of-history signaled at a ${PAGE_SIZE}-multiple boundary. If the conversation is unexpectedly short, re-run to verify.`
            );
          }
          break;
        }

        resolver.observeMessages(messages);
        allMessages.push(...messages);
        for (const m of messages) {
          if (m.attachments && m.attachments.length > 0) {
            mediaMessageIds.push(m.id);
          }
        }
        lastMessageId = messages[messages.length - 1].id;
        fetchCount = allMessages.length;
        newMessagesThisRun += messages.length;
        logMessage(messages, lastMessageId);

        // Save the checkpoint BEFORE appending to the message cache, so the on-disk state is
        // never behind the cache. On resume the cache is the cursor; keeping state at-or-ahead
        // of the cache means a crash can never leave a populated cache with no checkpoint.
        saveState(outputDir, {
          conversationType,
          chatId,
          lastMessageId,
          messagesProcessed: fetchCount,
          startedAt,
          updatedAt: new Date().toISOString(),
        });
        appendMessagesToCache(outputDir, messages);

        console.log(`Fetched ${fetchCount} messages...`);
      }

      const fetchElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\nFetched ${fetchCount} messages in ${fetchElapsed}s`);

      if (downloadMedia) {
        await initiateDownloadMediaFiles(allMessages, mediaMessageIds, outputDir);
      }

      if (saveChatHistory) {
        writeChatHistory(allMessages, outputDir, resolver);
        console.log('Chat history saved.');
      }

      writeJsonExport(
        allMessages,
        outputDir,
        {
          conversationName,
          exportDate: new Date().toISOString(),
          totalMessages: fetchCount,
        },
        resolver
      );
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
      const topUsers = Object.entries(stats.messagesPerUser)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [name, count] of topUsers) {
        console.log(`  ${name}: ${count} messages`);
      }
      if (Object.keys(stats.mediaCountByType).length > 0) {
        console.log(
          `Media: ${Object.entries(stats.mediaCountByType)
            .map(([type, count]) => `${count} ${type}s`)
            .join(', ')}`
        );
      }
      console.log('---');

      // Export complete: clean up the checkpoint and the message cache.
      clearState(outputDir);
      clearMessagesCache(outputDir);
    } catch (error: unknown) {
      console.error('Export interrupted. Progress saved; run again with the same --output to resume.');
      throw error;
    }
  }
}
