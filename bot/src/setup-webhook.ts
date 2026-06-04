import { Bot } from 'grammy';
import { env } from './config.js';
import { BOT_COMMANDS } from './commands.js';

// Регистрация webhook у Telegram + команды бота.
// Запуск после деплоя на Vercel:
//   npx tsx src/setup-webhook.ts https://<project>.vercel.app/api/webhook
async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Использование: tsx src/setup-webhook.ts <https://.../api/webhook>');
    process.exit(1);
  }

  const bot = new Bot(env.botToken);
  await bot.api.setWebhook(url, {
    secret_token: env.webhookSecret || undefined,
    drop_pending_updates: true,
  });
  await bot.api.setMyCommands(BOT_COMMANDS);

  const info = await bot.api.getWebhookInfo();
  console.log('✅ Webhook установлен.');
  console.log(`URL: ${info.url}`);
  console.log(`Ожидающих апдейтов: ${info.pending_update_count}`);
}

main().catch((err) => {
  console.error('Ошибка настройки webhook:', err);
  process.exit(1);
});
