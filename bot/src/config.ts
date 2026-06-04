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

export const env = {
  /** Connection string Neon (pooler). Нужен всегда. */
  databaseUrl: required('DATABASE_URL'),
  /** Токен бота от @BotFather. Нужен только для запуска бота, не для db:check. */
  botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  /** ID чата модератора для системных уведомлений (опционально). */
  moderatorChatId: process.env.TELEGRAM_MODERATOR_CHAT_ID ?? '',
  /** ID группы для статистики (опционально, заполним после получения ID). */
  groupChatId: process.env.TELEGRAM_GROUP_ID ?? '',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
