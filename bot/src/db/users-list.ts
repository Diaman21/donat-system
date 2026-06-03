import { db, client } from './client';
import { users } from './schema';

async function main() {
  const all = await db.select().from(users);
  console.log(`Пользователей в БД: ${all.length}`);
  for (const u of all) {
    console.log(
      `  • id=${u.telegramId} @${u.username ?? '—'} «${u.fullName ?? '—'}» роль=${u.role} created=${u.createdAt.toISOString()}`,
    );
  }
  await client.end();
}

main().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});
