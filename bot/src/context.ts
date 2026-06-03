import type { Context } from 'grammy';
import type { User } from './db/schema';

// Расширенный контекст grammY: добавляем текущего пользователя из БД.
// Заполняется в middleware loadUser (см. middlewares/auth.ts).
export interface AppContext extends Context {
  dbUser?: User;
}
