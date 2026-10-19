import { Bot } from 'grammy';
import { env } from '../src/config.js';
import { runSlotCheck } from '../src/handlers/slot-notify.js';
import { notifyModerator } from '../src/notify.js';

// Будильник слотов под €100 (19.10.2026). Вызывает НЕ Vercel Cron (на Hobby
// кроны только раз в сутки), а внешний cron-job.org каждые ~10 минут.
//
// Защита — ОТДЕЛЬНЫЙ секрет SLOTS_SECRET в заголовке Authorization: его знает
// сторонний сервис, и утечка не должна давать запуск сводки или бэкапа
// (у них свой CRON_SECRET). Секрет не задан — эндпоинт выключен, а не открыт.
//
// ?dry=1 — посчитать, кому пора напомнить, ничего не отправляя и не запоминая.
export default async function handler(req: any, res: any): Promise<void> {
  const secret = env.slotsSecret;
  if (!secret) {
    res.statusCode = 503;
    res.end('SLOTS_SECRET не задан — будильник слотов выключен.');
    return;
  }
  if (req.headers['authorization'] !== `Bearer ${secret}`) {
    res.statusCode = 401;
    res.end('Unauthorized');
    return;
  }

  const bot = new Bot(env.botToken);
  const dry = String(req.url ?? '').includes('dry=1');
  try {
    const result = await runSlotCheck(bot.api, new Date(), dry);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ dry, ...result }));
  } catch (err) {
    console.error('Ошибка будильника слотов:', err);
    // Модератору — только если это не повторяющийся шум: будильник тикает
    // каждые 10 минут, и при сбое базы сообщения шли бы пачкой. Пишем в лог,
    // а модератору — раз в час (по минутам часа).
    if (new Date().getUTCMinutes() < 10) {
      await notifyModerator(bot.api, `⚠️ Ошибка будильника слотов:\n${String(err).slice(0, 600)}`);
    }
    res.statusCode = 500;
    res.end('error');
  }
}
