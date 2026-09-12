import type { BotCommand } from 'grammy/types';

// Команды бота (показываются в меню Telegram при вводе «/»).
export const BOT_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Меню' },
  { command: 'order', description: 'Добавить заказ' },
  { command: 'orders', description: 'Открытые заказы' },
  { command: 'stats', description: 'Статистика' },
  { command: 'vk', description: 'ВК-сводка по дням' },
  { command: 'corridor', description: 'Зелёный коридор — пересчёт по данным' },
  { command: 'period', description: 'Отчёт по датам (фильтр + детализация)' },
  { command: 'phones', description: 'Телефоны' },
  { command: 'find', description: 'Поиск телефона по 4 цифрам IMEI' },
  { command: 'recent', description: 'Последние закупки' },
  { command: 'history', description: 'История телефона' },
  { command: 'report', description: 'Отчёт в группу' },
  { command: 'export', description: 'Выгрузка CSV (модератор)' },
  { command: 'help', description: 'Помощь' },
  { command: 'cancel', description: 'Отменить ввод' },
];
