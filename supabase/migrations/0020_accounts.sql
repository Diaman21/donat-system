-- 0020: очередь аккаунтов — Тим делает, владелец регистрирует на телефонах
--
-- КОНТЕКСТ (01.11.2026). Оператор готовит аккаунты и раньше скидывал их владельцу
-- в личку. Теперь — через бота: «👤 Аккаунты» → «➕ Добавить», пост в тему
-- «👤 Аккаунты» группы; владелец жмёт «✅ Зарегистрирован», выбирает телефон,
-- и пост в теме меняется на «зарегистрирован». Остался 1 готовый — бот тегает
-- оператора (решение владельца). Паролей в тексте нет — команда их не публикует.
--
-- status: ready (готов к регистрации) → registered | cancelled. Не удаляем —
-- история «какой аккаунт на каком телефоне» нужна (phone_id, nullable:
-- «без телефона» — тоже вариант).
-- topic_message_id — номер поста в теме, чтобы его отредактировать.
--
-- RLS включаем, как на всех рабочих таблицах (политик нет — см. CLAUDE.md, §4).

create table if not exists accounts (
  id               uuid primary key default gen_random_uuid(),
  num              bigserial not null unique,
  text             text not null check (length(text) between 1 and 3000),
  status           text not null default 'ready' check (status in ('ready', 'registered', 'cancelled')),
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  registered_by    uuid references users(id),
  registered_at    timestamptz,
  phone_id         uuid references phones(id),
  topic_message_id bigint,
  updated_at       timestamptz not null default now()
);

create index if not exists accounts_status_idx on accounts (status, created_at);
create index if not exists accounts_phone_idx on accounts (phone_id) where phone_id is not null;

alter table accounts enable row level security;
