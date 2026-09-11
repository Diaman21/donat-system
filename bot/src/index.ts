import { createBot } from './bot.js';
import { client } from './db/client.js';
import { BOT_COMMANDS } from './commands.js';
import { env } from './config.js';

// Локальный запуск (long polling).
//
// ⚠️ Работает ТОЛЬКО с отдельным тестовым ботом (TELEGRAM_BOT_TOKEN_DEV).
// Причина: Telegram не даёт одному боту работать и по webhook, и по long
// polling. Если поднять здесь боевой токен, webhook на Vercel снимется и
// прод замолчит — молча, без единой ошибки.
//
// Как завести тестового бота:
//   1. @BotFather → /newbot → получить токен
//   2. положить его в .env как TELEGRAM_BOT_TOKEN_DEV=...
//   3. npm run dev
//
// База при этом ОБЩАЯ с продом — записи из тестового бота попадут в реальную
// статистику. Для проверки интерфейса это нормально, для экспериментов
// с закупками — нет.

async function main(): Promise<void> {
  if (!env.devBotToken) {
    console.error(
      [
        '',
        '⛔ Локальный запуск остановлен: не задан TELEGRAM_BOT_TOKEN_DEV.',
        '',
        'Боевой бот работает на Vercel через webhook. Если запустить его',
        'здесь в long polling, Telegram снимет webhook и прод перестанет',
        'отвечать — без ошибок и уведомлений.',
        '',
        'Что сделать:',
        '  1. @BotFather → /newbot → получить токен тестового бота',
        '  2. в .env (корень репозитория) добавить строку:',
        '       TELEGRAM_BOT_TOKEN_DEV=<токен тестового бота>',
        '  3. повторить npm run dev',
        '',
        '⚠️ База у тестового бота ОБЩАЯ с боевой — не вбивай через него',
        '   покупки, они попадут в реальную статистику.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  if (env.devBotToken === env.botToken) {
    console.error(
      '\n⛔ TELEGRAM_BOT_TOKEN_DEV совпадает с боевым TELEGRAM_BOT_TOKEN.\n' +
        '   Это тот же самый бот — запуск снимет webhook на Vercel.\n' +
        '   Заведи отдельного бота у @BotFather.\n',
    );
    process.exit(1);
  }

  const bot = createBot(env.devBotToken);

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

  // deleteWebhook здесь безопасен: он снимает webhook у ТЕСТОВОГО бота,
  // боевой на Vercel не трогается (это разные боты с разными токенами).
  await bot.api.deleteWebhook();

  console.log('Бот запускается...');
  await bot.start({
    onStart: (info) => {
      console.log(`✅ Тестовый бот @${info.username} запущен (long polling). Ctrl+C — стоп.`);
      console.log('   Боевой бот на Vercel продолжает работать.');
      console.log('   ⚠️ База общая с продом — покупки попадут в реальную статистику.');
    },
  });
}

main().catch((err) => {
  console.error('Не удалось запустить бота:', err);
  process.exit(1);
});
