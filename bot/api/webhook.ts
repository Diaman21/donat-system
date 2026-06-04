import { webhookCallback } from 'grammy';
import { createBot } from '../src/bot.js';
import { env } from '../src/config.js';

// Точка входа для Vercel (serverless). Telegram присылает апдейты сюда.
// Бот создаётся один раз на «тёплый» инстанс и переиспользуется.
const bot = createBot();

// Адаптер 'https' — для Vercel Node-runtime (рекомендация grammY).
export default webhookCallback(bot, 'https', {
  secretToken: env.webhookSecret || undefined,
});
