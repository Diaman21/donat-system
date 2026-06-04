import type { Api } from 'grammy';
import { env } from './config.js';

// Отправляет сообщение модератору в личку (если задан TELEGRAM_MODERATOR_CHAT_ID).
// Сам не бросает — ошибку отправки только логирует.
export async function notifyModerator(api: Api, text: string): Promise<void> {
  if (!env.moderatorChatId) return;
  try {
    await api.sendMessage(env.moderatorChatId, text);
  } catch (e) {
    console.error('Не удалось уведомить модератора:', e);
  }
}
