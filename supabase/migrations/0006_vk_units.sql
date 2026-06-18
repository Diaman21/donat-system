-- ============================================================
-- Donat System — миграция 0006
-- Количество единиц при закупке (для ВК — голоса) + правильные
-- номиналы ВК. Все суммы в проекте — в евро (€).
-- ============================================================

alter table purchases add column if not exists units integer;

-- Реальные номиналы ВК-голосов (цена в €)
update purchase_categories
   set denominations = '[
     {"units": 10, "price": 0.99},
     {"units": 18, "price": 1.99},
     {"units": 28, "price": 2.99},
     {"units": 40, "price": 3.99}
   ]'::jsonb
 where code = 'vk_votes';
