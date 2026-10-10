import type { PurchaseResultValue } from '../db/schema.js';
import { cycleDayMsk, fmtMsk } from '../format.js';
import { paidEur } from './money.js';
import { BIG_EUR, WITHDRAW_DAYS } from './interval.js';

// Бюджет на карте (миграция 0017, 10.10.2026) — чистая логика, без базы.
//
// ⚠️ БАЛАНС ВЫЧИСЛЯЕТСЯ, А НЕ ХРАНИТСЯ:
//   на карте = последняя сумма, вбитая руками
//            − ✅ покупки, записанные ПОСЛЕ неё (по created_at — реальное время ввода)
//            + возвраты, срок которых наступил после неё и уже прошёл.
// Счётчика «−€100 при каждой покупке» нет намеренно: ↩️ удаление покупки,
// повторная доставка апдейта, правка задним числом — всё это сбило бы счётчик,
// а вычисленный баланс сам остаётся верным.
//
// ВОЗВРАТ ПРИ ВЫКАТЕ. Телефон выведен (💀 / 🔐 / ☠️ вручную) — все его ✅ покупки
// возвращаются на карту примерно через REFUND_DELAY_H. Возврат добавляется в
// баланс САМ, когда срок наступил (решение владельца 10.10.2026). Если пришло
// не всё (опоздали с выкатом — €2 не вернулись) или пришло раньше — поправка
// руками, она хранится в card_ledger (kind = 'refund', одна на телефон).

/** Через сколько часов после выката деньги возвращаются на карту. */
export const REFUND_DELAY_H = 48;
/** Ниже этой суммы на карте сводка подсвечивает бюджет красным (решение владельца). */
export const CARD_LOW_EUR = 250;

const H = 3600 * 1000;

export const round2 = (x: number): number => Math.round(x * 100) / 100;

/** «€1240», «€12.50» — без копеек, когда их нет. */
export function fmtEur(x: number): string {
  const r = round2(x);
  return `€${Number.isInteger(r) ? r : r.toFixed(2)}`;
}

/**
 * Сумма, введённая руками: «1240», «1 240,50», «€1240». null — не число.
 * Отрицательных не бывает: на карте не может быть меньше нуля.
 */
