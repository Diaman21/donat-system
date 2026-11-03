import { pg } from '../db/pg.js';

// Два маленьких запроса, нужных и боту, и будильнику слотов (03.11.2026).
// Вынесены из orders.ts и написаны на голом драйвере (pg.ts), чтобы будильник
// (cron-job.org, ~60 раз в сутки) не загружал модуль заказов и drizzle: на
// Vercel Hobby каждая загрузка — процессорное время из общего бесплатного лимита.
// ⚠️ Сюда — только запросы через pg, без drizzle, grammy и других обработчиков.

/** Кого тегать в группе — операторы и модераторы (в группе @упоминание реально пингует). */
export async function teamMentions(): Promise<string> {
  const team = await pg<{ username: string | null }[]>`
    select username from users
     where role in ('operator', 'moderator') and is_active`;
  return team
    .filter((u) => u.username)
    .map((u) => `@${u.username}`)
    .join(' ');
}

/** Сколько заказов открыто. */
export async function countOpen(): Promise<number> {
  const r = await pg<{ c: number }[]>`select count(*)::int c from order_queue where status = 'open'`;
  return r[0]?.c ?? 0;
}
