import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat.js';
dayjs.extend(advancedFormat);
import { Message } from './model.js';

// "Memory Lane": occasionally surface a snippet of older messages during a long export.
// The sampling is stochastic so it appears now and then without flooding the terminal.
const SAMPLE_WINDOW = 4; // messages preceding the batch's last message to include in a snippet
const MIN_BATCH_FOR_SAMPLE = SAMPLE_WINDOW + 1; // need a full window to render a snippet
const SAMPLE_MODULO_MIN = 150; // gate is `id % n === 0` for a random n in [150, 791)
const SAMPLE_MODULO_RANGE = 641;
const SNIPPET_MAX_SPAN_HOURS = 2; // only group into a snippet if the messages are close in time

export function logMessage(messages: Message[], lastMessageId: string): void {
  const randomFactor = Math.floor(Math.random() * SAMPLE_MODULO_RANGE) + SAMPLE_MODULO_MIN;
  if (Number(lastMessageId) % randomFactor !== 0) {
    return;
  }
  if (messages.length < MIN_BATCH_FOR_SAMPLE) {
    return;
  }

  const finalMessageIndex = messages.length - 1;
  const startMessageIndex = finalMessageIndex - SAMPLE_WINDOW;
  const finalMessage = messages[finalMessageIndex];
  const timeDiff = dayjs.unix(finalMessage.created_at).diff(dayjs.unix(messages[startMessageIndex].created_at), 'hour');

  if (timeDiff < SNIPPET_MAX_SPAN_HOURS) {
    const messagesToShow = messages.slice(startMessageIndex + 1).reverse();
    console.log(`\n---- ${dayjs.unix(finalMessage.created_at).format('MMMM Do YYYY')} ----`);
    messagesToShow.forEach((message) => {
      console.log(`${dayjs.unix(message.created_at).format('h:mm:ss A')} | ${message.name}: ${message.text ?? ''}`);
    });
    console.log('----\n');
  } else {
    console.log(
      `${dayjs.unix(finalMessage.created_at).format('MMMM Do YYYY, h:mm:ss A')} | ${finalMessage.name}: ${finalMessage.text ?? ''}`
    );
  }
}
