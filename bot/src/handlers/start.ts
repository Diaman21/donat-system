import { db } from '../db/client';
import { users } from '../db/schema';
import type { AppContext } from '../context';
import { greetingForRole, menuForRole } from './menus';

// /start — регистрирует пользователя в БД (если новый) и показывает
// приветствие с ролевым меню. Роль по умолчанию — customer.
export async function handleStart(ctx: AppContext): Promise<void> {
  const from = ctx.from;
  if (!from) {
    return;
  }

  let user = ctx.dbUser;

  if (!user) {
    const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ');
    const rows = await db
      .insert(users)
      .values({
        telegramId: from.id,
        username: from.username ?? null,
        fullName: fullName.length > 0 ? fullName : null,
      })
      .returning();
    user = rows[0];
    ctx.dbUser = user;
  }

  if (!user) {
    await ctx.reply('Не удалось зарегистрировать. Попробуй ещё раз: /start');
    return;
  }

  await ctx.reply(greetingForRole(user), { reply_markup: menuForRole(user.role) });
}
