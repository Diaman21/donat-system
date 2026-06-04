// Временная диагностическая версия: ловим ошибку инициализации и
// возвращаем стектрейс в ответ, чтобы понять причину 500.
export default async function handler(req: any, res: any): Promise<void> {
  try {
    const { webhookCallback } = await import('grammy');
    const { createBot } = await import('../src/bot');
    const { env } = await import('../src/config');
    const bot = createBot();
    const cb = webhookCallback(bot, 'https', {
      secretToken: env.webhookSecret || undefined,
    });
    return cb(req, res);
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('DIAG ERROR:\n' + (e?.stack ?? String(e)));
  }
}
