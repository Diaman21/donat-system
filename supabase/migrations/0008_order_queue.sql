-- ============================================================
-- Donat System — миграция 0008
-- order_queue — простой список заказов для команды.
--
-- НЕ путать со старой таблицей `orders` (наследие модели «доска заказов»
-- с заказчиками, карточками и статусами — от неё отказались; таблица пустая
-- и остаётся только из-за FK purchases.order_id).
--
-- Здесь всё проще: оператор скидывает текст заказа как есть, потом отмечает
-- «выполнен» или «отменён». С покупками СОЗНАТЕЛЬНО не связываем —
-- чтобы не мусорить данные «зелёного коридора» лишними переменными.
-- ============================================================

create table order_queue (
  id          uuid primary key default gen_random_uuid(),
  num         bigserial unique,                 -- человеческий номер: «Заказ #37»
  text        text not null,                    -- сам заказ, как скинули
  status      text not null default 'open'
              check (status in ('open', 'done', 'cancelled')),
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now(),
  done_by     uuid references users(id),        -- кто закрыл (выполнил/отменил)
  done_at     timestamptz,
  updated_at  timestamptz not null default now()
);

-- Открытые заказы тянем чаще всего — по ним и индекс.
create index order_queue_status_idx on order_queue (status, created_at);

create trigger trg_order_queue_updated before update on order_queue
  for each row execute function set_updated_at();

alter table order_queue enable row level security;