export function parseEur(text: string): number | null {
  const s = text.replace(/[\s€]/g, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  return round2(Number(s));
}

export interface Anchor {
  amount: number;
  at: Date;
}

export interface RefundInput {
  phoneId: string;
  imei: string;
  label: string | null;
  diedAt: Date;
  /** Сумма ✅ покупок телефона за всё время — столько вернётся по умолчанию. */
  paid: number;
  /** Поправка из card_ledger, если есть. */
  override: { amount: number; at: Date } | null;
}

export interface Refund {
  phoneId: string;
  imei: string;
  label: string | null;
  amount: number;
  /** Когда деньги считаются пришедшими на карту. */
  at: Date;
  /** Сумма или срок поправлены руками. */
  edited: boolean;
}

/**
 * Возврат по телефону: поправка, если она относится к ЭТОЙ смерти телефона,
 * иначе — все ✅ телефона через REFUND_DELAY_H после вывода.
 * Поправка старше вывода — от прошлой жизни телефона (его «воскресили» через ↩️,
 * потом он умер снова), она не действует.
 */
export function resolveRefund(r: RefundInput): Refund {
  const base = { phoneId: r.phoneId, imei: r.imei, label: r.label };
  if (r.override && r.override.at.getTime() >= r.diedAt.getTime()) {
    return { ...base, amount: r.override.amount, at: r.override.at, edited: true };
  }
  return { ...base, amount: r.paid, at: new Date(r.diedAt.getTime() + REFUND_DELAY_H * H), edited: false };
}

export interface CardState {
  anchor: Anchor | null;
  /** Списано ✅ покупками после правки руками. */
  spent: number;
  /** Возвраты, пришедшие после правки руками. */
  credited: number;
  /** На карте сейчас; null — сумма ещё ни разу не вбита. */
  balance: number | null;
  /** Возвраты, которые ещё не пришли (по сроку), — по возрастанию срока. */
  inTransit: Refund[];
  transitSum: number;
  /** Сколько станет, когда всё в пути придёт; null — без начальной суммы. */
  afterRefunds: number | null;
  /** Возвраты, уже вошедшие в баланс после правки, — чтобы их можно было поправить. */
  creditedList: Refund[];
}

/**
 * Состояние карты.
 * @param spendRows ✅/⚠️/💀/🔐 строки, записанные ПОСЛЕ anchor.at (деньги — через paidEur).
 * @param refunds   выведенные телефоны (за разумное окно, см. card.ts).
 */
export function computeCard(
  anchor: Anchor | null,
  spendRows: { amount: string | number; result: PurchaseResultValue }[],
  refunds: RefundInput[],
  now: Date,
): CardState {
  const all = refunds.map(resolveRefund).filter((r) => r.amount > 0);
  const inTransit = all
    .filter((r) => r.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const transitSum = round2(inTransit.reduce((s, r) => s + r.amount, 0));

  if (!anchor) {
    return {
      anchor: null,
      spent: 0,
      credited: 0,
      balance: null,
      inTransit,
      transitSum,
      afterRefunds: null,
      creditedList: [],
    };
  }

  const spent = round2(spendRows.reduce((s, p) => s + paidEur(p), 0));
  // Возврат входит в баланс, если пришёл ПОСЛЕ правки руками: пришедший раньше
  // уже сидит во вбитой сумме — прибавить его снова значило бы задвоить.
  const creditedList = all.filter(
    (r) => r.at.getTime() > anchor.at.getTime() && r.at.getTime() <= now.getTime(),
  );
  const credited = round2(creditedList.reduce((s, r) => s + r.amount, 0));
  const balance = round2(anchor.amount - spent + credited);
  return {
    anchor,
    spent,
    credited,
    balance,
    inTransit,
    transitSum,
    afterRefunds: round2(balance + transitSum),
    creditedList,
  };
}

export interface ActivePhone {
  imei: string;
  label: string | null;
  firstAt: Date | null;
  /** Сумма ✅ телефона — столько вернётся при выкате. */
  paid: number;
}

export interface WithdrawCandidate {
  imei: string;
  label: string | null;
  daysPassed: number;
  paid: number;
}

/**
 * Кого выкатить, если бюджета мало: телефон ближе всех к концу цикла
 * (больше прошло дней), при равенстве — кто вернёт больше. Телефоны без ✅
 * не предлагаем: их выкат денег не вернёт. Это подсказка — решает человек.
 */
export function pickWithdrawCandidate(active: ActivePhone[], now: Date): WithdrawCandidate | null {
  let best: WithdrawCandidate | null = null;
  for (const p of active) {
    if (p.paid <= 0 || !p.firstAt) continue;
    const c = { imei: p.imei, label: p.label, daysPassed: cycleDayMsk(p.firstAt, now) - 1, paid: p.paid };
    if (!best || c.daysPassed > best.daysPassed || (c.daysPassed === best.daysPassed && c.paid > best.paid)) {
      best = c;
    }
  }
  return best;
}

const phoneTag = (r: { imei: string; label: string | null }): string =>
  `…${r.imei}${r.label ? ` «${r.label}»` : ''}`;

/** Строка про один возврат в пути: «…1234 €340 — ~11.10 14:00». */
export function transitLine(r: Refund): string {
  return `   ${phoneTag(r)} ${fmtEur(r.amount)} — ~${fmtMsk(r.at)}${r.edited ? ' (поправлен)' : ''}`;
}

/**
 * Блок «💳 Бюджет на карте» — один на сводку, экран кнопки и /stats.
 * full — экран кнопки: с расшифровкой, откуда взялась сумма.
 */
export function cardLines(
  st: CardState,
  candidate: WithdrawCandidate | null,
  opts: { full: boolean },
): string[] {
  const out: string[] = [];

  if (st.balance === null) {
    out.push('💳 Бюджет на карте: сумма ещё не задана — «💳 Бюджет» → «✏️ Вписать сумму».');
  } else {
    out.push(`💳 На карте ≈ ${fmtEur(st.balance)} · хватит на ${Math.max(0, Math.floor(st.balance / BIG_EUR))}×€${BIG_EUR}`);
    if (opts.full && st.anchor) {
      out.push(
        `   вписано ${fmtMsk(st.anchor.at)}: ${fmtEur(st.anchor.amount)}` +
          (st.spent > 0 ? ` · покупки после: −${fmtEur(st.spent)}` : '') +
          (st.credited > 0 ? ` · возвраты: +${fmtEur(st.credited)}` : ''),
      );
    }
  }

  if (st.inTransit.length > 0) {
    out.push(
      `💶 В пути ${fmtEur(st.transitSum)}` +
        (st.afterRefunds !== null ? ` → станет ≈ ${fmtEur(st.afterRefunds)}` : ''),
      ...st.inTransit.map(transitLine),
    );
  }

  if (st.balance !== null && st.balance < CARD_LOW_EUR) {
    if (st.afterRefunds !== null && st.afterRefunds >= CARD_LOW_EUR) {
      out.push(`🟡 На карте меньше ${fmtEur(CARD_LOW_EUR)}, но с возвратами в пути станет достаточно.`);
    } else {
      out.push(`🔴 Бюджет на исходе: меньше ${fmtEur(CARD_LOW_EUR)} даже с возвратами в пути.`);
      if (candidate) {
        out.push(
          `   Кандидат на выкат: ${phoneTag(candidate)} — прошло ${candidate.daysPassed} из ${WITHDRAW_DAYS} дн, ` +
            `вернёт ≈ ${fmtEur(candidate.paid)} (~${REFUND_DELAY_H} ч после выката). Решать вам.`,
        );
      }
    }
  }
  return out;
}
