import { Bot } from 'grammy';
import { env } from '../src/config.js';
import { renderStats } from '../src/handlers/stats.js';
import { phonesNowLines, violationsLines } from '../src/handlers/corridor.js';
import { notifyModerator } from '../src/notify.js';

// Vercel Cron: ежедневная сводка в группу.
// Вызывается по расписанию из vercel.json. Защита — CRON_SECRET
// (Vercel шлёт его в заголовке Authorization при cron-вызове).
export default async function handler(req: any, res: any): Promise<void> {
  // Защита: если CRON_SECRET задан, требуем совпадения заголовка
  if (env.cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${env.cronSecret}`) {
      res.statusCode = 401;
      res.end('Unauthorized');
      return;
    }
  }

  if (!env.groupChatId) {
    res.statusCode = 200;
    res.end('Группа не настроена (нет TELEGRAM_GROUP_ID).');
    return;
  }

  const bot = new Bot(env.botToken);
  try {
    // Порядок блоков — по убыванию срочности:
    //   1) что пошло не так за сутки (нарушения протокола, если были);
    //   2) что делать сегодня (состояние телефонов);
    //   3) обычная сводка за сутки.
    // Первые два особенно важны, когда за ботом никто не следит вручную
    // (отпуск, один оператор): сводка становится единственным контролем.
    const violations = await violationsLines(24);
    const phonesNow = await phonesNowLines();
    const { text } = await renderStats('24h');

    const parts = [
      '🕛 Ежедневная сводка',
      ...(violations.length ? ['', ...violations] : []),
      '',
      ...phonesNow,
      '',
      text,
    ];
    await bot.api.sendMessage(env.groupChatId, parts.join('\n'));
    res.statusCode = 200;
    res.end('ok');
  } catch (err) {
    console.error('Ошибка cron-сводки:', err);
    await notifyModerator(bot.api, `⚠️ Ошибка авто-сводки:\n${String(err).slice(0, 600)}`);
    res.statusCode = 500;
    res.end('error');
  }
}
