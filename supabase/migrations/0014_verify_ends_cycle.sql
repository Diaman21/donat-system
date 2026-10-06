-- 0014: 🔐 verify («проверка данных») завершает цикл телефона
--
-- КОНТЕКСТ. Миграция 0013 добавила результат verify. В тот же день владелец
-- уточнил последствия: после такой проверки телефон ВЫКАТЫВАЮТ и бюджет
-- возвращают — то есть по исходу это конец цикла, как 💀, а не отлёжка, как ⚠️.
--
-- ПОЧЕМУ СВОЯ ПРИЧИНА, а не 'error' и не 'forced':
--   'error'  — 💀 waiver «vierzehn Tagen», точка коридора. Смешать — значит
--              подложить в расклад «интервал × сумма» событие другой природы.
--   'forced' — вывод ПО РЕШЕНИЮ оператора, искусственный, из коридора исключён.
--              А здесь решение принял Apple — событие настоящее, его надо изучать.
-- Поэтому 'verify': отдельная причина, отдельная статистика. Объединять с
-- 'error' или нет — решим, когда наберутся данные (на 06.10.2026 случай один).
--
-- ЧТО ДЕЛАЕТ. Та же функция handle_long_result, что и раньше (имя оставлено,
-- чтобы не пересоздавать триггер), но теперь различает два результата:
--   long   → status 'dead', death_reason 'error'   (как было)
--   verify → status 'dead', death_reason 'verify'  (новое)
-- died_at и death_purchase_id проставляются одинаково — post-mortem и откат
-- последней записи («↩️» с воскрешением) работают по ним для обоих случаев.
--
-- Старое поведение для long не меняется ни в одной детали.

create or replace function handle_long_result()
returns trigger language plpgsql as $$
begin
  if new.result in ('long', 'verify') then
    update phones
       set status            = 'dead',
           died_at           = new.purchased_at,
           death_purchase_id = new.id,
           death_reason      = case new.result when 'long' then 'error' else 'verify' end,
           updated_at        = now()
     where id = new.phone_id
       and status = 'active';
  end if;
  return new;
end;
$$;
