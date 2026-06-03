import { Keyboard } from 'grammy';
import type { User, UserRole } from '../db/schema';

const roleLabel: Record<UserRole, string> = {
  customer: '🛍️ Заказчик',
  operator: '👨‍💼 Оператор',
  moderator: '🛡️ Модератор',
};

export function greetingForRole(user: User): string {
  const name = user.fullName ?? user.username ?? 'друг';
  return [
    `Привет, ${name}!`,
    `Твоя роль: ${roleLabel[user.role]}`,
    '',
    'Выбери действие в меню ниже 👇',
  ].join('\n');
}

// Ролевое меню-заглушка. Кнопки пока без логики (обрабатываются
// общим fallback'ом «в разработке») — наполним сценариями на след. шагах.
export function menuForRole(role: UserRole): Keyboard {
  const kb = new Keyboard().resized().persistent();

  if (role === 'customer') {
    kb.text('🎮 Новый заказ').text('📋 Мои заказы');
    return kb;
  }

  if (role === 'operator') {
    kb.text('📋 Новые заказы').row();
    kb.text('📱 Мои телефоны').text('✅ Зафиксировать покупку');
    return kb;
  }

  // moderator — полный доступ
  kb.text('📋 Заказы').text('📱 Телефоны').row();
  kb.text('🗂 Категории').text('👥 Пользователи').row();
  kb.text('📊 Аналитика');
  return kb;
}
