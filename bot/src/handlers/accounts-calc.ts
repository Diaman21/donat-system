import { fmtMsk } from '../format.js';

// Очередь аккаунтов (миграция 0020, 01.11.2026) — чистая логика, без базы:
// тексты постов в теме «👤 Аккаунты» и порог «осталось мало».

/** Сколько готовых аккаунтов — уже «мало» (решение владельца: тегать при 1). */
export const STOCK_LOW = 1;

export type StockAlert = 'low' | 'empty';

/**
 * Предупреждение о запасе — ТОЛЬКО при переходе через порог вниз, чтобы не
 * тегать оператора после каждого нажатия: было 2 → стал 1 — «осталось мало»,
 * стал 0 — «закончились». Добавили аккаунт — запас растёт, молчим.
 */
export function stockAlert(before: number, after: number): StockAlert | null {
  if (after >= before) return null;
  if (after === 0) return 'empty';
  if (after <= STOCK_LOW && before > STOCK_LOW) return 'low';
  return null;
}

/**
 * Ежедневное напоминание (12:00, решение владельца 10.11.2026): пока готовых
 * ≤ порога — каждый день, без «перехода через порог». Стало больше — молчим.
 */
export function stockLevel(ready: number): StockAlert | null {
  if (ready <= 0) return 'empty';
  if (ready <= STOCK_LOW) return 'low';
  return null;
}

export function stockAlertText(alert: StockAlert, mentions: string): string {
  const who = mentions ? ` ${mentions}` : '';
  const text: Record<StockAlert, string> = {
    low: `⚠️ Остался ${STOCK_LOW} готовый аккаунт —${who} нужно сделать ещё.`,
    empty: `🔴 Аккаунты закончились —${who} нужно сделать новые.`,
  };
  return text[alert];
}

export interface PostAccount {
  num: number;
  text: string;
  author: string | null;
  createdAt: Date;
}

const by = (u: string | null) => (u ? `@${u}` : '—');

/** Пост о новом аккаунте. */
export function readyPost(a: PostAccount, readyCount: number): string {
  return [
    `👤 Аккаунт #${a.num} — готов к регистрации`,
    a.text,
    `добавил ${by(a.author)} · ${fmtMsk(a.createdAt)}`,
    `📦 Готово к регистрации: ${readyCount}`,
  ].join('\n');
}

/** Тот же пост после регистрации — сообщение в теме редактируется, а не дублируется. */
export function registeredPost(
  a: PostAccount,
  reg: { user: string | null; at: Date; phone: string | null },
): string {
  return [
    `✅ Аккаунт #${a.num} — зарегистрирован`,
    a.text,
    `добавил ${by(a.author)} · ${fmtMsk(a.createdAt)}`,
    `зарегистрировал ${by(reg.user)} · ${fmtMsk(reg.at)}${reg.phone ? ` · телефон ${reg.phone}` : ''}`,
  ].join('\n');
}

export function cancelledPost(a: PostAccount, user: string | null, at: Date): string {
  return [
    `🗑 Аккаунт #${a.num} — отменён`,
    a.text,
    `добавил ${by(a.author)} · ${fmtMsk(a.createdAt)} · отменил ${by(user)} · ${fmtMsk(at)}`,
  ].join('\n');
}
