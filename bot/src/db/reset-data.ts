import { sql } from 'drizzle-orm';
import { db, client } from './client';
import { phones, purchases } from './schema';

// Очистка ТЕСТОВЫХ данных: удаляет все покупки и телефоны.
// НЕ трогает users (роли) и purchase_categories (seed).
// Запуск (с подтверждением): npx tsx src/db/reset-data.ts --yes
async function main() {
  if (process.argv[2] !== '--yes') {
    console.log('Это удалит ВСЕ покупки и телефоны (users и категории останутся).');
    console.log('Для подтверждения запусти: npx tsx src/db/reset-data.ts --yes');
    process.exit(1);
  }

  // Снимаем циклическую ссылку phones.death_purchase_id, затем чистим
  await db.update(phones).set({ deathPurchaseId: null });
  const delPurch = await db.delete(purchases).returning({ id: purchases.id });
  const delPhones = await db.delete(phones).returning({ id: phones.id });

  console.log(`🗑 Удалено покупок: ${delPurch.length}`);
  console.log(`🗑 Удалено телефонов: ${delPhones.length}`);

  // Контроль остатка
  const left = await db.select({ n: sql<number>`count(*)::int` }).from(purchases);
  const leftPh = await db.select({ n: sql<number>`count(*)::int` }).from(phones);
  console.log(`Осталось покупок: ${left[0]?.n ?? 0}, телефонов: ${leftPh[0]?.n ?? 0}`);

  await client.end();
}

main().catch((err) => {
  console.error('Ошибка очистки:', err);
  process.exit(1);
});
