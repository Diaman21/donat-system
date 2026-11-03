import type { Message, Update } from 'grammy/types';

// Какие апдейты из группы бот всё равно выбросит (03.11.2026). Чистая логика —
// без config и базы: ею пользуется и api/webhook.ts ДО загрузки бота, и тесты.
//
// Зачем: бот — админ группы и получает КАЖДОЕ сообщение во всех темах, даже
// разговоры. Раньше на каждое Vercel поднимал весь бот (drizzle, все
// обработчики, чтение сессии из базы) — только чтобы выбросить его. Это
// процессор из общего бесплатного лимита Vercel. Теперь такие апдейты
// отсекаются в webhook за миллисекунды.
//
// ⚠️ Отсекать можно только то, что бот и так игнорирует (фильтр группы в
// bot.ts): в группе он реагирует на команды «/…», inline-кнопки и текст в теме
// «👤 Аккаунты». Добавляешь новую реакцию на сообщения в группе — сначала сюда.

export interface GroupSettings {
  groupChatId: string;
  topicAccounts: string;
}

/** Сообщение — текст в теме «👤 Аккаунты» нашей группы, не команда и не от бота. */
export function isAccountsTopicMessage(m: Message | undefined, s: GroupSettings): boolean {
  const topic = Number(s.topicAccounts);
  return (
    !!m?.text &&
    !m.text.startsWith('/') &&
    !m.from?.is_bot &&
    String(m.chat.id) === String(s.groupChatId) &&
    Number.isInteger(topic) &&
    topic > 0 &&
    m.message_thread_id === topic
  );
}

/**
 * true — сообщение в группе, которое бот всё равно проигнорирует: не команда
 * и не аккаунт в теме. Всё остальное (личка, кнопки, иные типы) — false:
 * пусть решает бот.
 */
export function isIgnoredGroupUpdate(u: Update, s: GroupSettings): boolean {
  const m = u.message;
  if (!m) return false;
  if (m.chat.type === 'private') return false;
  if (m.text?.startsWith('/')) return false;
  return !isAccountsTopicMessage(m, s);
}
