-- ============================================================
-- Donat System — миграция 0003
-- Хранилище состояния пошагового ввода бота (grammy session).
-- Нужно для работы на Vercel (serverless): между запросами
-- память не сохраняется, поэтому session живёт в БД.
-- ============================================================

create table if not exists bot_sessions (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
