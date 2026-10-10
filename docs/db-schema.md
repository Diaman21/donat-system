# Схема БД — donat-system

> Исходники: [`supabase/migrations/`](../supabase/migrations/) — файлы `0001`…`0017`.
> Применены в **Neon** (serverless Postgres, EU Central, бесплатный план) **вручную**:
> сначала через Neon SQL Editor, а с тех пор как панель Neon у владельца заблокирована
> (09.09.2026) — через `DATABASE_URL`, каждая миграция только после отдельного «да» владельца.
> Зеркало схемы в коде — [`bot/src/db/schema.ts`](../bot/src/db/schema.ts) (только типы и запросы).

## Миграции

| Файл | Что добавил |
|---|---|
| `0001_init.sql` | начальная схема: `users`, `purchase_categories`, `phones`, `orders`, `purchases`, триггеры, RLS |
| `0002_add_purchase_game.sql` | `purchases.game` — игра (Massive / Furious / своя) |
| `0003_bot_sessions.sql` | `bot_sessions` — хранилище grammy-сессий (нужно для serverless) |
| `0004_phone_death_reason.sql` | `phones.death_reason` — `'error'` / `'forced'` |
| `0005_purchase_internet.sql` | `purchases.internet` — `'mobile'` / `'wifi'` |
| `0006_vk_units.sql` | `purchases.units` — количество единиц (для ВК — голоса) |
| `0007_phone_prepared.sql` | значение `prepared` в enum `phone_status` |
| `0008_order_queue.sql` | `order_queue` — простой список заказов команды |
| `0009_purchase_order_link.sql` | `purchases.order_queue_id` — связь покупки с заказом |
| `0010_order_items.sql` | `order_queue.items` — состав заказа (сколько закупок нужно) |
| `0011_drop_legacy_orders.sql` | **удалены** таблица `orders`, `purchases.order_id`, enum `order_status` |
| `0012_bot_sessions_rls.sql` | RLS на `bot_sessions` (забыли в `0003`) — применена 12.09 |
| `0013_purchase_result_verify.sql` | результат 🔐 `verify` («проверка данных») — применена 06.10 |
| `0014_verify_ends_cycle.sql` | триггер: `verify` → телефон `dead`, `death_reason='verify'` — применена 06.10 |
| `0015_purchase_idem_key.sql` | `purchases.idem_key` + уникальный индекс — защита от дубля покупки — применена 07.10 |
| `0016_advice_log.sql` | `advice_log` — журнал подсказок (что бот сказал после покупки) — применена 08.10 |
| `0017_card_ledger.sql` | `card_ledger` — журнал карты: сумма на карте руками и поправки возвратов — применена 10.10 |

**Никогда не редактируем уже применённую миграцию** — только новый файл `000N_*.sql`.

## ER-диаграмма

```mermaid
erDiagram
    users ||--o{ purchases : "operator делает"
    users ||--o{ phones : "operator владеет"
    purchase_categories ||--o{ purchases : "категория"
    phones ||--o{ purchases : "телефон делает покупки"
    phones }o--|| purchases : "death_purchase_id"

    users {
        uuid id PK
        bigint telegram_id UK
        text username
        text full_name
        enum role "customer / operator / moderator"
        bool is_active
    }

    purchase_categories {
        uuid id PK
        text code UK "game_donate, vk_votes"
        text name
        jsonb denominations "быстрые кнопки сумм"
        jsonb warmup_config "гипотеза разогрева"
        bool is_active
    }

    phones {
        uuid id PK
        text imei_last4 "4 цифры"
        text label "цвет + модель"
        enum status "active / dead / prepared"
        uuid operator_id FK
        timestamptz connected_at
        timestamptz died_at
        text death_reason "error / verify / forced"
        uuid death_purchase_id FK "циклическая ссылка"
        text notes
    }

    purchases {
        uuid id PK
        uuid phone_id FK
        uuid order_queue_id FK "заказ, если делали по нему"
        uuid operator_id FK
        uuid category_id FK
        numeric amount "€"
        enum result "done / support / long / verify"
        text game "Massive / Furious / своя"
        text internet "mobile / wifi"
        int units "голоса ВК"
        timestamptz purchased_at
        text notes
    }

    bot_sessions {
        text key PK
        jsonb value
        timestamptz updated_at
    }

    advice_log {
        bigserial id PK
        uuid purchase_id FK "cascade при ↩️"
        uuid phone_id FK
        jsonb anomalies "[{code, severity}]"
        timestamptz next_small_at "с какого часа €30"
        timestamptz next_big_at "с какого часа €100"
        text rules "версия правил"
    }

    card_ledger {
        bigserial id PK
        text kind "balance / refund"
        numeric amount_eur "€, не меньше 0"
        uuid phone_id FK "только у refund, одна на телефон"
        timestamptz effective_at "когда сумма действует"
        uuid created_by FK
    }

    order_queue {
        uuid id PK
        bigserial num UK "номер #37 для людей"
        text text "заказ как скинули"
        jsonb items "состав: сколько закупок нужно"
        text status "open / done / cancelled"
        uuid created_by FK
        uuid done_by FK
        timestamptz done_at
    }
```

