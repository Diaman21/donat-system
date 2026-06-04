import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { greeting, menuFor } from './menus.js';

// /start — регистрирует пользователя (если новый, роль customer = «без доступа»)
// и показывает меню для operator/moderator. customer получает просьбу
// дождаться выдачи роли модератором.
export async function handleStart(ctx: AppContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  ctx.session.flow = undefined; // сброс любого незавершённого ввода

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

  if (user.role === 'customer') {
    await ctx.reply(
      'Привет! Доступ пока не выдан.\n' +
        `Передай модератору свой ID: ${from.id} — он назначит тебе роль оператора.`,
    );
    return;
  }

  await ctx.reply(greeting(user), { reply_markup: menuFor(ctx) });
}

// Проверка доступа: оператор или модератор. Если нет — сообщает и возвращает false.
export async function requireOperator(ctx: AppContext): Promise<boolean> {
  const role = ctx.dbUser?.role;
  if (role === 'operator' || role === 'moderator') return true;
  await ctx.reply('Нет доступа. Напиши /start и попроси модератора выдать роль.');
  return false;
}
