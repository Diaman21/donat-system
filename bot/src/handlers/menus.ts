import { Keyboard } from 'grammy';
import type { User } from '../db/schema.js';
import type { AppContext } from '../context.js';

// Метки кнопок главного меню (используются и при отрисовке, и в роутинге).
export const BTN = {
  purchase: '➕ Закупка',
  addPhone: '➕ Телефон',
  phones: '📱 Телефоны',
  stats: '📊 Статистика',
  recent: '🧾 Последние',
  delLast: '↩️ Удалить последнюю',
} as const;

export function greeting(user: User): string {
  const name = user.fullName ?? user.username ?? 'друг';
  const role = user.role === 'moderator' ? '🛡️ Модератор' : '👨‍💼 Оператор';
  return [`Привет, ${name}!`, `Роль: ${role}`, '', 'Что делаем?'].join('\n');
}

// Главное меню оператора/модератора (логгер закупок).
export function mainMenu(): Keyboard {
  return new Keyboard()
    .text(BTN.purchase)
    .row()
    .text(BTN.addPhone)
    .text(BTN.phones)
    .row()
    .text(BTN.stats)
    .text(BTN.recent)
    .row()
    .text(BTN.delLast)
    .resized()
    .persistent();
}

// Reply-меню показываем только в личке (в группе оно мешает всем).
export function menuFor(ctx: AppContext): Keyboard | undefined {
  return ctx.chat?.type === 'private' ? mainMenu() : undefined;
}
