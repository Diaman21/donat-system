import { Bot, InputFile } from 'grammy';
import { env } from '../src/config.js';
import { buildPurchasesCsv } from '../src/handlers/export.js';
import { notifyModerator } from '../src/notify.js';

// Vercel Cron: еженедельный бэкап базы знаний — CSV всех покупок в группу.
// База покупок — главный актив проекта; Neon free держит одну копию,
// поэтому раз в неделю складываем выгрузку в Telegram (история чата = архив).
export default async function handler(req: any, res: any): Promise<void> {
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
    const built = await buildPurchasesCsv();
    if (!built) {
      res.statusCode = 200;
      res.end('Покупок нет — бэкап пропущен.');
      return;
    }
    const stamp = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    await bot.api.sendDocument(
      env.groupChatId,
      new InputFile(Buffer.from(built.csv, 'utf8'), `backup-purchases-${stamp}.csv`),
      { caption: `🗄 Еженедельный бэкап: ${built.count} покупок (на ${stamp}).` },
    );
    res.statusCode = 200;
    res.end('ok');
  } catch (err) {
    console.error('Ошибка cron-бэкапа:', err);
    await notifyModerator(bot.api, `⚠️ Ошибка еженедельного бэкапа:\n${String(err).slice(0, 600)}`);
    res.statusCode = 500;
    res.end('error');
  }
}
