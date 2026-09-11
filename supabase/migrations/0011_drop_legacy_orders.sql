-- 0011: удаление мёртвой таблицы orders (наследие модели «доска заказов»)
--
-- КОНТЕКСТ. В самой первой версии (0001_init) закладывалась доска заказов
-- с заказчиками: orders + purchases.order_id. От этой модели отказались
-- осознанно (см. анти-цели в TODO.md) — бот стал логгером закупок.
-- Список задач команды сделан отдельно: order_queue (0008), а связь
-- заказа с покупкой — через purchases.order_queue_id (0009).
--
-- В итоге на purchases висят ДВЕ «заказные» колонки: order_id (мёртвая)
-- и order_queue_id (рабочая). Это ровно та путаница, из-за которой рано
-- или поздно кто-то напишет запрос не по той колонке.
--
-- ПРОВЕРЕНО ПЕРЕД УДАЛЕНИЕМ (12.09.2026):
--   • orders — 0 строк;
--   • purchases.order_id — NULL во всех 519 строках;
--   • на orders ссылается только purchases.order_id;
--   • вьюх и RLS-политик на orders нет;
--   • тип order_status используется ТОЛЬКО в orders.status
--     (order_queue.status — обычный text);
--   • в коде orders/Order/NewOrder встречаются только в schema.ts.
--
-- ⚠️ ПРО БЭКАПЫ. Ежедневный JSON-дамп после этой миграции больше не
-- содержит purchases.order_id. Бэкапы, снятые ДО 12.09.2026, содержат эту
-- колонку — при восстановлении старого дампа её нужно просто отбросить
-- (данных в ней нет, во всех строках NULL). См. docs/db-schema.md.
--
-- Откат: восстановить структуру из 0001_init.sql (данных в ней нет).

begin;

-- 1) Колонка-сирота в purchases. Вместе с ней уходят внешний ключ
--    purchases_order_id_fkey и индекс purchases_order_idx.
alter table purchases drop column if exists order_id;

-- 2) Сама таблица. Вместе с ней уходит триггер trg_orders_updated
--    и внешние ключи на users / purchase_categories.
drop table if exists orders;

-- 3) Enum, который больше некому использовать.
drop type if exists order_status;

commit;
