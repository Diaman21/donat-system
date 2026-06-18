import { eq } from 'drizzle-orm';
import { db, client } from './client.js';
import { purchaseCategories } from './schema.js';

// Методики прогрева (стартовые гипотезы из опыта оператора, 2026-06).
// Хранятся в purchase_categories.warmup_config (jsonb). Меняй здесь и
// запускай: npx tsx src/db/set-warmup.ts — данные обновятся в Neon.
// Цель — подтвердить/уточнить «зелёный коридор» по накопленным данным.
// Валюта проекта — евро (€). Ключи объекта = коды категорий.
const WARMUP: Record<string, unknown> = {
  game_donate: {
    games: ['Massive', 'Furious'],
    method: '2–3 дня покупки по €2 (разогрев) в игре, затем разрешены €30 и €100',
    steps: [
      { day: '1–3', amount: 2, role: 'разогрев', note: 'покупки по €2' },
      { day: '4+', amounts: [30, 100], role: 'боевые закупки' },
    ],
    source: 'эмпирически выявлено оператором (2026-06)',
    goal: 'подтвердить/уточнить коридор по данным',
  },
  vk_votes: {
    availability: 'ВК открыт ~2 недели в месяц (раз в месяц)',
    nominals: '10 гол/€0.99, 18/€1.99, 28/€2.99, 40/€3.99',
    method:
      'День 1: серия из 4 покупок по 40 голосов (€3.99 каждая, ≈€15.96 за серию), ' +
      'повторять 2–3 раза с интервалом в несколько часов. Дальше лимит растёт — уточняем по данным.',
    steps: [
      {
        day: 1,
        pattern: '4 покупки по 40 голосов (€3.99) в серии; серий 2–3; интервал — несколько часов',
        seriesCost: 15.96,
      },
      { day: '2+', note: 'лимит растёт; точный цикл/коридор выявляем органически по purchases' },
    ],
    source: 'эмпирически (2026-06)',
    goal: 'выявить цикл и коридор закупок ВК без ошибок',
  },
};

async function main() {
  for (const [code, cfg] of Object.entries(WARMUP)) {
    const res = await db
      .update(purchaseCategories)
      .set({ warmupConfig: cfg })
      .where(eq(purchaseCategories.code, code))
      .returning({ code: purchaseCategories.code });
    console.log(res.length > 0 ? `✅ warmup_config обновлён: ${code}` : `⚠️ категория не найдена: ${code}`);
  }
  await client.end();
}

main().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});