> Рабочих таблиц **восемь** (08.10.2026 — журнал подсказок `advice_log`, 10.10.2026 — журнал карты `card_ledger`). Старая `orders` (наследие модели «доска заказов»,
> от которой отказались) и колонка `purchases.order_id` **удалены** миграцией `0011`
> — они стояли пустыми, а две «заказные» колонки на `purchases` сбивали с толку.
> Заказы живут в `order_queue`, связь с покупкой — `purchases.order_queue_id`.

## Перечисления (enums)

| Enum | Значения | Где |
|---|---|---|
| `user_role` | `customer`, `operator`, `moderator` | `users.role` |
| `phone_status` | `active`, `dead`, `prepared` | `phones.status` (`prepared` — резерв, не в лимите ≤3; миграция `0007`) |
| `purchase_result` | `done` ✅, `support` ⚠️, `long` 💀, `verify` 🔐 | `purchases.result` |

> Enum `order_status` удалён вместе с таблицей `orders` (миграция `0011`).
> У `order_queue.status` тип обычный `text` — отдельный enum ему не нужен.

## Таблицы

### `users` — участники бота

| Поле | Тип | Назначение |
|---|---|---|
| `telegram_id` | `bigint` UNIQUE | id из Telegram — единственная идентификация |
| `username`, `full_name` | `text` | из профиля TG |
| `role` | `user_role` | по умолчанию `customer` = без доступа |
| `is_active` | `bool` | блокировка без удаления |

### `purchase_categories` — типы закупок

| Поле | Тип | Назначение |
|---|---|---|
| `code` | `text` UNIQUE | `game_donate`, `vk_votes` |
| `denominations` | `jsonb` | быстрые кнопки: `[30, 100]` (игры) или `[{units,price}]` (ВК) |
| `warmup_config` | `jsonb` | гипотеза разогрева — **правится без миграций** |

**Текущие значения:**
- `game_donate`: `[30, 100]`. Кнопка **€2 добавляется в коде только для игры Massive**
  (разогрев ведём исключительно через неё). Остальное — «✏️ Другая сумма» текстом.
- `vk_votes`: `[{10,0.99},{18,1.99},{28,2.99},{40,3.99}]` — голоса · €.

Правка методик: `npx tsx src/db/set-warmup.ts` (тексты в коде утилиты).

### `phones` — рабочие телефоны

| Поле | Тип | Назначение |
|---|---|---|
| `imei_last4` | `text` CHECK `^\d{4}$` | 4 цифры IMEI |
| `label` | `text` | метка вида «Чёрный 16 про» — **модель важна для аналитики** |
| `status` | `phone_status` | `active` / `dead` / `prepared` |
| `connected_at` | `timestamptz` | когда введён в работу (для `prepared` — момент перевода) |
| `died_at` | `timestamptz` | когда умер |
| `death_reason` | `text` | `'error'` (ошибка Apple = достиг предела) / `'verify'` (проверка данных Apple) / `'forced'` (вывод бюджета) |
| `death_purchase_id` | `uuid` → `purchases.id` | какая покупка убила (для post-mortem) |

