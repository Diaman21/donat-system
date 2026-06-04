import { eq, sql } from 'drizzle-orm';
import type { StorageAdapter } from 'grammy';
import { db } from './client';
import { botSessions } from './schema';
import type { SessionData } from '../context';

// Хранилище grammy-сессий в Neon (Postgres).
// Нужно для serverless (Vercel), где память между запросами не сохраняется.
export class NeonSessionStore implements StorageAdapter<SessionData> {
  async read(key: string): Promise<SessionData | undefined> {
    const rows = await db
      .select({ value: botSessions.value })
      .from(botSessions)
      .where(eq(botSessions.key, key))
      .limit(1);
    const row = rows[0];
    return row ? (row.value as SessionData) : undefined;
  }

  async write(key: string, value: SessionData): Promise<void> {
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
