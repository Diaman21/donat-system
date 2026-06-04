import { createBot } from './bot';
import { client } from './db/client';

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
  await bot.api.setMyCommands([
    { command: 'start', description: 'Меню' },
    { command: 'stats', description: 'Статистика' },
    { command: 'phones', description: 'Телефоны' },
    { command: 'recent', description: 'Последние закупки' },
    { command: 'report', description: 'Отчёт в группу' },
    { command: 'help', description: 'Помощь' },
    { command: 'cancel', description: 'Отменить ввод' },
  ]);

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
