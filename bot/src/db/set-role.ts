import { eq } from 'drizzle-orm';
import { db, client } from './client';
import { users, type UserRole } from './schema';

// Утилита: назначить роль пользователю.
// Запуск: npx tsx src/db/set-role.ts <telegram_id> <customer|operator|moderator>
async function main() {
  const [, , tgIdArg, roleArg] = process.argv;
  if (!tgIdArg || !roleArg) {
    console.error('Использование: tsx src/db/set-role.ts <telegram_id> <customer|operator|moderator>');
    process.exit(1);
  }
  const tgId = Number(tgIdArg);
  const role = roleArg as UserRole;

  const updated = await db
    .update(users)
    .set({ role })
    .where(eq(users.telegramId, tgId))
    .returning();

  if (updated.length === 0) {
    console.log(`Пользователь с telegram_id=${tgId} не найден.`);
  } else {
    const u = updated[0]!;
    console.log(`✅ Роль обновлена: @${u.username ?? '—'} → ${u.role}`);
  }
  await client.end();
}

main().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});
