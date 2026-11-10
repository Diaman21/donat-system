import { eq, sql } from 'drizzle-orm';
import type { StorageAdapter } from 'grammy';
import { db } from './client.js';
import { botSessions } from './schema.js';
import type { SessionData } from '../context.js';

// Хранилище grammy-сессий в Neon (Postgres).
// Нужно для serverless (Vercel), где память между запросами не сохраняется.
export class NeonSessionStore implements StorageAdapter<SessionData> {
  // Что прочитали в последний раз (10.11.2026). grammY пишет сессию обратно
  // после КАЖДОГО апдейта, даже если она не менялась, — а это почти все нажатия.
  // Совпадает с прочитанным — запись пропускаем: минус запрос к базе на кнопку.
  // Снимок на записи НЕ обновляем: если два апдейта одного чата идут
  // одновременно, второй (ничего не менявший) не затрёт запись первого.
  private lastRead = new Map<string, string>();

  async read(key: string): Promise<SessionData | undefined> {
    const rows = await db
      .select({ value: botSessions.value })
      .from(botSessions)
      .where(eq(botSessions.key, key))
      .limit(1);
    const row = rows[0];
    if (row) this.lastRead.set(key, JSON.stringify(row.value));
    else this.lastRead.delete(key);
    return row ? (row.value as SessionData) : undefined;
  }

  async write(key: string, value: SessionData): Promise<void> {
    if (this.lastRead.get(key) === JSON.stringify(value)) return;
    await db
      .insert(botSessions)
      .values({ key, value })
      .onConflictDoUpdate({
        target: botSessions.key,
        set: { value, updatedAt: sql`now()` },
      });
  }

  async delete(key: string): Promise<void> {
    await db.delete(botSessions).where(eq(botSessions.key, key));
  }
}
