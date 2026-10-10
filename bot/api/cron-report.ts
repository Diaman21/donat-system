import { Bot } from 'grammy';
import { env } from '../src/config.js';
import { inTopic } from '../src/group.js';
import { renderStats } from '../src/handlers/stats.js';
import {
  phonesNowLines,
  violationsLines,
  boundaryShiftLines,
  idleLines,
} from '../src/handlers/corridor.js';
import { weeklyLines } from '../src/handlers/weekly.js';
import { cardSummaryLines } from '../src/handlers/card.js';
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

  // Проверка настроек БЕЗ отправки (?dry=1, только с секретом крона):
  // куда бы ушла сводка и в какие темы — бэкап и заказы. Появилась 08.10.2026,
  // когда группа стала супергруппой с темами: иначе проверить, что Vercel
  // подхватил TELEGRAM_GROUP_ID и TELEGRAM_TOPIC_*, можно было только лишней
  // сводкой в группе — и тему всё равно не увидеть (бот не читает группу).
  if (String(req.url ?? '').includes('dry=1')) {
    // Плюс здоровье связи с Telegram — со стороны Vercel. Из сети владельца
    // api.telegram.org бывает недоступен (08.10.2026: таймаут), а бот живёт
    // на Vercel, и проверять надо оттуда, где он работает.
    let telegram: Record<string, unknown>;
    try {
      const wh = await new Bot(env.botToken).api.getWebhookInfo();
      telegram = {
        ok: true,
        webhook: wh.url,
        pending: wh.pending_update_count,
        allowed: wh.allowed_updates ?? 'все',
        lastError: wh.last_error_date
          ? `${new Date(wh.last_error_date * 1000).toISOString()} ${wh.last_error_message ?? ''}`
          : null,
      };
    } catch (err) {
      telegram = { ok: false, error: String(err).slice(0, 200) };
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        group: env.groupChatId || null,
        topics: {
          summary: inTopic('summary').message_thread_id ?? null,
          backup: inTopic('backup').message_thread_id ?? null,
          orders: inTopic('orders').message_thread_id ?? null,
        },
        telegram,
      }),
    );
    return;
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
    // Блоки независимы — собираем параллельно. Каждый из них это несколько
    // запросов к Neon, а функция на Vercel ограничена по времени: если она
    // не успеет, сводка за день просто не придёт. Последовательный сбор
    // тратил бы секунды на ожидание сети впустую.
    const [violations, idle, shift, card, phonesNow, weekly, stats] = await Promise.all([
      violationsLines(24),
      // Пусто, пока никто не простаивает дольше порога.
      idleLines(),
      // Пусто, пока ни одна граница не накопила достаточно чистых наблюдений.
      boundaryShiftLines(),
      // Бюджет на карте: по нему решают, выкатывать ли телефон (с 10.10.2026).
      cardSummaryLines(),
      phonesNowLines(),
      // По понедельникам — итог прошедшей недели. В остальные дни пусто.
      weeklyLines(),
      renderStats('24h'),
    ]);
    const { text } = stats;

    const parts = [
      '🕛 Ежедневная сводка',
      ...(violations.length ? ['', ...violations] : []),
      // Простой выше нарушений по частоте: за три недели так сгорело
      // 39 слотов из 78 — больше, чем принесли все тридцатки за период.
      ...(idle.length ? ['', ...idle] : []),
      ...(shift.length ? ['', ...shift] : []),
      ...(card.length ? ['', ...card] : []),
      '',
      ...phonesNow,
      ...(weekly.length ? ['', ...weekly] : []),
      '',
      text,
    ];
    await bot.api.sendMessage(env.groupChatId, parts.join('\n'), inTopic('summary'));
    res.statusCode = 200;
    res.end('ok');
  } catch (err) {
    console.error('Ошибка cron-сводки:', err);
    await notifyModerator(bot.api, `⚠️ Ошибка авто-сводки:\n${String(err).slice(0, 600)}`);
    res.statusCode = 500;
    res.end('error');
  }
}
