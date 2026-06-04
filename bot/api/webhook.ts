import { webhookCallback } from 'grammy';
import { createBot } from '../src/bot';
import { env } from '../src/config';

// Точка входа для Vercel (serverless). Telegram присылает апдейты сюда.
// Бот создаётся один раз на «тёплый» инстанс и переиспользуется.
const bot = createBot();

export default webhookCallback(bot, 'http', {
  secretToken: env.webhookSecret || undefined,
});
