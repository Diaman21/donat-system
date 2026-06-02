-- ============================================================
-- Donat System — Initial schema (0001)
-- Система управления закупкой донатов
-- ============================================================

-- ---------- Extensions ----------
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ============================================================
-- Enums
-- ============================================================
create type user_role       as enum ('customer', 'operator', 'moderator');
create type phone_status     as enum ('active', 'dead');
create type order_status     as enum ('new', 'taken', 'in_progress', 'completed', 'cancelled');
create type purchase_result  as enum ('done', 'support', 'long');   -- ✅ / ⚠️ / 💀

-- ============================================================
-- Helper: updated_at
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- users — все участники бота (роли)
-- ============================================================
create table users (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  username    text,
  full_name   text,
  role        user_role not null default 'customer',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_users_updated before update on users
  for each row execute function set_updated_at();

-- ============================================================
-- purchase_categories — типы закупок (расширяемо)
--   game_donate: $2 / $30 / $100
--   vk_votes:    мелкие по $4 (логика разогрева позже)
-- ============================================================
create table purchase_categories (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  denominations jsonb not null default '[]'::jsonb,   -- допустимые суммы
  warmup_config jsonb,                                -- гипотеза разогрева
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_categories_updated before update on purchase_categories
  for each row execute function set_updated_at();

-- ============================================================
-- phones — телефоны (≤3 активных, идентификация по 4 цифрам IMEI)
--   death_purchase_id добавляется после создания purchases (циклическая ссылка)
-- ============================================================
create table phones (
  id           uuid primary key default gen_random_uuid(),
  imei_last4   text not null check (imei_last4 ~ '^\d{4}$'),
  label        text,
  status       phone_status not null default 'active',
  operator_id  uuid references users(id),
  connected_at timestamptz not null default now(),
  died_at      timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_phones_updated before update on phones
  for each row execute function set_updated_at();

-- Только один АКТИВНЫЙ телефон на одни и те же 4 цифры IMEI
-- (умершие телефоны с тем же IMEI допустимы в истории)
create unique index phones_active_imei_unique
  on phones (imei_last4) where status = 'active';

create index phones_status_idx on phones (status);

-- ============================================================
-- orders — заказ от заказчика (игр.аккаунт + сумма)
-- ============================================================
create table orders (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references users(id),
  category_id  uuid not null references purchase_categories(id),
  game_account text not null,
  amount       numeric(12,2) not null check (amount > 0),
  status       order_status not null default 'new',
  operator_id  uuid references users(id),            -- кто взял заказ
  notes        text,
  created_at   timestamptz not null default now(),
  taken_at     timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz not null default now()
);
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();

create index orders_status_idx   on orders (status);
create index orders_customer_idx on orders (customer_id);
create index orders_operator_idx on orders (operator_id);

-- ============================================================
-- purchases — каждая фактическая покупка (ЯДРО базы знаний)
--   order_id nullable: разогревочные/прайминг-покупки без заказчика
-- ============================================================
create table purchases (
  id           uuid primary key default gen_random_uuid(),
  phone_id     uuid not null references phones(id),
  order_id     uuid references orders(id),            -- nullable: разогрев
  operator_id  uuid not null references users(id),
  category_id  uuid not null references purchase_categories(id),
  amount       numeric(12,2) not null check (amount > 0),
  result       purchase_result not null,              -- ✅ done / ⚠️ support / 💀 long
  purchased_at timestamptz not null default now(),    -- точное время покупки
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_purchases_updated before update on purchases
  for each row execute function set_updated_at();

create index purchases_phone_time_idx on purchases (phone_id, purchased_at);
create index purchases_order_idx      on purchases (order_id);
create index purchases_result_idx     on purchases (result);
create index purchases_category_idx   on purchases (category_id);

-- Циклическая ссылка: какой именно 💀-покупкой убит телефон
alter table phones
  add column death_purchase_id uuid references purchases(id);

-- ============================================================
-- Правило: максимум 3 АКТИВНЫХ телефона
-- ============================================================
create or replace function enforce_max_active_phones()
returns trigger language plpgsql as $$
declare
  active_count int;
begin
  if new.status = 'active' then
    select count(*) into active_count
      from phones
     where status = 'active' and id <> new.id;
    if active_count >= 3 then
      raise exception 'Превышен лимит активных телефонов (максимум 3)';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_max_active_phones
  before insert or update on phones
  for each row execute function enforce_max_active_phones();

-- ============================================================
-- Правило: 💀 long → телефон умирает навсегда
-- ============================================================
create or replace function handle_long_result()
returns trigger language plpgsql as $$
begin
  if new.result = 'long' then
    update phones
       set status            = 'dead',
           died_at           = new.purchased_at,
           death_purchase_id = new.id,
           updated_at        = now()
     where id = new.phone_id
       and status = 'active';
  end if;
  return new;
end;
$$;

create trigger trg_handle_long
  after insert on purchases
  for each row execute function handle_long_result();

-- ============================================================
-- Seed: категории закупок
-- ============================================================
insert into purchase_categories (code, name, denominations, warmup_config) values
('game_donate', 'Донаты в играх', '[2, 30, 100]'::jsonb,
 '{
    "schedule": [
      {"day": 1, "amounts": [2],   "note": "покупка $2, отдых"},
      {"day": 2, "amounts": [30],  "count": 1},
      {"day": 3, "amounts": [30],  "count": 2},
      {"day": 4, "amounts": [100]},
      {"day": 5, "amounts": [100]}
    ],
    "intervals": "unknown — система должна выявить"
  }'::jsonb),
('vk_votes', 'Голоса VK', '[4]'::jsonb,
 '{"note": "много мелких по $4, логика разогрева добавится позже"}'::jsonb);

-- ============================================================
-- RLS: включаем на всех таблицах.
--   Бот работает через service_role (обходит RLS).
--   Политики для веб-аналитики (модераторы) добавим на этапе фронта.
-- ============================================================
alter table users               enable row level security;
alter table purchase_categories enable row level security;
alter table phones              enable row level security;
alter table orders              enable row level security;
alter table purchases           enable row level security;
