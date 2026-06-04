import { InputFile } from 'grammy';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { phones, purchases, users } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { requirePrivate } from './common.js';
import { requireModerator } from './start.js';
import { fmtMsk } from '../format.js';

function csvCell(v: string): string {
  return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// /export — выгрузка всех покупок в CSV (только модератор, в личке).
export async function exportCsv(ctx: AppContext): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireModerator(ctx))) return;

  const rows = await db
    .select({
      at: purchases.purchasedAt,
      amount: purchases.amount,
      result: purchases.result,
      game: purchases.game,
      imei: phones.imeiLast4,
      operator: users.username,
    })
    .from(purchases)
    .innerJoin(phones, eq(phones.id, purchases.phoneId))
    .innerJoin(users, eq(users.id, purchases.operatorId))
    .orderBy(desc(purchases.purchasedAt));

  if (rows.length === 0) {
    await ctx.reply('Покупок нет — нечего выгружать.');
    return;
  }

  const header = ['Время (МСК)', 'Телефон', 'Игра', 'Сумма $', 'Результат', 'Оператор'];
  const lines = [header.join(';')];
  for (const r of rows) {
    const cells = [
      fmtMsk(r.at),
      `…${r.imei}`,
      r.game ?? '',
      r.amount,
      r.result,
      r.operator ?? '',
    ];
    lines.push(cells.map((c) => csvCell(String(c))).join(';'));
  }

  // BOM (﻿) — чтобы Excel правильно открыл UTF-8 (русские буквы)
  const csv = '﻿' + lines.join('\r\n');
  await ctx.replyWithDocument(new InputFile(Buffer.from(csv, 'utf8'), 'purchases.csv'), {
    caption: `Выгрузка: ${rows.length} покупок.`,
  });
}
