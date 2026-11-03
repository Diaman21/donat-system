import { timingSafeEqual } from 'node:crypto';
import type { Update } from 'grammy/types';
import { env } from '../src/config.js';
import { isIgnoredGroupUpdate } from '../src/update-filter.js';

// Точка входа для Vercel (serverless). Telegram присылает апдейты сюда.
//
// Экономия процессора (03.11.2026, общий лимит Vercel дошёл до 75%): сверху —
// только лёгкие config и update-filter. Апдейт читаем сами и сначала смотрим,
// нужен ли он боту: бот — админ группы и получает каждое сообщение во всех
// темах, а реагирует только на команды, кнопки и аккаунты в теме. Остальное —
// сразу 200, без загрузки бота (drizzle, обработчики) и без чтения сессии.
// Нужный апдейт отдаём grammY как раньше (webhookCallback: проверка секрета,
// bot.init, таймаут 10 с). Бот создаётся один раз на «тёплый» инстанс.

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

type Handle = (req: any, res: any, update: Update) => Promise<unknown>;
let handle: Promise<Handle> | undefined;

function loadBot(): Promise<Handle> {
  handle ??= (async () => {
    const [{ webhookCallback }, { createBot }] = await Promise.all([
      import('grammy'),
      import('../src/bot.js'),
    ]);
    // Адаптер — как grammY-шный 'https', но апдейт уже прочитан нами.
    const preRead = (req: any, res: any, update: Update) => {
      const h = req.headers[SECRET_HEADER];
      return {
        update: Promise.resolve(update),
        header: Array.isArray(h) ? h[0] : h,
        end: () => res.end(),
        respond: (json: string) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(json),
        unauthorized: () => res.writeHead(401).end('secret token is wrong'),
      };
    };
    return webhookCallback(createBot(), preRead, {
      secretToken: env.webhookSecret || undefined,
    }) as Handle;
  })().catch((err) => {
    handle = undefined; // не запоминать сбой загрузки — следующий апдейт попробует снова
    throw err;
  });
  return handle;
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req
      .on('data', (c: Buffer) => chunks.push(c))
      .once('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      .once('error', reject);
  });
}

function secretOk(req: any): boolean {
  if (!env.webhookSecret) return true;
  const h = req.headers[SECRET_HEADER];
  const got = Buffer.from(String(Array.isArray(h) ? h[0] : (h ?? '')));
  const want = Buffer.from(env.webhookSecret);
  return got.length === want.length && timingSafeEqual(got, want);
}

export default async function handler(req: any, res: any): Promise<void> {
  if (!secretOk(req)) {
    res.writeHead(401).end('secret token is wrong');
    return;
  }
  let update: Update;
  try {
    update = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400).end('bad update');
    return;
  }
  if (isIgnoredGroupUpdate(update, env)) {
    res.writeHead(200).end();
    return;
  }
  await (await loadBot())(req, res, update);
}
