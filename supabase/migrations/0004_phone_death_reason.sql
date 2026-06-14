-- ============================================================
-- Donat System — миграция 0004
-- Причина смерти телефона:
--   'error'  — Apple выдал ошибку (через 💀 long) = телефон достиг предела
--   'forced' — вынужденный вывод оператором (возврат бюджета) = искусственно
-- Для аналитики «зелёного коридора» forced-смерти НЕ учитывать как порог.
-- ============================================================

alter table phones add column if not exists death_reason text;

-- Триггер 💀 long → проставляем причину 'error'
create or replace function handle_long_result()
returns trigger language plpgsql as $$
begin
  if new.result = 'long' then
    update phones
       set status            = 'dead',
           died_at           = new.purchased_at,
           death_purchase_id = new.id,
           death_reason      = 'error',
           updated_at        = now()
     where id = new.phone_id
       and status = 'active';
  end if;
  return new;
end;
$$;
