# Telegram-бот donat-system

Оперативная работа всех ролей: заказчик, оператор, модератор.

## Стек

- **grammY** — фреймворк Telegram-бота
- **Drizzle ORM** + **postgres.js** — доступ к БД (Neon)
- **tsx** — запуск TypeScript без сборки

## Переменные окружения

Берутся из `.env` в **корне репозитория** (на уровень выше `bot/`).
Шаблон — `../.env.example`. Нужны:

- `DATABASE_URL` — connection string Neon (pooler)
- `TELEGRAM_BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather)

## Команды

```bash
npm install        # установить зависимости
npm run db:check   # проверить подключение к Neon (не требует токен)
npm run dev        # запустить бота с авто-перезапуском (watch)
npm start          # запустить бота
npm run typecheck  # проверка типов (tsc --noEmit)
```

## Структура

```
bot/
├── src/
│   ├── index.ts            точка входа (long polling, graceful shutdown)
│   ├── bot.ts              сборка бота: middleware, команды, заглушки
│   ├── config.ts           чтение и валидация .env
│   ├── context.ts          расширенный контекст (ctx.dbUser)
│   ├── db/
│   │   ├── client.ts       подключение к Neon (drizzle + postgres.js)
│   │   ├── schema.ts       Drizzle-схема (зеркало 0001_init.sql)
│   │   └── check.ts        утилита проверки подключения
│   ├── middlewares/
│   │   └── auth.ts         loadUser — подгрузка пользователя по telegram_id
│   └── handlers/
│       ├── start.ts        /start — регистрация + ролевое меню
│       └── menus.ts        приветствия и меню по ролям
```

## Важно про схему БД

`src/db/schema.ts` — это **отражение** реальной схемы (`supabase/migrations/0001_init.sql`),
применённой вручную в Neon. Мы **не** генерируем миграции из Drizzle.
При изменении SQL-схемы обновляй `schema.ts` руками в соответствие.
