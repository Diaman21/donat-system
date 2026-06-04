import { InlineKeyboard } from 'grammy';
import type { AppContext } from '../context';
import { menuFor } from './menus';

export const CANCEL_CB = 'cancel';

// Inline-кнопка «Отмена» для прикрепления к промптам пошагового ввода.
export function cancelKb(base?: InlineKeyboard): InlineKeyboard {
  const kb = base ?? new InlineKeyboard();
  return kb.text('✖️ Отмена', CANCEL_CB);
}

// Сброс текущего ввода и возврат в меню.
export async function handleCancel(ctx: AppContext): Promise<void> {
  const had = ctx.session.flow !== undefined;
  ctx.session.flow = undefined;
  await ctx.reply(had ? 'Отменено.' : 'Нечего отменять.', { reply_markup: menuFor(ctx) });
}

// Действия с вводом/изменением — только в личке (в группе чат общий).
export async function requirePrivate(ctx: AppContext): Promise<boolean> {
  if (ctx.chat?.type === 'private') return true;
  await ctx.reply(`Это делается в личке с ботом: @${ctx.me.username}`);
  return false;
}
