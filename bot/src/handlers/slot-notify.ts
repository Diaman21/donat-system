import type { Api } from 'grammy';
import { pg } from '../db/pg.js';
import type { PurchaseResultValue } from '../db/schema.js';
import { env } from '../config.js';
import { inTopic } from '../group.js';
import { fmtMsk } from '../format.js';
import { parsePhoneModel, modelGroup } from './phone-model.js';
import { BIG_EUR, PROTOCOL_GAP_H, WITHDRAW_DAYS } from './interval.js';
import { slotsToNotify, inWorkHours, type PhoneInput } from './slots.js';
import { teamMentions, countOpen } from './team.js';

// Напоминания о слотах под €100 (19.10.2026). Вызывается внешним будильником
// cron-job.org (каждые 15 минут, 09–23 МСК) через /api/cron-slots: кроны Vercel
// Hobby бывают только раз в сутки. Логика «кому и когда» — в slots.ts (с тестами).
// ⚠️ Каждый тик — процессорное время из бесплатного лимита Vercel (общего на все
// проекты; при 100% всё ставится на паузу). Сюда не тянуть тяжёлые модули:
// заказы/меню/drizzle/grammy — нет, база — голым драйвером pg (03.11.2026,
// лимит дошёл до 75%; drizzle один грузится ~330 мс на каждый холодный вызов).
//
// Правила (решение владельца 19.10.2026):
//   - только слоты под €100, только когда есть открытые заказы;
//   - только в рабочий день 09:00–24:00 МСК; открывшиеся ночью приходят
//     первым сообщением после 09:00 (ночью будильник не вызывается, а если
//     вызовут — молчит);
//   - одно напоминание на слот: новая покупка на телефоне — новый слот.

/** Ключ в bot_sessions: «телефон → id покупки, по которой уже напомнили». */
const NOTIFIED_KEY = 'cron:slot-notify';

/** Активные телефоны с последней покупкой и списаниями — для экрана и напоминаний. */
export async function loadActivePhones(): Promise<PhoneInput[]> {
  const rows = await pg<
    {
      id: string;
      imei: string;
      label: string | null;
      // строка в процессе бота, Date в будильнике (см. pg.ts) — читаем через new Date
      first_at: string | Date | null;
      last: { id: string; at: string; result: PurchaseResultValue } | null;
      charges: { at: string; amount: number }[];
    }[]
  >`
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
    from phones ph where ph.status = 'active' order by ph.connected_at`;
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
  const r = await pg<{ value: Record<string, string> }[]>`
    select value from bot_sessions where key = ${NOTIFIED_KEY}`;
  return r[0]?.value ?? {};
}

async function writeNotified(value: Record<string, string>): Promise<void> {
  await pg`
    insert into bot_sessions (key, value) values (${NOTIFIED_KEY}, ${JSON.stringify(value)}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

export interface SlotRun {
  status: 'quiet-hours' | 'no-orders' | 'nothing' | 'sent' | 'no-group';
  phones: string[];
  open?: number;
}

/**
 * Один «тик» будильника. dry — ничего не отправлять и не запоминать
 * (для проверки: /api/cron-slots?dry=1).
 * getApi — Telegram поднимается, только когда есть что отправить: в большинстве
 * тиков отправлять нечего, а загрузка grammy — это процессорное время Vercel.
 */
export async function runSlotCheck(
  getApi: () => Promise<Api>,
  now = new Date(),
  dry = false,
): Promise<SlotRun> {
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
      // Запас до оптимума протокола (12.11.2026): «можно» держится на одном интервале.
      ...(slot.bigBetterAt && slot.bigBetterAt.getTime() > now.getTime()
        ? [`   👌 лучше с ${fmtMsk(slot.bigBetterAt)} — от ${PROTOCOL_GAP_H} ч, как в протоколе`]
        : []),
      // «прошло N из 14» — та же нумерация, что в сводке и «☎️ Телефоны».
      `   прошло ${slot.day! - 1} из ${WITHDRAW_DAYS} дн · последняя покупка ${fmtMsk(phone.last!.at)}`,
    ]),
    line,
    `📥 Открытых заказов: ${open}`,
    mentions ? `👉 ${mentions}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const api = await getApi();
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
