import type { Context, SessionFlavor } from 'grammy';
import type { User, PurchaseResultValue } from './db/schema.js';

// Состояние пошагового ввода (мастер-формы).
// Выбор телефона/категории/игры/суммы/результата — через inline-кнопки;
// ввод IMEI и «своей» суммы — текстом (роутится по flow).
export type FlowState =
  | { kind: 'add_phone_imei' }
  | { kind: 'add_phone_label'; imei: string }
  | { kind: 'add_phone_dest'; imei: string; label: string | null }
  | { kind: 'find_phone_imei' }
  | { kind: 'order_text' }
  | { kind: 'report_custom_date' }
  | { kind: 'purchase_category'; phoneId: string }
  | { kind: 'purchase_game'; phoneId: string; categoryCode: string }
  | { kind: 'purchase_game_custom'; phoneId: string; categoryCode: string }
  | { kind: 'purchase_amount'; phoneId: string; categoryCode: string; game: string | null }
  | {
      // ВК-мультизакуп: набираем кол-во одинаковых покупок счётчиком (➕/➖).
      kind: 'purchase_count';
      phoneId: string;
      categoryCode: string;
      amount: string; // цена одной покупки (€)
      unitsPer: number; // голосов за одну покупку
      qty: number; // сколько таких покупок
    }
  | {
      kind: 'purchase_result';
      phoneId: string;
      categoryCode: string;
      game: string | null;
      amount: string;
      units: number | null;
      qty: number;
    }
  | {
      kind: 'purchase_note';
      phoneId: string;
      categoryCode: string;
      game: string | null;
      amount: string;
      units: number | null;
      qty: number;
      result: PurchaseResultValue;
    }
  | {
      kind: 'purchase_confirm';
      phoneId: string;
      categoryCode: string;
      game: string | null;
      amount: string;
      units: number | null;
      qty: number;
      result: PurchaseResultValue;
      note: string | null;
    };

export interface SessionData {
  flow?: FlowState;
  // Заказ, который сейчас выполняем: ставится при «✅ Выполнить» в списке заказов,
  // читается в самом конце записи покупки. Хранится ОТДЕЛЬНО от flow, чтобы не
  // трогать обкатанную цепочку закупки. Сбрасывается при отмене и при закупке
  // «без заказа» — иначе старый заказ мог бы закрыться случайно.
  pendingOrderId?: string;
  // Активный период отчёта-проводника (📅 Отчёт). Хранится отдельно от flow,
  // чтобы callback-кнопки оставались короткими (день/телефон едут в callback).
  report?: { from: string; to: string };
}

// Контекст приложения: grammY + сессия + текущий пользователь из БД.
export type AppContext = Context & SessionFlavor<SessionData> & { dbUser?: User };
