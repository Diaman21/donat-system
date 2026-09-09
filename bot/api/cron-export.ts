import { Bot, InputFile } from 'grammy';
import { env } from '../src/config.js';
import { buildPurchasesCsv } from '../src/handlers/export.js';
import { buildFullBackup } from '../src/handlers/backup.js';
import { notifyModerator } from '../src/notify.js';

// Vercel Cron: ЕЖЕДНЕВНЫЙ бэкап базы знаний в группу.
//
// Шлём два файла:
//   1) JSON — полный дамп всех таблиц (из него база восстанавливается один в один);
//   2) CSV покупок — для удобного просмотра в Excel.
//
// База покупок + метки телефонов + причины смерти — главный актив проекта,
// а Neon free держит одну копию. История чата в Telegram = наш архив.
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
    const stamp = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

    // 1) Полный дамп — главное
    const full = await buildFullBackup();
    const parts = Object.entries(full.counts)
      .map(([t, n]) => `${t} ${n}`)
      .join(' · ');
    await bot.api.sendDocument(
      env.groupChatId,
      new InputFile(Buffer.from(full.json, 'utf8'), `backup-full-${stamp}.json`),
      {
        caption:
          `🗄 Полный бэкап на ${stamp}\n${parts}\n` +
          `${(full.bytes / 1024).toFixed(0)} КБ · из него база восстанавливается целиком`,
      },
    );

    // 2) CSV покупок — для Excel
    const csv = await buildPurchasesCsv();
    if (csv) {
      await bot.api.sendDocument(
        env.groupChatId,
        new InputFile(Buffer.from(csv.csv, 'utf8'), `purchases-${stamp}.csv`),
        { caption: `📄 Покупки в Excel: ${csv.count} строк` },
      );
    }

    res.statusCode = 200;
    res.end('ok');
  } catch (err) {
    console.error('Ошибка cron-бэкапа:', err);
    await notifyModerator(bot.api, `⚠️ Ошибка ежедневного бэкапа:\n${String(err).slice(0, 600)}`);
    res.statusCode = 500;
    res.end('error');
  }
}