**Бизнес-правила (триггеры):**
- ≤3 активных одновременно — `enforce_max_active_phones` (`prepared` не в лимите)
- IMEI уникален только среди активных — частичный unique index `phones_active_imei_unique`
- 💀 `long` → статус `dead`, `died_at`, `death_purchase_id`, `death_reason='error'` — `handle_long_result`
- 🔐 `verify` → то же самое, но `death_reason='verify'` (миграция `0014`, та же функция)

> ⚠️ **`forced` исключать из расчёта порогов** — это искусственные смерти (возврат бюджета,
> блокировка), они не отражают предел телефона.

### `purchases` — ядро базы знаний

Каждая строка — одна транзакция Apple Pay. Главная таблица для поиска коридора.

| Поле | Тип | Назначение |
|---|---|---|
| `phone_id` | `uuid` → `phones.id` | с какого телефона |
| `order_queue_id` | `uuid` nullable → `order_queue.id` | заказ, по которому сделана (миграция `0009`); NULL у разогрева и ВК |
| `idem_key` | `text` nullable, **unique** | ключ идемпотентности `<ключ потока>:<номер строки>` (миграция `0015`); NULL у покупок до 07.10.2026 |
| `operator_id` | `uuid` → `users.id` | кто вбил |
| `category_id` | `uuid` → `purchase_categories.id` | 🎮 танки / 🗳 ВК |
| `amount` | `numeric(12,2)` CHECK > 0 | **сумма в €** |
| `result` | `purchase_result` | ✅ `done` / ⚠️ `support` / 💀 `long` / 🔐 `verify` |
| `game` | `text` nullable | Massive / Furious / своя (миграция `0002`) |
| `internet` | `text` nullable | `'mobile'` / `'wifi'` (миграция `0005`) |
| `units` | `integer` nullable | голоса ВК (миграция `0006`) |
| `purchased_at` | `timestamptz` | **время записи = время покупки** — вбивать сразу! |
| `notes` | `text` | заметка оператора |

**Индексы:** `(phone_id, purchased_at)`, `(result)`, `(category_id)`.
Индекс по `order_id` удалён вместе с колонкой (миграция `0011`).

> ⚠️ **Тонкости для аналитики:**
> 1. Строка 💀 `long` — это **попытка**, а не оплата: её `amount` телефон по факту не потратил
>    (waiver-окно всплыло вместо списания). При подсчёте «€ извлечено» вычитать её.
> 2. Строки ВК-мультизакупа получают **одинаковое** `purchased_at` — при анализе интервалов
>    считать серию одним событием.

### `order_queue` — список заказов команды (миграция `0008`)

Внутренний список задач для двух операторов: скинул текст заказа → отметил
выполненным или отменённым. Это НЕ доска заказчиков — от неё отказались
осознанно (см. анти-цели в `TODO.md`).

| Поле | Тип | Назначение |
|---|---|---|
| `num` | `bigserial` UNIQUE | человеческий номер — «Заказ #37» |
| `text` | `text` | заказ как скинули, свободный текст |
| `items` | `jsonb` | состав заказа (миграция `0010`), NULL = ещё не подтверждён |
| `status` | `text` CHECK | `open` / `done` / `cancelled` |
| `created_by` | `uuid` → `users.id` | кто добавил |
| `done_by` / `done_at` | `uuid` / `timestamptz` | кто и когда закрыл |

**Состав заказа** (`items`, миграция `0010`) — сколько закупок требует заказ:

```json
{ "total": 2, "list": [ {"label":"орден","amount":30,"game":"Furious"},
                        {"label":"прем год","amount":105,"game":"Furious"} ] }
```

