import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
dayjs.extend(advancedFormat);
import { Message } from './model.js';

export function logMessage(messages: Message[], lastMessageId: string): void {
  const randomFactor = Math.floor(Math.random() * 641) + 150;
  if (Number(lastMessageId) % randomFactor === 0) {
    const finalMessageIndex = messages.length - 1;
    if (messages.length < 5) { return; }
    const startMessageIndex = finalMessageIndex - 4;
    const finalMessage = messages[finalMessageIndex];
    const timeDiff = dayjs.unix(finalMessage.created_at).diff(dayjs.unix(messages[startMessageIndex].created_at), 'hour');
    if (timeDiff < 2) {
      const messagesToShow = messages.slice(startMessageIndex + 1).reverse();
      console.log(`\n---- ${dayjs.unix(messages[finalMessageIndex].created_at).format('MMMM Do YYYY')} ----`);
      messagesToShow.forEach((message) => {
        console.log(`${dayjs.unix(message.created_at).format('h:mm:ss A')} | ${message.name}: ${message.text}`);
      });
      console.log('----\n');
    } else {
      console.log(`${dayjs.unix(finalMessage.created_at).format('MMMM Do YYYY, h:mm:ss A')} | ${finalMessage.name}: ${finalMessage.text}`);
    }
  }
}
