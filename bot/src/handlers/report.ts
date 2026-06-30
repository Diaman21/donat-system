import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db } from '../db/client.js';
import { phones, type PurchaseResultValue } from '../db/schema.js';
import type { AppContext } from '../context.js';
import { requireOperator } from './start.js';
import { HIST_CB } from './history.js';

// «📅 Отчёт» — проводник по датам с проваливанием:
//   период → дни → день (телефоны) → телефон за день (таймлайн).
// Навигация = редактирование одного сообщения + кнопки «⬅️ Назад» (как в /stats).
// Период храним в сессии (session.report), день/телефон едут в callback —
// так влезаем в лимит 64 байта на callback_data.

export const REP_CB = 'rep:';

const EMOJI: Record<PurchaseResultValue, string> = { done: '✅', support: '⚠️', long: '💀' };

const MASK =
  '✏️ Введи дату или интервал в формате ДД.ММ\n\n' +
  'Образец:\n' +
  '• Один день:  22.06\n' +
  '• Интервал:   20.06-25.06\n\n' +
  '(год берётся текущий)';

// ---------- даты (МСК) ----------
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

function mskNow() {
  const t = new Date(Date.now() + 3 * 3600 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}
function todayIso() {
  const { y, m, d } = mskNow();
  return isoOf(y, m, d);
}
function addDays(iso: string, delta: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}
const ddmm = (iso: string) => {
  const p = iso.split('-');
  return `${p[2]}.${p[1]}`;
};
function hhmm(at: unknown) {
  const x = new Date(at as string);
  x.setUTCHours(x.getUTCHours() + 3);
  return `${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

function presetRange(p: string): { from: string; to: string } | null {
  const today = todayIso();
  if (p === 'today') return { from: today, to: today };
  if (p === 'yesterday') {
    const y = addDays(today, -1);
    return { from: y, to: y };
  }
  if (p === '7d') return { from: addDays(today, -6), to: today };
  if (p === 'month') {
    const { y, m } = mskNow();
    return { from: isoOf(y, m, 1), to: today };
  }
  return null;
}

function parseDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : mskNow().y;
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return isoOf(y, mo - 1, d);
}
function parseRange(text: string): { from: string; to: string } | null {
  const parts = text.split(/\s*[-–—]\s*/).filter(Boolean);
  if (parts.length === 1) {
    const d = parseDate(parts[0] ?? '');
    return d ? { from: d, to: d } : null;
  }
  if (parts.length === 2) {
    const a = parseDate(parts[0] ?? '');
    const b = parseDate(parts[1] ?? '');
    if (!a || !b) return null;
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  return null;
}

// ---------- рендер ----------
async function render(ctx: AppContext, text: string, kb: InlineKeyboard, edit: boolean) {
  if (edit) {
    await ctx.editMessageText(text, { reply_markup: kb }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

function rangePicker(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Сегодня', `${REP_CB}range:today`)
    .text('Вчера', `${REP_CB}range:yesterday`)
    .row()
    .text('7 дней', `${REP_CB}range:7d`)
    .text('Этот месяц', `${REP_CB}range:month`)
    .row()
    .text('✏️ Свой период', `${REP_CB}range:custom`);
}

// Вход: «📅 Отчёт» / /period
export async function startReport(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  await render(ctx, '📅 За какой период отчёт?', rangePicker(), false);
}

// Уровень 1 — дни периода
async function showDays(ctx: AppContext, from: string, to: string, edit: boolean) {
  const rows = (await db.execute(sql`
    select to_char((purchased_at at time zone 'Europe/Moscow')::date, 'YYYY-MM-DD') as d,
           count(*)::int as cnt,
           count(distinct phone_id)::int as tels,
           coalesce(sum(amount),0)::float as eur
    from purchases
    where (purchased_at at time zone 'Europe/Moscow')::date between ${from}::date and ${to}::date
    group by 1 order by 1
  `)) as unknown as { d: string; cnt: number; tels: number; eur: number }[];

  const title = from === to ? ddmm(from) : `${ddmm(from)}–${ddmm(to)}`;
  if (rows.length === 0) {
    const kb = new InlineKeyboard().text('⬅️ Период', `${REP_CB}home`);
    await render(ctx, `📅 ${title}\nЗа этот период закупок не было.`, kb, edit);
    return;
  }
  const totalCnt = rows.reduce((a, r) => a + r.cnt, 0);
  const totalEur = rows.reduce((a, r) => a + r.eur, 0);

  const kb = new InlineKeyboard();
  for (const r of rows) {
    kb.text(`${ddmm(r.d)} · ${r.tels} тел · ${r.cnt} пок`, `${REP_CB}day:${r.d}`).row();
  }
  kb.text('⬅️ Период', `${REP_CB}home`);
  await render(
    ctx,
    `📅 ${title} · ${totalCnt} покупок · €${totalEur.toFixed(2)}\nВыбери день:`,
    kb,
    edit,
  );
}

// Уровень 2 — конкретный день (телефоны этого дня)
async function showDay(ctx: AppContext, day: string, edit: boolean) {
  const rows = (await db.execute(sql`
    select ph.id, ph.imei_last4 as imei, ph.label,
           count(*)::int as cnt,
           coalesce(sum(p.amount),0)::float as eur,
           coalesce(sum(p.units),0)::int as votes,
           sum(case when p.result='support' then 1 else 0 end)::int as sup,
           sum(case when p.result='long' then 1 else 0 end)::int as dead
    from purchases p join phones ph on ph.id = p.phone_id
    where (p.purchased_at at time zone 'Europe/Moscow')::date = ${day}::date
    group by ph.id, ph.imei_last4, ph.label
    order by min(p.purchased_at)
  `)) as unknown as {
    id: string;
    imei: string;
    label: string | null;
    cnt: number;
    eur: number;
    votes: number;
    sup: number;
    dead: number;
  }[];

  if (rows.length === 0) {
    const kb = new InlineKeyboard().text('⬅️ Дни', `${REP_CB}days`);
    await render(ctx, `📅 ${ddmm(day)}\nЗакупок не было.`, kb, edit);
    return;
  }
  const totalCnt = rows.reduce((a, r) => a + r.cnt, 0);
  const totalEur = rows.reduce((a, r) => a + r.eur, 0);

  const lines = [`📅 ${ddmm(day)} — ${totalCnt} покупок · €${totalEur.toFixed(2)}`, ''];
  for (const r of rows) {
    const label = r.label ? ` «${r.label}»` : '';
    const flags = `${r.dead ? ' 💀' : ''}${r.sup ? ` ⚠️${r.sup}` : ''}`;
    const votes = r.votes ? ` · ${r.votes}гол` : '';
    lines.push(`📱 …${r.imei}${label}: ${r.cnt} пок · €${r.eur.toFixed(2)}${votes}${flags}`);
  }
  lines.push('', 'Провалиться в телефон:');

  const kb = new InlineKeyboard();
  let i = 0;
  for (const r of rows) {
    kb.text(`…${r.imei}`, `${REP_CB}ph:${day}:${r.id}`);
    if (++i % 2 === 0) kb.row();
  }
  kb.row().text('⬅️ Дни', `${REP_CB}days`);
  await render(ctx, lines.join('\n'), kb, edit);
}

// Уровень 3 — один телефон за этот день (таймлайн)
async function showPhoneDay(ctx: AppContext, day: string, phoneId: string, edit: boolean) {
  const phRows = await db
    .select({ imei: phones.imeiLast4, label: phones.label })
    .from(phones)
    .where(eq(phones.id, phoneId))
    .limit(1);
  const ph = phRows[0];
  if (!ph) {
    await render(ctx, 'Телефон не найден.', new InlineKeyboard().text('⬅️ Дни', `${REP_CB}days`), edit);
    return;
  }

  const items = (await db.execute(sql`
    select p.purchased_at as at, p.amount, p.result, p.game, p.units, p.internet
    from purchases p
    where p.phone_id = ${phoneId}
      and (p.purchased_at at time zone 'Europe/Moscow')::date = ${day}::date
    order by p.purchased_at
  `)) as unknown as {
    at: string;
    amount: string;
    result: PurchaseResultValue;
    game: string | null;
    units: number | null;
    internet: string | null;
  }[];

  const label = ph.label ? ` «${ph.label}»` : '';
  const head = [`📱 …${ph.imei}${label} · ${ddmm(day)} — ${items.length} покупок`, ''];
  const lines = items.map((p) => {
    const v = p.units ? ` (${p.units} гол)` : '';
    const g = p.game ? ` ${p.game}` : '';
    const net = p.internet === 'mobile' ? ' 📶' : p.internet === 'wifi' ? ' 📡' : '';
    return `${hhmm(p.at)} ${EMOJI[p.result]} €${p.amount}${v}${g}${net}`;
  });

  const kb = new InlineKeyboard()
    .text('⬅️ День', `${REP_CB}day:${day}`)
    .text('📜 Вся история', `${HIST_CB}${phoneId}`);
  await render(ctx, [...head, ...lines].join('\n'), kb, edit);
}

// Текст «своей даты»
export async function onReportCustomDate(ctx: AppContext, text: string): Promise<void> {
  const range = parseRange(text);
  if (!range) {
    await ctx.reply(`Не понял дату. ${MASK}`);
    return; // flow остаётся — ждём корректный ввод
  }
  ctx.session.flow = undefined;
  ctx.session.report = range;
  await showDays(ctx, range.from, range.to, false);
}

// Роутер callback'ов rep:*
export async function onReportCallback(ctx: AppContext, rest: string): Promise<void> {
  if (rest === 'home') return void (await render(ctx, '📅 За какой период отчёт?', rangePicker(), true));

  if (rest.startsWith('range:')) {
    const p = rest.slice('range:'.length);
    if (p === 'custom') {
      ctx.session.flow = { kind: 'report_custom_date' };
      await ctx.editMessageText(MASK).catch(() => {});
      return;
    }
    const range = presetRange(p);
    if (!range) return;
    ctx.session.report = range;
    return void (await showDays(ctx, range.from, range.to, true));
  }

  if (rest === 'days') {
    const r = ctx.session.report;
    if (!r) {
      await ctx.editMessageText('Период отчёта истёк. Начни заново: /period').catch(() => {});
      return;
    }
    return void (await showDays(ctx, r.from, r.to, true));
  }

  if (rest.startsWith('day:')) {
    return void (await showDay(ctx, rest.slice('day:'.length), true));
  }

  if (rest.startsWith('ph:')) {
    const parts = rest.split(':'); // ['ph', 'YYYY-MM-DD', '<uuid>']
    const day = parts[1];
    const id = parts[2];
    if (day && id) return void (await showPhoneDay(ctx, day, id, true));
  }
}
