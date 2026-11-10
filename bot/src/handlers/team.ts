import { pg } from '../db/pg.js';
import type { UserRole } from '../db/schema.js';

// Два маленьких запроса, нужных и боту, и будильнику слотов (03.11.2026).
// Вынесены из orders.ts и написаны на голом драйвере (pg.ts), чтобы будильник
// (cron-job.org, ~60 раз в сутки) не загружал модуль заказов и drizzle: на
// Vercel Hobby каждая загрузка — процессорное время из общего бесплатного лимита.
// ⚠️ Сюда — только запросы через pg, без drizzle, grammy и других обработчиков.

async function mentions(roles: UserRole[]): Promise<string> {
  const team = await pg<{ username: string | null }[]>`
    select username from users
     where role::text in ${pg(roles)} and is_active`;
  return team
    .filter((u) => u.username)
    .map((u) => `@${u.username}`)
    .join(' ');
}

/** Кого тегать в группе — операторы и модераторы (в группе @упоминание реально пингует). */
export function teamMentions(): Promise<string> {
  return mentions(['operator', 'moderator']);
}

/** Только операторы — тем, кто делает работу (аккаунты делает оператор, 10.11.2026). */
export function operatorMentions(): Promise<string> {
  return mentions(['operator']);
}

/** Сколько заказов открыто. */
export async function countOpen(): Promise<number> {
  const r = await pg<{ c: number }[]>`select count(*)::int c from order_queue where status = 'open'`;
  return r[0]?.c ?? 0;
}
