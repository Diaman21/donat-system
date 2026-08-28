# Telegram-бот donat-system

**Логгер закупок.** Оператор в личке вбивает каждую закупку (телефон + категория +
игра + сумма € + результат + интернет) → данные копятся в БД для поиска
«зелёного коридора». Бот не ведёт заказы и не общается с заказчиками — только
сбор данных и аналитика на просмотр.

> Карта проекта и выводы по данным — [`../CLAUDE.md`](../CLAUDE.md).
> Схема БД — [`../docs/db-schema.md`](../docs/db-schema.md).

## Что умеет

**Меню (личка):**

| Кнопка | Действие |
|---|---|
| 🛒 Закупка | телефон → категория → игра → сумма → результат → заметка → подтверждение → интернет (записывает) |
| ➕📱 Телефон | привязка: 4 цифры IMEI → метка → «▶️ В работу» или «🧰 В подготовленные» |
| ☎️ Телефоны | активные со статистикой; 📜 история и ☠️ вынужденный вывод |
| 🧰 Подготовленные | резерв (вне лимита ≤3); ▶️ в работу, 🗑 удалить |
| 🔍 Поиск по IMEI | 4 цифры → была ли трубка в работе, метка, статус, итоги (все совпадения) |
| 📊 Статистика | сводка с периодами (сутки / неделя / всё) |
| 🗳 ВК | голосов по дням на каждом телефоне (read-only) |
| 📋 Последние | последние 10 закупок |
| 📅 Отчёт | проводник: период → дни → телефоны дня → таймлайн |
| ❌ Удалить последнюю | откат своей последней записи (💀 → телефон воскресает) |

Кнопки меню матчатся **по слову** (`/Закупка$/`), не по эмодзи — иконки можно менять,
роутинг не сломается, старые закешированные клавиатуры продолжают работать.

**Команды:** `/start` `/stats` `/vk` `/period` `/phones` `/find` `/recent` `/history`
`/report` `/export` `/help` `/cancel`.

**Особенности ввода:**
- Игры: Massive / Furious / «✏️ Другая игра» текстом.
- Суммы танков: €30 / €100 / «✏️ Другая сумма»; **кнопка €2 только для Massive**.
- **ВК-мультизакуп:** счётчик 🔻/🔺 — N одинаковых покупок за раз. При ⚠️/💀 серия
  разбивается автоматически: (N−1)×✅ + 1 ошибка (ошибка всегда у последней попытки).
- В подтверждении видны счётчики: «сегодня на телефоне» и «всего на телефоне».
- При 💀 телефон автоматически уходит в `dead` (триггер БД) + показывается post-mortem.

**В группе** бот реагирует только на команды и inline-кнопки; ввод — только в личке.

## Автоматика (Vercel Cron)

| Задача | Расписание | Что делает |
|---|---|---|
| `api/cron-report.ts` | ежедневно 12:00 МСК | сводка за сутки в группу |
| `api/cron-export.ts` | пн 12:05 МСК | CSV-бэкап всех покупок в группу |

⚠️ Лимит Vercel Hobby — **2 cron-задачи, обе заняты**.

В сводку встроен громкий блок **«‼️ ВЫВОД БЮДЖЕТА»** с пингом операторов/модераторов:
бюджет выводится на 14-й день после первой покупки, предупреждение идёт с 12-го
(🟠 12 → 🔴 13 «завтра» → 🔴🔴 14+ «просрочено»). Блок появляется только при наличии
таких телефонов.

## Стек

- **grammY** (+ session) — фреймворк Telegram-бота
- **Drizzle ORM** + **postgres.js** — доступ к Neon
- **tsx** — запуск TypeScript без сборки

## Переменные окружения

