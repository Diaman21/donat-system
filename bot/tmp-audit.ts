// Прогон read-only обработчиков на боевой базе. Сообщения НЕ отправляются —
// поддельный ctx складывает их в память. Ничего не пишет в базу.
import { db } from './src/db/client.js';
import { sql } from 'drizzle-orm';
import { users, phones, purchases, orderQueue } from './src/db/schema.js';
import { eq } from 'drizzle-orm';
import { showCorridor, phonesNowLines, violationsLines, idleLines, boundaryShiftLines, modelLines } from './src/handlers/corridor.js';
import { showVkReport } from './src/handlers/vk.js';
import { renderStats } from './src/handlers/stats.js';
import { showPhoneList, showPhoneHistory } from './src/handlers/history.js';
import { showRecent } from './src/handlers/recent.js';
import { onFindPhoneImei, listPhones, listPrepared } from './src/handlers/phones.js';
import { weeklyLines } from './src/handlers/weekly.js';
import { buildFullBackup } from './src/handlers/backup.js';
import { buildPurchasesCsv } from './src/handlers/export.js';
import { buildPostMortem, buildCycleSummary } from './src/handlers/postmortem.js';
import { startReport, onReportCallback } from './src/handlers/report.js';

const mod = (await db.select().from(users).where(eq(users.role, 'moderator')).limit(1))[0]!;
const out: { name: string; text: string }[] = [];
let cur = '';
const ctx: any = {
  dbUser: mod,
  chat: { type: 'private', id: 0 },
  from: { id: 0 },
  me: { username: 'donat_system_bot' },
  session: {},
  reply: async (t: string) => { out.push({ name: cur, text: t }); return { message_id: 1 }; },
  editMessageText: async (t: string) => { out.push({ name: cur, text: t }); return true; },
  answerCallbackQuery: async () => true,
  replyWithDocument: async () => ({}),
};
const errors: string[] = [];
const run = async (name: string, f: () => Promise<unknown>) => {
  cur = name;
  try { const r = await f(); if (Array.isArray(r)) out.push({ name, text: r.join('\n') }); else if (typeof r === 'string') out.push({ name, text: r }); }
  catch (e) { errors.push(`${name}: ${String(e).slice(0, 300)}`); }
};

await run('/corridor', () => showCorridor(ctx));
await run('/vk', () => showVkReport(ctx));
for (const p of ['all', '24h', '7d'] as const) await run(`/stats ${p}`, async () => (await renderStats(p)).text);
await run('phonesNow', phonesNowLines);
await run('violations 24h', () => violationsLines(24));
await run('violations 30d', () => violationsLines(24 * 30));
await run('idle', idleLines);
await run('shift', boundaryShiftLines);
await run('models', modelLines);
await run('weekly (пн 05.10)', () => weeklyLines(new Date('2026-10-05T09:00:00Z')));
await run('history list', () => showPhoneList(ctx));
await run('recent', () => showRecent(ctx));
await run('phones', () => listPhones(ctx));
await run('prepared', () => listPrepared(ctx));
await run('/period', () => startReport(ctx));

// Каждый телефон: история, поиск по IMEI; каждый мёртвый: post-mortem и итог цикла.
const all = (await db.select({ id: phones.id, imei: phones.imeiLast4, status: phones.status, dr: phones.deathReason }).from(phones)) as any[];
let hist = 0, pm = 0, cs = 0, find = 0;
for (const p of all) {
  await run(`history …${p.imei}`, () => showPhoneHistory(ctx, p.id)); hist++;
  await run(`find …${p.imei}`, () => onFindPhoneImei(ctx, p.imei)); find++;
  if (p.status === 'dead') {
    await run(`pm …${p.imei}`, () => buildPostMortem(p.id)); pm++;
    await run(`cycle …${p.imei}`, () => buildCycleSummary(p.id)); cs++;
  }
}

// Бэкап и CSV — сверка с базой построчно.
const b: any = await buildFullBackup();
const cnt = (await db.execute(sql`select
  (select count(*) from users)::int users, (select count(*) from purchase_categories)::int cats,
  (select count(*) from phones)::int phones, (select count(*) from purchases)::int purchases,
  (select count(*) from order_queue)::int orders`)) as any[];
const csv = await buildPurchasesCsv();

const longest = out.reduce((m, o) => (o.text.length > m.text.length ? o : m), { name: '', text: '' });
console.log(`обработчиков вызвано: ${new Set(out.map((o) => o.name)).size}, сообщений: ${out.length}`);
console.log(`историй ${hist} · поисков ${find} · post-mortem ${pm} · итогов цикла ${cs}`);
console.log(`самое длинное: ${longest.name} — ${longest.text.length} симв (лимит 4096)`);
console.log(`больше 4096: ${out.filter((o) => o.text.length > 4096).map((o) => o.name).join(', ') || 'нет'}`);
console.log(`подозрительное («undefined», «NaN», «null», «[object»): ${out.filter((o) => /undefined|NaN|\bnull\b|\[object/.test(o.text)).map((o) => o.name).join(', ') || 'нет'}`);
console.log(`ошибок: ${errors.length}`); for (const e of errors) console.log('  ✖', e);
console.log('бэкап:', JSON.stringify(Object.fromEntries(Object.entries(b.tables ?? b).map(([k, v]: any) => [k, Array.isArray(v) ? v.length : typeof v]))));
console.log('база: ', JSON.stringify(cnt[0]));
console.log('CSV строк:', csv?.count);
const corr = out.find((o) => o.name === '/corridor');
console.log('\n----- /corridor (начало) -----\n' + corr?.text.split('\n').slice(0, 9).join('\n'));
process.exit(0);
