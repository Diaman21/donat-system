import type { NextFunction } from 'grammy';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { AppContext } from '../context.js';

// Подгружает пользователя из БД по telegram_id в ctx.dbUser.
// Если пользователя ещё нет — оставляет ctx.dbUser undefined
// (регистрация происходит в /start).
export async function loadUser(ctx: AppContext, next: NextFunction): Promise<void> {
  const tgId = ctx.from?.id;
  if (tgId !== undefined) {
    const rows = await db.select().from(users).where(eq(users.telegramId, tgId)).limit(1);
    ctx.dbUser = rows[0];
  }
  await next();
}