Бот распознаёт состав из текста (`bot/src/handlers/order-parse.ts`), оператор
подтверждает кнопкой. Заказ закрывается, только когда успешных закупок ≥ `total`.
Если состав задавали вручную числом, `list` пуст, а `total` заполнен.
⚠️ `bigserial` не откатывается — в нумерации заказов бывают пропуски, это нормально.

**Связь с покупками** (миграция `0009`): `purchases.order_queue_id` → `order_queue.id`,
nullable. Заполняется, когда закупку делают через «📥 Заказы → ✅ Выполнить».
Покупки без заказа (разогрев €2, ВК) остаются с NULL — их большинство.

> ⚠️ На аналитику «зелёного коридора» связь не влияет: в её запросах эта колонка
> не участвует. Опасение было про лишний шаг в флоу закупки — его нет, потому что
> идём от заказа и контекст уже известен.

Новый заказ автоматически постится в группу с тегами операторов/модераторов
(в группе `@упоминание` даёт персональный пинг, в канале — нет).

### `bot_sessions` — состояние пошагового ввода

Хранилище grammy-сессий. Нужно, потому что Vercel serverless не держит память между
запросами. `key` — идентификатор чата, `value` — JSON состояния мастер-формы.

### `advice_log` — журнал подсказок (миграция `0016`, 08.10.2026)

Одна строка на запись танковой покупки (на последнюю строку мультизакупа): что бот
сказал оператору. Нужен, чтобы проверять, точны ли подсказки и следуют ли им
(`/learn`, раздел 6). Тексты не храним — только факты.

| Колонка | Тип | Смысл |
|---|---|---|
| `purchase_id` | `uuid` → `purchases.id`, **unique**, `on delete cascade` | по какой покупке; ↩️ удаление покупки забирает и запись журнала |
| `phone_id` | `uuid` → `phones.id` | телефон |
| `anomalies` | `jsonb` | названные отклонения `[{code, severity}]`; коды — `AnomalyCode` в `anomaly.ts`, **не переименовывать** |
| `next_small_at` / `next_big_at` | `timestamptz` | с какого момента по правилам можно €30 / €100 (`allowedAt`); NULL после 💀/🔐 |
| `rules` | `text` | версия правил (дата последней фиксации, `RULES_VERSION` в `zones.ts`) |

Пишется после вставки покупки; сбой журнала идёт только в лог и запись покупки не ломает.

### `card_ledger` — журнал карты (миграция `0017`, 10.10.2026)

Бюджет на карте. **Баланс в таблице не хранится — он вычисляется** (`card-calc.ts`):

> на карте = последняя `balance` − ✅ покупки с `created_at` после неё + возвраты,
> срок которых наступил после неё и уже прошёл.

Возврат при выкате по умолчанию считается сам: **все ✅ телефона, через 48 ч после
`died_at`** (любая причина — 💀, 🔐, ☠️). Строка `refund` нужна только для поправки.
Счётчика «−€100 за покупку» нет намеренно: ↩️ удаление покупки, повторная доставка
апдейта и правка задним числом его бы сбили, а вычисленный баланс остаётся верным.

| Колонка | Тип | Смысл |
|---|---|---|
| `kind` | `text` CHECK | `balance` — сумма на карте, вписанная руками (история копится); `refund` — поправка возврата |
| `amount_eur` | `numeric(12,2)` CHECK ≥ 0 | сумма в € |
| `phone_id` | `uuid` → `phones.id` | только у `refund` (CHECK), **одна поправка на телефон** (частичный unique-индекс) |
| `effective_at` | `timestamptz` | `balance` — момент правки; `refund` — когда деньги считаются пришедшими |
| `created_by` | `uuid` → `users.id` | кто вписал |

Тонкости:
- При вписывании суммы бот спрашивает про возвраты в пути. «Уже на карте» → поправка
  с `effective_at` **за секунду до** суммы — тогда возврат не прибавится второй раз.
- Поправка действует, только если `effective_at >= phones.died_at`: телефон «воскресили»
  через ↩️, а потом он умер снова — старая поправка не подхватится.
