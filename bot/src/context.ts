import type { Context, SessionFlavor } from 'grammy';
import type { User } from './db/schema';

// Состояние пошагового ввода (мастер-формы).
// Выбор телефона и результата — через inline-кнопки (callback),
// ввод IMEI / игры / суммы — текстом (роутится по flow).
export type FlowState =
  | { kind: 'add_phone_imei' }
  | { kind: 'add_phone_label'; imei: string }
  | { kind: 'purchase_game'; phoneId: string }
  | { kind: 'purchase_amount'; phoneId: string; game: string | null }
  | { kind: 'purchase_result'; phoneId: string; game: string | null; amount: string };

export interface SessionData {
  flow?: FlowState;
}

// Контекст приложения: grammY + сессия + текущий пользователь из БД.
export type AppContext = Context & SessionFlavor<SessionData> & { dbUser?: User };
