import type { Api } from 'grammy';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { PurchaseResultValue } from '../db/schema.js';
import { env } from '../config.js';
import { inTopic } from '../group.js';
import { fmtMsk } from '../format.js';
import { parsePhoneModel, modelGroup } from './phone-model.js';
import { BIG_EUR, WITHDRAW_DAYS } from './interval.js';
import { slotsToNotify, inWorkHours, type PhoneInput } from './slots.js';
import { teamMentions, countOpen } from './orders.js';

// Напоминания о слотах под €100 (19.10.2026). Вызывается внешним будильником
// cron-job.org каждые ~10 минут через /api/cron-slots: кроны Vercel Hobby
// бывают только раз в сутки. Логика «кому и когда» — в slots.ts (с тестами).
//
// Правила (решение владельца 19.10.2026):
//   - только слоты под €100, только когда есть открытые заказы;
//   - только в рабочий день 09:00–24:00 МСК; открывшиеся ночью приходят
//     первым сообщением после 09:00 (будильник тикает и ночью, но молчит);
//   - одно напоминание на слот: новая покупка на телефоне — новый слот.

/** Ключ в bot_sessions: «телефон → id покупки, по которой уже напомнили». */
const NOTIFIED_KEY = 'cron:slot-notify';

/** Активные телефоны с последней покупкой и списаниями — для экрана и напоминаний. */
export async function loadActivePhones(): Promise<PhoneInput[]> {
  const rows = (await db.execute(sql`
    select ph.id::text id, ph.imei_last4 imei, ph.label,
      (select min(q.purchased_at) from purchases q where q.phone_id = ph.id) first_at,
      (select row_to_json(l) from (
         select q.id::text id, q.purchased_at at, q.result::text result from purchases q
          where q.phone_id = ph.id
          -- серия мультизакупа: одно время, неуспешная строка — последняя по смыслу
          order by q.purchased_at desc, (q.result = 'done'), q.created_at desc limit 1) l) last,
      coalesce((select json_agg(json_build_object('at', q.purchased_at, 'amount', q.amount::float))
         from purchases q join purchase_categories c on c.id = q.category_id
        where q.phone_id = ph.id and q.result = 'done' and c.code = 'game_donate'
          and q.purchased_at > now() - interval '48 hours'), '[]'::json) charges
    from phones ph where ph.status = 'active' order by ph.connected_at`)) as unknown as {
    id: string;
    imei: string;
    label: string | null;
    first_at: string | null;
    last: { id: string; at: string; result: PurchaseResultValue } | null;
    charges: { at: string; amount: number }[];
  }[];
  return rows.map((r) => ({
    id: r.id,
    imei: r.imei,
    label: r.label,
    isPro: modelGroup(parsePhoneModel(r.label)) === 'pro',
    firstAt: r.first_at ? new Date(r.first_at) : null,
    last: r.last ? { id: r.last.id, at: new Date(r.last.at), result: r.last.result } : null,
    charges: r.charges.map((c) => ({ at: new Date(c.at), amount: Number(c.amount) })),
  }));
}

async function readNotified(): Promise<Record<string, string>> {
  const r = (await db.execute(sql`select value from bot_sessions where key = ${NOTIFIED_KEY}`)) as unknown as {
    value: Record<string, string>;
  }[];
  return r[0]?.value ?? {};
}

async function writeNotified(value: Record<string, string>): Promise<void> {
  await db.execute(sql`
    insert into bot_sessions (key, value) values (${NOTIFIED_KEY}, ${JSON.stringify(value)}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()`);
}

export interface SlotRun {
  status: 'quiet-hours' | 'no-orders' | 'nothing' | 'sent' | 'no-group';
  phones: string[];
  open?: number;
}

/**
 * Один «тик» будильника. dry — ничего не отправлять и не запоминать
 * (для проверки: /api/cron-slots?dry=1).
 */
export async function runSlotCheck(api: Api, now = new Date(), dry = false): Promise<SlotRun> {
  if (!inWorkHours(now)) return { status: 'quiet-hours', phones: [] };
  const open = await countOpen();
  if (open === 0) return { status: 'no-orders', phones: [], open };
  const [phones, notified] = await Promise.all([loadActivePhones(), readNotified()]);
  const due = slotsToNotify(phones, notified, now);
  if (due.length === 0) return { status: 'nothing', phones: [], open };
  const imeis = due.map((d) => `…${d.phone.imei}`);
  if (dry) return { status: 'sent', phones: imeis, open };
  if (!env.groupChatId) return { status: 'no-group', phones: imeis, open };

  const mentions = await teamMentions();
  const line = '━━━━━━━━━━━━━━━━━━';
  const text = [
    `⏰ Слот под €${BIG_EUR} открыт`,
    ...due.flatMap(({ phone, slot }) => [
      line,
      `📱 …${phone.imei}${phone.label ? ` «${phone.label}»` : ''} — можно с ${fmtMsk(slot.bigAt!)}`,
      // «прошло N из 14» — та же нумерация, что в сводке и «☎️ Телефоны».
      `   прошло ${slot.day! - 1} из ${WITHDRAW_DAYS} дн · последняя покупка ${fmtMsk(phone.last!.at)}`,
    ]),
    line,
    `📥 Открытых заказов: ${open}`,
    mentions ? `👉 ${mentions}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  await api.sendMessage(env.groupChatId, text, inTopic('orders'));

  // Запоминаем ПОСЛЕ отправки: не дошло — следующий тик повторит.
  // Неактивные телефоны из памяти выкидываем, чтобы она не росла.
  const active = new Set(phones.map((p) => p.id));
  const next: Record<string, string> = {};
  for (const [id, last] of Object.entries(notified)) if (active.has(id)) next[id] = last;
  for (const d of due) next[d.phone.id] = d.phone.last!.id;
  await writeNotified(next);
  return { status: 'sent', phones: imeis, open };
}
