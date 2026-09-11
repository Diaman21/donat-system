import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  bigint,
  bigserial,
  text,
  boolean,
  timestamp,
  numeric,
  jsonb,
  integer,
} from 'drizzle-orm/pg-core';

// ============================================================
// Drizzle-схема — ЗЕРКАЛО supabase/migrations/0001_init.sql
//
// ВАЖНО: схема БД создаётся и меняется ВРУЧНУЮ через SQL (в Neon).
// Здесь — типобезопасное отражение таблиц для запросов из кода.
// Мы НЕ генерируем миграции из этого файла (no drizzle-kit push).
// При изменении SQL-схемы — обновляй этот файл руками в соответствие.
// ============================================================

// ---------- Enums ----------
export const userRole = pgEnum('user_role', ['customer', 'operator', 'moderator']);
export const phoneStatus = pgEnum('phone_status', ['active', 'dead', 'prepared']);
export const purchaseResult = pgEnum('purchase_result', ['done', 'support', 'long']);
// order_status удалён вместе с таблицей orders (миграция 0011).
// У order_queue.status тип обычный text — отдельный enum ему не нужен.

// ---------- users ----------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  username: text('username'),
  fullName: text('full_name'),
  role: userRole('role').notNull().default('customer'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- purchase_categories ----------
export const purchaseCategories = pgTable('purchase_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  denominations: jsonb('denominations').notNull().default(sql`'[]'::jsonb`),
  warmupConfig: jsonb('warmup_config'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- phones ----------
// death_purchase_id — циклическая ссылка на purchases (FK уже есть в БД,
// здесь объявляем как обычный uuid, чтобы не плодить циклы в коде).
export const phones = pgTable('phones', {
  id: uuid('id').primaryKey().defaultRandom(),
  imeiLast4: text('imei_last4').notNull(),
  label: text('label'),
  status: phoneStatus('status').notNull().default('active'),
  operatorId: uuid('operator_id'),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  diedAt: timestamp('died_at', { withTimezone: true }),
  deathReason: text('death_reason'), // 'error' (Apple) | 'forced' (вынужденный вывод)
  notes: text('notes'),
  deathPurchaseId: uuid('death_purchase_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Таблица `orders` и колонка `purchases.order_id` УДАЛЕНЫ (миграция 0011).
// Это было наследие первой модели — «доски заказов» с заказчиками, от которой
// отказались. Список задач команды живёт в `order_queue` (0008), а связь
// заказа с покупкой — в `purchases.order_queue_id` (0009).

// ---------- purchases (ядро базы знаний) ----------
export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneId: uuid('phone_id').notNull(),
  operatorId: uuid('operator_id').notNull(),
  categoryId: uuid('category_id').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  result: purchaseResult('result').notNull(),
  game: text('game'), // игра (напр. «Массив»), опционально — миграция 0002
  internet: text('internet'), // 'mobile' | 'wifi' — тип интернета, миграция 0005
  units: integer('units'), // кол-во единиц (для ВК — голоса), миграция 0006
  // Заказ из order_queue, если покупка делалась по заказу (миграция 0009).
  // NULL — норма: разогрев €2 и ВК идут без заказа.
  orderQueueId: uuid('order_queue_id'),
  purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- bot_sessions — состояние пошагового ввода (grammy session) ----------
// Нужно для serverless (Vercel): память между запросами не сохраняется.
export const botSessions = pgTable('bot_sessions', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- order_queue — простой список заказов команды (миграция 0008) ----------
// Внутренний список задач двух операторов, не доска заказчиков.
// С покупками связан через purchases.order_queue_id (миграция 0009):
// закупка знает, по какому заказу сделана. На аналитику коридора это не
// влияет — колонка nullable и в её запросах не участвует.
// Состав заказа (сколько закупок нужно) — в items (миграция 0010).
export const orderQueue = pgTable('order_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  num: bigserial('num', { mode: 'number' }), // человеческий номер, генерирует БД
  text: text('text').notNull(),
  status: text('status').notNull().default('open'), // open | done | cancelled
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  doneBy: uuid('done_by'),
  doneAt: timestamp('done_at', { withTimezone: true }),
  // Состав заказа (миграция 0010): { total: N, list: [{label, amount}] }.
  // NULL — состав ещё не подтверждён оператором.
  items: jsonb('items'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Типы для удобства ----------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PurchaseCategory = typeof purchaseCategories.$inferSelect;
export type Phone = typeof phones.$inferSelect;
export type NewPhone = typeof phones.$inferInsert;
export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
export type OrderQueueItem = typeof orderQueue.$inferSelect;

export type UserRole = (typeof userRole.enumValues)[number];
export type PhoneStatus = (typeof phoneStatus.enumValues)[number];
export type PurchaseResultValue = (typeof purchaseResult.enumValues)[number];