- Поправка — `insert … on conflict (phone_id) where kind = 'refund' do update`.

## RLS (Row Level Security)

**Состояние на 12.09.2026:** RLS включён на **всех** рабочих таблицах (с 10.10.2026 их восемь),
**политик нет ни у одной**. На `bot_sessions` его забыли в миграции `0003` —
аудит это нашёл, исправлено миграцией `0012` (применена, данные не затронуты,
запись и чтение сессий проверены после включения).

⚠️ **Сегодня RLS не защищает ничего, и это нормально.** Бот подключается к Neon
напрямую по `DATABASE_URL` как `neondb_owner`, у которого `rolbypassrls = true` —
он обходит RLS в любом случае. Других ролей в базе нет, снаружи никто не
подключается. Данные защищает **секретность `DATABASE_URL`**, а не RLS.

Смысл RLS появится на этапе веб-фронта (`web/`): там заведём отдельную роль
без `bypassrls` и напишем политики. Вот тогда таблица, забытая без RLS, стала бы
единственной открытой — поэтому несогласованность чиним заранее, а не потом.

## Полезные запросы

### Что телефон реально извлёк (минус убившая попытка)
```sql
select ph.imei_last4, ph.label, ph.status, ph.death_reason,
       count(p.id) as txns,
       sum(p.amount) - coalesce(
         (select p2.amount from purchases p2 where p2.id = ph.death_purchase_id
          and ph.death_reason = 'error'), 0) as eur_real,
       extract(epoch from (coalesce(ph.died_at, now()) - min(p.purchased_at)))/86400 as days
  from phones ph join purchases p on p.phone_id = ph.id
 group by ph.id
 order by eur_real desc;
```

### Темп закупок и судьба (главная закономерность)
```sql
select ph.imei_last4,
       round(count(p.id) / greatest(extract(epoch from
         (coalesce(ph.died_at, now()) - min(p.purchased_at)))/86400, 0.5), 2) as per_day,
       sum(p.amount) as eur, ph.death_reason
  from phones ph join purchases p on p.phone_id = ph.id
 group by ph.id order by per_day;
```

### Смертность по типу интернета (только танки)
```sql
select p.internet, p.result, count(*)
  from purchases p join purchase_categories c on c.id = p.category_id
 where c.code = 'game_donate' and p.amount = 100
 group by p.internet, p.result;
```

### ВК: голосов в день по телефону
```sql
select ph.imei_last4, (p.purchased_at at time zone 'Europe/Moscow')::date as d,
       count(*) as txns, sum(p.units) as votes
  from purchases p join phones ph on ph.id = p.phone_id
  join purchase_categories c on c.id = p.category_id
 where c.code = 'vk_votes'
 group by ph.imei_last4, d order by d;
```

## Бэкап и восстановление

**Ежедневно в 12:05 МСК** (`api/cron-export.ts`, Vercel Cron) в группу «Pattern_analyst 🧮»
падают два файла — история чата и есть наш архив:

| Файл | Что внутри | Зачем |
|---|---|---|
| `backup-full-ГГГГ-ММ-ДД.json` | сырые строки `users`, `purchase_categories`, `phones`, `purchases`, `order_queue`, `advice_log` (с 08.10), `card_ledger` (с 10.10) | **полное восстановление** базы один в один |
| `purchases-ГГГГ-ММ-ДД.csv` | покупки в плоском виде | удобно открыть в Excel |

> ⚠️ **Почему JSON, а не только CSV.** В CSV телефон записан лишь 4 цифрами IMEI —
> они повторяются у разных аппаратов, и в нём НЕТ метки телефона (модели),
> `death_reason` (error/verify/forced), дат жизни и `warmup_config`. Без этого анализ
> «зелёного коридора» после восстановления не собрать. JSON содержит `phone_id` —
> точную привязку покупок к аппаратам.

`bot_sessions` не бэкапим — это временное состояние ввода, ценности нет.

