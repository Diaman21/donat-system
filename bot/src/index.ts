import { createBot } from './bot';
import { client } from './db/client';
import { BOT_COMMANDS } from './commands';

async function main(): Promise<void> {
  const bot = createBot();

  // Корректное завершение: останавливаем бота и закрываем пул соединений
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nПолучен ${signal}, останавливаю бота...`);
    await bot.stop();
    await client.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  // Меню команд в Telegram (выпадают при вводе «/»)
  await bot.api.setMyCommands(BOT_COMMANDS);

  // Локальный режim — long polling. Снимаем webhook, если он был
  // установлен (Telegram не даёт работать обоим режимам одновременно).
  await bot.api.deleteWebhook();

  console.log('Бот запускается...');
  await bot.start({
    onStart: (info) => {
      console.log(`✅ Бот @${info.username} запущен (long polling). Ctrl+C — стоп.`);
    },
  });
}

main().catch((err) => {
  console.error('Не удалось запустить бота:', err);
  process.exit(1);
});
