import chalk from 'chalk';
import { GroupmeService } from './service';
import { getConversationType, getConversationId, getAccessToken, promptOutputDir, promptSaveChatHistory } from './utils';

async function main() {
  const API_BASE_URL = '' || await getAccessToken();
  const groupMeService = new GroupmeService(API_BASE_URL);

  const conversationType = await getConversationType();
  const conversations = await groupMeService.getConversations(conversationType);
  const conversationId = await getConversationId(conversations, conversationType);

  const outputDir = await promptOutputDir();
  const saveChatHistory = await promptSaveChatHistory();

  try {
    await groupMeService.downloadContent(conversationType, conversationId, outputDir, saveChatHistory);
  } catch (error) {
    console.error(chalk.red(`Error downloading content. ${(error as Error).message}`));
    process.exit(1);
  }
}

main();
