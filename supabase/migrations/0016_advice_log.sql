-- 0016: журнал подсказок — что бот сказал оператору после каждой покупки
--
-- КОНТЕКСТ (аудит 07.10.2026). Владелец спросил: «научилась ли система чему-то
-- за отпуск?». Чтобы ответить, пришлось ЗАДНИМ ЧИСЛОМ прогонять классификатор
-- отклонений по всем покупкам — и уже по сегодняшним правилам. Что бот сказал
-- тогда, нигде не хранилось: подсказки и предупреждения жили только в чате.
--
-- Хорошая практика систем, которые учатся на своих данных: хранить
-- «что сказали → что сделали → чем кончилось». Без этого нельзя проверить
-- главное — точны ли подсказки и следуют ли им:
--   * оператор купил раньше разрешённого времени — чем это кончилось?
--   * правило поменялось (пол не-Pro с 06.10) — что видел оператор ДО этого?
--
-- ЧТО ПИШЕМ. Одна строка на запись покупки (на последнюю строку мультизакупа):
--   anomalies     — отклонения, которые бот назвал: [{code, severity}];
--   next_small_at — с какого момента по правилам можно следующую €30;
--   next_big_at   — с какого момента можно следующую €100/€105;
--   rules         — какие правила действовали (дата последней правки), чтобы
--                   потом не путать «бот не предупредил» с «правила не было».
-- Тексты сообщений не храним — их можно восстановить кодом; храним факты.
--
-- Покупку удалили через ↩️ — её запись журнала уходит вместе с ней (cascade):
-- ошибочный ввод не должен оставлять след в статистике подсказок.
--
-- RLS включаем, как на всех рабочих таблицах (политик нет — см. CLAUDE.md, §4).

create table if not exists advice_log (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  purchase_id   uuid not null references purchases(id) on delete cascade,
  phone_id      uuid not null references phones(id),
  anomalies     jsonb not null default '[]'::jsonb,
  next_small_at timestamptz,
  next_big_at   timestamptz,
  rules         text not null
);

create index if not exists advice_log_phone_idx on advice_log (phone_id, created_at);
create unique index if not exists advice_log_purchase_uidx on advice_log (purchase_id);

alter table advice_log enable row level security;
