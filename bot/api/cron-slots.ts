import { env } from '../src/config.js';
import { inWorkHours } from '../src/handlers/slots.js';

// Будильник слотов под €100 (19.10.2026). Вызывает НЕ Vercel Cron (на Hobby
// кроны только раз в сутки), а внешний cron-job.org: каждые 15 минут, 09–23 МСК.
//
// Защита — ОТДЕЛЬНЫЙ секрет SLOTS_SECRET в заголовке Authorization: его знает
// сторонний сервис, и утечка не должна давать запуск сводки или бэкапа
// (у них свой CRON_SECRET). Секрет не задан — эндпоинт выключен, а не открыт.
//
// ?dry=1 — посчитать, кому пора напомнить, ничего не отправляя и не запоминая.
//
// ⚠️ Экономия процессора (03.11.2026, общий лимит Vercel дошёл до 75%): сверху
// импортируются только лёгкие config и slots. База, обработчики и grammy
// загружаются через import() — только когда они действительно нужны.
// Ночной вызов отвечает сразу, не поднимая ничего.
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

  const now = new Date();
  const dry = String(req.url ?? '').includes('dry=1');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (!inWorkHours(now)) {
    res.statusCode = 200;
    res.end(JSON.stringify({ dry, status: 'quiet-hours', phones: [] }));
    return;
  }

  // Telegram — лениво: в большинстве тиков отправлять нечего.
  const getApi = async () => new (await import('grammy')).Api(env.botToken);
  try {
    const { runSlotCheck } = await import('../src/handlers/slot-notify.js');
    const result = await runSlotCheck(getApi, now, dry);
    res.statusCode = 200;
    res.end(JSON.stringify({ dry, ...result }));
  } catch (err) {
    console.error('Ошибка будильника слотов:', err);
    // Модератору — только если это не повторяющийся шум: будильник тикает
    // каждые 15 минут, и при сбое базы сообщения шли бы пачкой. Пишем в лог,
    // а модератору — раз в час (первый тик часа).
    if (now.getUTCMinutes() < 15) {
      try {
        const { notifyModerator } = await import('../src/notify.js');
        await notifyModerator(await getApi(), `⚠️ Ошибка будильника слотов:\n${String(err).slice(0, 600)}`);
      } catch (e) {
        console.error('Не удалось сообщить модератору:', e);
      }
    }
    res.statusCode = 500;
    res.end('error');
  }
}
