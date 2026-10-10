-- 0017: журнал карты — бюджет на карте и возвраты при выкате телефона
--
-- КОНТЕКСТ (10.10.2026). Владелец хочет видеть, сколько денег осталось на карте,
-- чтобы вовремя выкатывать телефоны: при выкате все ✅ покупки этого телефона
-- возвращаются на карту примерно через 48 часов.
--
-- БАЛАНС НЕ ХРАНИТСЯ, А ВЫЧИСЛЯЕТСЯ (card-calc.ts):
--   на карте = последняя сумма, вбитая руками
--            − ✅ покупки, записанные после неё
--            + возвраты, срок которых наступил после неё.
-- Поэтому ↩️ удаление покупки и повторная доставка апдейта баланс не сбивают:
-- счётчика, который можно задвоить, нет.
--
-- ЧТО ПИШЕМ. Только то, чего нельзя вычислить:
--   kind = 'balance' — сумма на карте, вбитая руками (история правок копится);
--   kind = 'refund'  — ПОПРАВКА возврата по телефону: другая сумма (опоздали
--                      с выкатом — €2 не вернулись) или «пришёл раньше / уже
--                      учтён в балансе». Без строки возврат считается сам:
--                      сумма ✅ телефона, срок — время вывода + 48 ч.
--   effective_at     — для balance: момент правки; для refund: когда деньги
--                      считаются пришедшими на карту.
-- Поправка возврата одна на телефон (уникальный индекс) — правка заменяет её,
-- второй возврат по тому же телефону не появится.
-- Поправка действует, только если effective_at >= phones.died_at: телефон
-- «воскресили» через ↩️, а потом он умер снова — старая поправка не подхватится.
--
-- RLS включаем, как на всех рабочих таблицах (политик нет — см. CLAUDE.md, §4).

create table if not exists card_ledger (
  id           bigserial primary key,
  kind         text not null check (kind in ('balance', 'refund')),
  amount_eur   numeric(12,2) not null check (amount_eur >= 0),
  phone_id     uuid references phones(id),
  effective_at timestamptz not null,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint card_ledger_refund_has_phone check ((kind = 'refund') = (phone_id is not null))
);

create unique index if not exists card_ledger_refund_uidx on card_ledger (phone_id) where kind = 'refund';
create index if not exists card_ledger_balance_idx on card_ledger (effective_at desc) where kind = 'balance';

alter table card_ledger enable row level security;
