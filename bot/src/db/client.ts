import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config.js';
import * as schema from './schema.js';

// Подключение к Neon через pooler.
// prepare: false — обязательно для пулера (PgBouncer в transaction mode
// не поддерживает prepared statements).
const queryClient = postgres(env.databaseUrl, { prepare: false });

export const db = drizzle(queryClient, { schema });

/** Низкоуровневый клиент — для graceful shutdown (client.end()). */
export const client = queryClient;