> ⚠️ **Дампы, снятые ДО 12.09.2026**, содержат у `purchases` лишнюю колонку
> `order_id` — наследие таблицы `orders`, удалённой миграцией `0011`. Во всех
> строках там `NULL`, данных в ней нет: при восстановлении старого дампа эту
> колонку нужно просто отбросить, иначе вставка упадёт на несуществующем поле.

### Как восстановить из JSON — СКРИПТОМ, не руками

> ⚠️ **До 07.10.2026 здесь была ручная инструкция, и она бы НЕ сработала.**
> Учебный прогон нашёл три ошибки: покупки вставлялись раньше заказов (а у
> покупки внешний ключ на заказ, миграция `0009`); миграция `0001` сама создаёт
> категории со случайными id, и покупки сослались бы в пустоту; второй проход
> по `death_purchase_id` перетирал `updated_at` у умерших телефонов. Теперь всё
> это в коде — `bot/src/db/restore-core.ts` — и проверяется тестом на каждый
> push (`restore.test.ts`: все миграции → чистый Postgres в памяти → бэкап со
> всеми трудными случаями → проверка → туда-обратно один в один).

**Учебный прогон** (боевую базу только читает, ничего не пишет):
```bash
cd bot && npm run restore-drill
```
Собирает бэкап тем же кодом, что крон в 12:05, разворачивает его в Postgres
в памяти (PGlite, ставить ничего не нужно) и сверяет отпечатки всех таблиц
с боевой базой. **Последний прогон 10.10.2026: 🟢 один в один** — 17 миграций,
users 2 · категории 2 · заказы 43 · телефоны 48 · покупки 581 · журнал 8 · карта 0, за 3.5 с.
Первый прогон — 07.10.2026 (тогда и нашлись три ошибки ручной инструкции). Проверить конкретный файл
из группы: `npm run restore-drill -- путь/к/backup-full-ГГГГ-ММ-ДД.json`.

**Аварийное восстановление в настоящую базу:**
1. Создать пустую базу (новый проект Neon или любой Postgres 15+).
2. Применить миграции `0001`…последняя по порядку.
3. Взять последний `backup-full-*.json` из группы.
4. `RESTORE_TARGET_URL=postgres://… npm run restore-drill -- файл.json` —
   скрипт откажется писать в непустую базу и в боевую (`DATABASE_URL`).
   Всё восстановление — одна транзакция: упало посередине → база осталась пустой.
5. Прописать новую строку подключения в `DATABASE_URL` на Vercel и в `.env`.

Порядок вставки внутри скрипта: `users` → `purchase_categories` (сид из `0001`
заменяется) → `order_queue` → `phones` (без `death_purchase_id`) → `purchases`
→ `advice_log` → `card_ledger` → второй проход `death_purchase_id` (триггер `updated_at`
на это время выключен) → `setval` счётчиков заказов, журнала подсказок и журнала карты. Старые дампы с лишней
колонкой `purchases.order_id` и дампы без новых колонок (`idem_key`)
восстанавливаются без правки: лишние ключи отбрасываются, недостающие колонки
получают значение по умолчанию.

> 💡 У Neon есть своё восстановление на момент времени, но на бесплатном плане
> оно хранит **только 6 часов** (документация Neon, проверено 07.10.2026), а
> панель Neon у владельца заблокирована. Заметили порчу позже — Neon не поможет.
> Бэкап в Telegram от Neon не зависит — это **главная** страховка, и с
> 07.10.2026 она проверена настоящим восстановлением.

## Подключение

| Переменная | Когда использовать |
|---|---|
| `DATABASE_URL` (pooler) | бот и все запросы приложения |
| `DATABASE_URL_DIRECT` (direct) | DDL-операции, если понадобятся |

Строки подключения — в локальном `.env` (не в git) и в env-переменных Vercel.
Шаблон — `.env.example`.

> ⚠️ Neon free — **scale-to-zero**: БД засыпает через ~5 минут простоя, просыпается 1–2 с.
> В SQL Editor первый `Run` после сна может дать «Failed to connect» — просто повторить.
