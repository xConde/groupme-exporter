#!/usr/bin/env tsx
import { Command } from 'commander';
import pc from 'picocolors';
import { GroupmeService } from './service.js';
import { ExportOrchestrator } from './orchestrator.js';
import { getConversationType, getConversationId, getAccessToken, promptOutputDir, promptSaveChatHistory } from './prompts.js';

const program = new Command();

program
  .name('groupme-exporter')
  .description('Export media and chat history from GroupMe conversations')
  .version('2.0.0')
  .option('-t, --token <token>', 'GroupMe API access token')
  .option('-o, --output <dir>', 'Output directory')
  .option('--type <type>', 'Conversation type: groups or chats')
  .option('-c, --conversation <id>', 'Conversation ID to export')
  .option('--no-media', 'Skip media download')
  .option('--chat-history', 'Save chat history (skip prompt)')
  .option('--no-chat-history', 'Skip chat history export')
  .parse();

const opts = program.opts<{
  token?: string;
  output?: string;
  type?: string;
  conversation?: string;
  media: boolean;
  chatHistory: boolean | undefined;
}>();

async function main() {
  const accessToken = opts.token || process.env.GROUPME_TOKEN || await getAccessToken();
  const groupMeService = new GroupmeService(accessToken);
  const orchestrator = new ExportOrchestrator(groupMeService);

  const conversationType = opts.type || await getConversationType();

  let conversationId: string;
  if (opts.conversation) {
    conversationId = opts.conversation;
  } else {
    const conversations = await groupMeService.getConversations(conversationType);
    conversationId = await getConversationId(conversations, conversationType);
  }

  const outputDir = opts.output || await promptOutputDir();
  const saveChatHistory = opts.chatHistory ?? await promptSaveChatHistory();

  await orchestrator.exportConversation(conversationType, conversationId, outputDir, saveChatHistory, opts.media);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(`Error: ${message}`));
  process.exit(1);
});
