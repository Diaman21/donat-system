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

// Сборка CSV всех покупок. Общая для /export и еженедельного бэкапа (cron).
export async function buildPurchasesCsv(): Promise<{ csv: string; count: number } | null> {
  const rows = await db
    .select({
      at: purchases.purchasedAt,
      amount: purchases.amount,
      result: purchases.result,
      game: purchases.game,
      imei: phones.imeiLast4,
      operator: users.username,
      internet: purchases.internet,
      units: purchases.units,
      notes: purchases.notes,
    })
    .from(purchases)
    .innerJoin(phones, eq(phones.id, purchases.phoneId))
    .innerJoin(users, eq(users.id, purchases.operatorId))
    .orderBy(desc(purchases.purchasedAt));

  if (rows.length === 0) return null;

  const header = [
    'Время (МСК)',
    'Телефон',
    'Игра',
    'Сумма €',
    'Голоса',
    'Результат',
    'Интернет',
    'Оператор',
    'Заметка',
  ];
  const lines = [header.join(';')];
  for (const r of rows) {
    const cells = [
      fmtMsk(r.at),
      `…${r.imei}`,
      r.game ?? '',
      r.amount,
      r.units ?? '',
      r.result,
      r.internet ?? '',
      r.operator ?? '',
      r.notes ?? '',
    ];
    lines.push(cells.map((c) => csvCell(String(c))).join(';'));
  }

  // BOM (﻿) — чтобы Excel правильно открыл UTF-8 (русские буквы)
  return { csv: '﻿' + lines.join('\r\n'), count: rows.length };
}

// /export — выгрузка всех покупок в CSV (только модератор, в личке).
export async function exportCsv(ctx: AppContext): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireModerator(ctx))) return;

  const built = await buildPurchasesCsv();
  if (!built) {
    await ctx.reply('Покупок нет — нечего выгружать.');
    return;
  }
  await ctx.replyWithDocument(new InputFile(Buffer.from(built.csv, 'utf8'), 'purchases.csv'), {
    caption: `Выгрузка: ${built.count} покупок.`,
  });
}
