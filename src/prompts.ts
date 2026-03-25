import * as clack from '@clack/prompts';
import { Conversation } from './model.js';

export async function getAccessToken(): Promise<string> {
  const accessToken = await clack.text({
    message: 'Enter your GroupMe API access token:',
    validate: (value) => {
      if (!(value ?? '').trim()) return 'Access token is required';
    },
  });
  if (clack.isCancel(accessToken)) { process.exit(0); }
  return (accessToken as string).trim();
}

export async function getConversationType(): Promise<string> {
  const conversationType = await clack.select({
    message: 'Select conversation type:',
    options: [
      { value: 'groups', label: 'Groups' },
      { value: 'chats', label: 'Direct Messages' },
    ],
  });
  if (clack.isCancel(conversationType)) { process.exit(0); }
  return conversationType as string;
}

export async function getConversationId(conversations: Conversation[], conversationType: string): Promise<string> {
  const choiceIsGroup = conversationType === 'groups';
  const options = conversations.map((c: Conversation) => ({
    value: choiceIsGroup ? c.id : (c.other_user?.id ?? ''),
    label: choiceIsGroup ? c.name : (c.other_user?.name ?? ''),
  }));

  const conversationId = await clack.select({
    message: `Select a ${choiceIsGroup ? 'group' : 'chat'} to download:`,
    options,
  });
  if (clack.isCancel(conversationId)) { process.exit(0); }

  const selected = options.find(o => o.value === conversationId);
  console.log(`Downloading media from ${selected?.label}\n`);
  return conversationId as string;
}

export async function promptOutputDir(): Promise<string> {
  while (true) {
    const inputDir = await clack.text({
      message: 'Enter the output directory (e.g. /path/to/folder):',
      validate: (value) => {
        const v = value ?? '';
        if (!v.trim()) return 'Output directory is required';
        if (!v.startsWith('/')) return 'Output directory must start with /';
      },
    });
    if (clack.isCancel(inputDir)) { process.exit(0); }

    const outputDir = (inputDir as string).trim().replace(/\/{2,}/g, '/');
    const confirmed = await clack.confirm({
      message: `Confirm output directory: ${outputDir}`,
    });
    if (clack.isCancel(confirmed)) { process.exit(0); }
    if (confirmed) { return outputDir; }
  }
}

export async function promptSaveChatHistory(): Promise<boolean> {
  const saveChatHistory = await clack.confirm({
    message: 'Save chat history? (generates files per year + consolidated)',
  });
  if (clack.isCancel(saveChatHistory)) { process.exit(0); }
  return saveChatHistory as boolean;
}
