import { drizzle } from 'drizzle-orm/postgres-js';
import { pg } from './pg.js';
import * as schema from './schema.js';

// Подключение к Neon — в pg.ts (там и prepare: false для пулера); здесь
// поверх него drizzle для типизированных запросов бота.
const queryClient = pg;

export const db = drizzle(queryClient, { schema });

/** Низкоуровневый клиент — для graceful shutdown (client.end()). */
export const client = queryClient;
