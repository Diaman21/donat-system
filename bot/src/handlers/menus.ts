import { Keyboard } from 'grammy';
import type { User, PhoneStatus } from '../db/schema.js';
import type { AppContext } from '../context.js';

// Значки и подписи статуса телефона.
//
// ⚠️ Именно Record<PhoneStatus, …>, а НЕ цепочка тернарников — и это не
// вкусовщина, а страховка полноты: появится четвёртый статус, и TypeScript
// не соберёт проект, пока его не впишут сюда.
//
// Так уже ломалось. В миграции `0007` добавился `prepared`, а в списке
// «📜 История» осталось `status === 'active' ? '📱' : '🪦'` — написанное,
// когда статусов было два. Компилятор смолчал, и ВЕСЬ РЕЗЕРВ (12 телефонов)
// показывался надгробием, как будто они мертвы. Нашлось только аудитом
// 13.09.2026, прожив в проде с момента добавления статуса.
export const PHONE_MARK: Record<PhoneStatus, string> = {
  active: '📱',
  prepared: '🧰',
  dead: '🪦',
};

export const PHONE_STATE: Record<PhoneStatus, string> = {
  active: 'активен',
  prepared: 'подготовлен',
  dead: 'умер',
};

// Метки кнопок главного меню (используются и при отрисовке, и в роутинге).
export const BTN = {
  // Основная работа идёт от заказа: «📥 Заказы» → «✅ Выполнить» запускает закупку.
  // «🛒 Без заказа» остаётся для разогрева €2 и всего, что не по заказу.
  orders: '📥 Заказы',
  purchase: '🛒 Без заказа',
  addPhone: '➕📱 Телефон',
  phones: '☎️ Телефоны',
  prepared: '🧰 Подготовленные',
  find: '🔍 Поиск по IMEI',
  stats: '📊 Статистика',
  vk: '🗳 ВК',
  recent: '📋 Последние',
  report: '📅 Отчёт',
  delLast: '❌ Удалить последнюю',
} as const;

export function greeting(user: User): string {
  const name = user.fullName ?? user.username ?? 'друг';
  const role = user.role === 'moderator' ? '🛡️ Модератор' : '👨‍💼 Оператор';
  return [`Привет, ${name}!`, `Роль: ${role}`, '', 'Что делаем?'].join('\n');
}

// Главное меню оператора/модератора (логгер закупок).
export function mainMenu(): Keyboard {
  return new Keyboard()
    .text(BTN.orders)
    .row()
    .text(BTN.purchase)
    .row()
    .text(BTN.addPhone)
    .text(BTN.phones)
    .text(BTN.prepared)
    .row()
    .text(BTN.stats)
    .text(BTN.vk)
    .text(BTN.recent)
    .row()
    .text(BTN.find)
    .row()
    .text(BTN.report)
    .text(BTN.delLast)
    .resized()
    .persistent();
}

// Reply-меню показываем только в личке (в группе оно мешает всем).
export function menuFor(ctx: AppContext): Keyboard | undefined {
  return ctx.chat?.type === 'private' ? mainMenu() : undefined;
}
