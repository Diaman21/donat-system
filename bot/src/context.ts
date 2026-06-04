import type { Context, SessionFlavor } from 'grammy';
import type { User, PurchaseResultValue } from './db/schema.js';

// Состояние пошагового ввода (мастер-формы).
// Выбор телефона/категории/игры/суммы/результата — через inline-кнопки;
// ввод IMEI и «своей» суммы — текстом (роутится по flow).
export type FlowState =
  | { kind: 'add_phone_imei' }
  | { kind: 'add_phone_label'; imei: string }
  | { kind: 'purchase_category'; phoneId: string }
  | { kind: 'purchase_game'; phoneId: string; categoryCode: string }
  | { kind: 'purchase_amount'; phoneId: string; categoryCode: string; game: string | null }
  | {
      kind: 'purchase_result';
      phoneId: string;
      categoryCode: string;
      game: string | null;
      amount: string;
    }
  | {
      kind: 'purchase_confirm';
      phoneId: string;
      categoryCode: string;
      game: string | null;
      amount: string;
      result: PurchaseResultValue;
    };

export interface SessionData {
  flow?: FlowState;
}

// Контекст приложения: grammY + сессия + текущий пользователь из БД.
export type AppContext = Context & SessionFlavor<SessionData> & { dbUser?: User };
