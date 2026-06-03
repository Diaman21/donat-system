import { Bot } from 'grammy';
import { env } from './config';
import type { AppContext } from './context';
import { loadUser } from './middlewares/auth';
import { handleStart } from './handlers/start';

export function createBot(): Bot<AppContext> {
  if (!env.botToken) {
    throw new Error(
      'Не задан TELEGRAM_BOT_TOKEN в .env — получи токен у @BotFather и впиши его.',
    );
  }

  const bot = new Bot<AppContext>(env.botToken);

  // Подгружаем пользователя из БД для каждого апдейта
  bot.use(loadUser);

  // Команды
  bot.command('start', handleStart);

  // Заглушка: любое прочее сообщение (включая нажатия кнопок меню)
  bot.on('message', async (ctx) => {
    await ctx.reply('🚧 Этот раздел пока в разработке. Нажми /start, чтобы открыть меню.');
  });

  // Глобальный обработчик ошибок
  bot.catch((err) => {
    console.error('Ошибка при обработке апдейта:', err.error);
  });

  return bot;
}
