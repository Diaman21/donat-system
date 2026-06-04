import type { BotCommand } from 'grammy/types';

// Команды бота (показываются в меню Telegram при вводе «/»).
export const BOT_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Меню' },
  { command: 'stats', description: 'Статистика' },
  { command: 'phones', description: 'Телефоны' },
  { command: 'recent', description: 'Последние закупки' },
  { command: 'history', description: 'История телефона' },
  { command: 'report', description: 'Отчёт в группу' },
  { command: 'export', description: 'Выгрузка CSV (модератор)' },
  { command: 'help', description: 'Помощь' },
  { command: 'cancel', description: 'Отменить ввод' },
];
