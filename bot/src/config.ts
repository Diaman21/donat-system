import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// .env лежит в корне репозитория (на уровень выше bot/).
// bot/src/config.ts -> ../../.env
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана переменная окружения: ${name} (проверь .env в корне проекта)`);
  }
  return value;
}

// Токен для локального запуска.
//
// Боевой бот живёт на Vercel через webhook. Если запустить того же бота
// локально в long polling, Telegram снимет webhook — прод молча умрёт,
// и заметишь ты это в лучшем случае через несколько часов.
//
// Поэтому для локального запуска заводится ОТДЕЛЬНЫЙ бот у @BotFather,
// его токен кладётся в TELEGRAM_BOT_TOKEN_DEV. Тогда `npm run dev` трогает
// только тестового бота, а боевой продолжает работать.
//
// Если TELEGRAM_BOT_TOKEN_DEV не задан — src/index.ts остановится с
// объяснением, вместо того чтобы по-тихому увести прод (см. localBotToken).
const devToken = process.env.TELEGRAM_BOT_TOKEN_DEV ?? '';

export const env = {
  /** Connection string Neon (pooler). Нужен всегда. */
  databaseUrl: required('DATABASE_URL'),
  /** Токен боевого бота от @BotFather. На Vercel — единственный используемый. */
  botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  /** Токен отдельного бота для локальной разработки (может быть пустым). */
  devBotToken: devToken,
  /** ID чата модератора для системных уведомлений (опционально). */
  moderatorChatId: process.env.TELEGRAM_MODERATOR_CHAT_ID ?? '',
  /** ID группы для статистики (опционально, заполним после получения ID). */
  groupChatId: process.env.TELEGRAM_GROUP_ID ?? '',
  /** Секрет вебхука (Vercel): Telegram шлёт его в заголовке, мы проверяем. */
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  /** Секрет cron (Vercel): шлётся в Authorization при вызове по расписанию. */
  cronSecret: process.env.CRON_SECRET ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
