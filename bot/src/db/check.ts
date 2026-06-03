import { db, client } from './client';
import { purchaseCategories } from './schema';

// Утилита проверки подключения к Neon.
// Запуск: npm run db:check
async function main() {
  const cats = await db.select().from(purchaseCategories);
  console.log('✅ Подключение к Neon работает.');
  console.log(`Категорий закупок в БД: ${cats.length}`);
  for (const c of cats) {
    console.log(`  • ${c.code} — ${c.name} (суммы: ${JSON.stringify(c.denominations)})`);
  }
  await client.end();
}

main().catch((err) => {
  console.error('❌ Ошибка подключения к Neon:');
  console.error(err);
  process.exit(1);
});
