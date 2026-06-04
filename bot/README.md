# Telegram-бот donat-system

**Логгер закупок.** Оператор в личке вбивает каждую закупку (телефон + игра +
сумма $ + результат) → данные копятся в БД для поиска «зелёного коридора».
Бот не ведёт заказы и не общается с заказчиками — только сбор и (далее) аналитика.

## Что умеет (MVP)

- `/start` — регистрация; роль по умолчанию `customer` (без доступа), модератор
  выдаёт `operator`/`moderator` через `src/db/set-role.ts`
- `➕ Телефон` — привязать телефон (4 цифры IMEI + метка), ≤3 активных
- `➕ Закупка` — пошагово: телефон → игра (`/skip`) → сумма $ → результат (✅/⚠️/💀)
- `📱 Телефоны` — список активных с накопленной суммой $ и числом покупок

При результате 💀 телефон автоматически уходит в `dead` (триггер БД).

## Стек

- **grammY** (+ session) — фреймворк Telegram-бота
- **Drizzle ORM** + **postgres.js** — доступ к БД (Neon)
- **tsx** — запуск TypeScript без сборки

## Переменные окружения

Берутся из `.env` в **корне репозитория** (на уровень выше `bot/`).
Шаблон — `../.env.example`. Нужны:

- `DATABASE_URL` — connection string Neon (pooler)
- `TELEGRAM_BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather)

## Команды

```bash
npm install                       # установить зависимости
npm run db:check                  # проверить подключение к Neon (не требует токен)
npm run dev                       # запустить бота с авто-перезапуском (watch)
npm start                         # запустить бота
npm run typecheck                 # проверка типов (tsc --noEmit)

# Утилиты администрирования (через npx tsx):
npx tsx src/db/users-list.ts                       # список пользователей
npx tsx src/db/set-role.ts <telegram_id> <role>    # назначить роль
```

## Структура

```
bot/
├── src/
│   ├── index.ts            точка входа (long polling, graceful shutdown)
│   ├── bot.ts              сборка бота: session, роутинг (hears/callback/text)
│   ├── config.ts           чтение и валидация .env
│   ├── context.ts          контекст: session (flow) + ctx.dbUser
│   ├── db/
│   │   ├── client.ts       подключение к Neon (drizzle + postgres.js)
│   │   ├── schema.ts       Drizzle-схема (зеркало миграций)
│   │   ├── check.ts        проверка подключения
│   │   ├── users-list.ts   список пользователей
│   │   └── set-role.ts     назначить роль пользователю
│   ├── middlewares/
│   │   └── auth.ts         loadUser — подгрузка пользователя по telegram_id
│   └── handlers/
│       ├── start.ts        /start — регистрация, гейт доступа, requireOperator
│       ├── menus.ts        меню оператора/модератора
│       ├── phones.ts       привязка и список телефонов
│       └── purchase.ts     пошаговый ввод закупки
```

## Деплой на Vercel (webhook, 24/7)

Бот хостится на **Vercel** (serverless, webhook) — работает без локального компа.

- Точка входа: `api/webhook.ts` (`webhookCallback(bot, 'https', { secretToken })`).
- Состояние ввода — в Neon (`bot_sessions`), т.к. serverless не хранит память.
- Конфиг: `vercel.json` (явно прописана функция `api/webhook`).
- **Vercel:** Root Directory = `bot`, Framework = Other. Env vars:
  `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_ID`, `TELEGRAM_WEBHOOK_SECRET`.
- Регистрация webhook после деплоя:
  `npx tsx src/setup-webhook.ts https://<project>.vercel.app/api/webhook`

⚠️ **Нюансы serverless (ESM):**
- Все относительные импорты — с расширением `.js` (нативный Node ESM на Vercel).
- Адаптер `webhookCallback` — `'https'` (для Vercel Node-runtime), не `'http'`.

⚠️ **Не запускай `npm start` локально, пока бот на Vercel** — `index.ts`
снимает webhook (`deleteWebhook`) и переводит бота на long polling.
Чтобы вернуть на Vercel — заново `setup-webhook`.

## Важно про схему БД

`src/db/schema.ts` — **отражение** реальной схемы (`supabase/migrations/*.sql`),
применённой вручную в Neon. Мы **не** генерируем миграции из Drizzle.
При изменении SQL-схемы обновляй `schema.ts` руками в соответствие.