Берутся из `.env` в **корне репозитория** (на уровень выше `bot/`), шаблон — `../.env.example`.
Те же переменные заведены в Vercel (Production).

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | connection string Neon (pooler) |
| `TELEGRAM_BOT_TOKEN` | токен от [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_GROUP_ID` | группа «Pattern_analyst 🧮» для сводок и бэкапов |
| `TELEGRAM_WEBHOOK_SECRET` | защита webhook-эндпоинта |
| `TELEGRAM_MODERATOR_CHAT_ID` | куда слать уведомления об ошибках |
| `CRON_SECRET` | защита cron-эндпоинтов (Vercel шлёт в `Authorization`) |

## Команды

```bash
npm install                       # установить зависимости
npm run typecheck                 # проверка типов (tsc --noEmit) — гоняем перед коммитом
npm run db:check                  # проверить подключение к Neon
npm run dev                       # long polling с авто-перезапуском
npm start                         # long polling
```

Утилиты администрирования (через `npx tsx`):

```bash
npx tsx src/db/users-list.ts                       # список пользователей
npx tsx src/db/set-role.ts <telegram_id> <role>    # назначить роль
npx tsx src/db/set-warmup.ts                       # обновить warmup_config категорий
npx tsx src/db/reset-data.ts --yes                 # ⚠️ снести ВСЕ покупки и телефоны
npx tsx src/setup-webhook.ts <url>/api/webhook     # зарегистрировать webhook + меню команд
```

## Структура

```
bot/
├── api/
│   ├── webhook.ts          точка входа Vercel (webhookCallback 'https')
│   ├── cron-report.ts      ежедневная сводка в группу
│   └── cron-export.ts      еженедельный CSV-бэкап
├── vercel.json             builds + routes + crons (явно, автодетект не работает)
└── src/
    ├── index.ts            локальный запуск (long polling, снимает webhook!)
    ├── bot.ts              сборка бота: session, роутинг (hears/callback/text)
    ├── commands.ts         список команд для меню Telegram
    ├── config.ts           чтение и валидация .env
    ├── context.ts          FlowState (мастер-формы) + ctx.dbUser
    ├── format.ts           время по МСК
    ├── notify.ts           уведомления модератору
    ├── setup-webhook.ts    регистрация webhook и команд
    ├── db/
    │   ├── client.ts       подключение к Neon (drizzle + postgres.js)
    │   ├── schema.ts       Drizzle-схема (зеркало миграций)
    │   ├── session-store.ts  хранилище сессий в БД (для serverless)
    │   ├── check.ts · set-role.ts · users-list.ts · set-warmup.ts · reset-data.ts
    ├── middlewares/
    │   └── auth.ts         loadUser — подгрузка пользователя по telegram_id
    └── handlers/
        ├── start.ts        /start, гейт доступа (requireOperator/requireModerator)
        ├── menus.ts        BTN — метки кнопок главного меню
        ├── common.ts       отмена, requirePrivate
        ├── phones.ts       привязка, список, подготовленные, вывод
        ├── purchase.ts     пошаговый ввод закупки (+ ВК-мультизакуп)
        ├── stats.ts        /stats + алерт вывода бюджета + сводка в группу
        ├── vk.ts           /vk — голоса по дням
        ├── report.ts       /period — отчёт-проводник по датам
        ├── history.ts      /history — таймлайн телефона
        ├── recent.ts       /recent + откат последней
        ├── postmortem.ts   «надгробие» при смерти телефона
        ├── export.ts       CSV (buildPurchasesCsv — общий с cron-бэкапом)
        └── help.ts         /help
```

## Деплой на Vercel (webhook, 24/7)

Push в `main` → Vercel авто-передеплой. **Root Directory = `bot`**, Framework = Other.
После добавления новых команд — заново `setup-webhook`, чтобы обновилось меню.

⚠️ **Засады serverless (проверено на граблях):**
1. **ESM:** все относительные импорты — с расширением `.js`. Локально `tsx` прощает,
   Vercel — нет (`ERR_MODULE_NOT_FOUND`).
2. **Адаптер:** `webhookCallback(bot, 'https', { secretToken })` — именно `'https'`
   для Vercel Node-runtime, иначе `FUNCTION_INVOCATION_FAILED`.
3. **vercel.json:** функции прописаны явно (`builds` + `routes`) — автодетект `api/` не сработал.
4. **Сессии в БД** (`bot_sessions`), т.к. serverless не хранит память между запросами.
5. **Не запускать `npm start` локально, пока бот на Vercel** — `index.ts` делает
   `deleteWebhook` и переводит бота на long polling. Вернуть: `setup-webhook`.
6. **Neon scale-to-zero:** засыпает через ~5 мин, просыпается 1–2 с — первый запрос может подтормозить.

## Важно про схему БД

`src/db/schema.ts` — **отражение** реальной схемы (`../supabase/migrations/*.sql`),
применённой вручную в Neon. Мы **не** генерируем миграции из Drizzle.
При изменении SQL-схемы обновляй `schema.ts` руками в соответствие.
