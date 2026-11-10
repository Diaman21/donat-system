import { InlineKeyboard, type Api } from 'grammy';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type { AppContext } from '../context.js';
import { env } from '../config.js';
import { inTopic } from '../group.js';
import { fmtMsk } from '../format.js';
import { requireOperator } from './start.js';
import { requirePrivate, cancelKb, CANCEL_CB } from './common.js';
import { mainMenu, menuFor } from './menus.js';
import { operatorMentions } from './team.js';
import { isAccountsTopicMessage } from '../update-filter.js';
import {
  readyPost,
  registeredPost,
  cancelledPost,
  stockAlert,
  stockLevel,
  stockAlertText,
  type PostAccount,
} from './accounts-calc.js';

// «👤 Аккаунты» (миграция 0020, 01.11.2026): оператор добавляет готовый аккаунт,
// бот публикует его в тему «👤 Аккаунты»; владелец отмечает «✅ Зарегистрирован»
// и телефон — пост в теме редактируется. Остался 1 готовый — тег оператору.
// Тексты и порог — accounts-calc.ts (с тестами), здесь база и кнопки.
//
// В callback'ах — человеческий номер аккаунта, а не uuid: «acc:ph:<num>:<phoneId>»
// с двумя uuid не влез бы в 64 байта Telegram.

export const ACC_CB = 'acc:';

interface AccRow extends PostAccount {
  id: string;
  status: string;
  topicMessageId: number | null;
}

async function readyCount(): Promise<number> {
  const r = (await db.execute(sql`select count(*)::int n from accounts where status = 'ready'`)) as unknown as {
    n: number;
  }[];
  return r[0]?.n ?? 0;
}

async function loadByNum(num: number): Promise<AccRow | null> {
  const r = (await db.execute(sql`
    select a.id::text id, a.num::int num, a.text, a.status, a.created_at, a.topic_message_id, u.username author
    from accounts a left join users u on u.id = a.created_by where a.num = ${num}`)) as unknown as {
    id: string;
    num: number;
    text: string;
    status: string;
    created_at: string;
    topic_message_id: string | number | null;
    author: string | null;
  }[];
  const x = r[0];
  if (!x) return null;
  return {
    id: x.id,
    num: Number(x.num),
    text: x.text,
    status: x.status,
    author: x.author,
    createdAt: new Date(x.created_at),
    topicMessageId: x.topic_message_id == null ? null : Number(x.topic_message_id),
  };
}

/** Строка для сводки 12:00. */
export async function accountsSummaryLines(): Promise<string[]> {
  const n = await readyCount();
  return [`👤 Аккаунтов готово к регистрации: ${n}${n <= 1 ? ' — пора сделать ещё' : ''}`];
}

// ---------- Пост в теме ----------

async function postToTopic(api: Api, text: string): Promise<number | null> {
  if (!env.groupChatId) return null;
  try {
    const m = await api.sendMessage(env.groupChatId, text, inTopic('accounts'));
    return m.message_id;
  } catch (err) {
    console.error('Пост об аккаунте не отправлен:', err);
    return null;
  }
}

/** Отредактировать пост аккаунта в теме; не вышло (удалили, старше 48 ч) — новым сообщением. */
async function updateTopicPost(api: Api, msgId: number | null, text: string): Promise<void> {
  if (!env.groupChatId) return;
  if (msgId) {
    try {
      await api.editMessageText(env.groupChatId, msgId, text);
      return;
    } catch (err) {
      console.error('Пост об аккаунте не отредактирован, шлю новым:', err);
    }
  }
  await postToTopic(api, text);
}

// Тегаем только оператора — аккаунты делает Тим (решение владельца 10.11.2026).
async function alertIfLow(api: Api, before: number, after: number): Promise<void> {
  const alert = stockAlert(before, after);
  if (!alert) return;
  await postToTopic(api, stockAlertText(alert, await operatorMentions()));
}

/**
 * Ежедневное напоминание (сводка 12:00, с 10.11.2026): пока готовых ≤1 —
 * каждый день тег оператору в теме «👤 Аккаунты». Добавили, стало 2+ — null.
 */
export async function accountsReminderText(): Promise<string | null> {
  const level = stockLevel(await readyCount());
  return level ? stockAlertText(level, await operatorMentions()) : null;
}

export async function remindAccounts(api: Api): Promise<void> {
  const text = await accountsReminderText();
  if (text) await postToTopic(api, text);
}

// ---------- Экран ----------

export async function showAccounts(ctx: AppContext): Promise<void> {
  if (!(await requireOperator(ctx))) return;
  const rows = (await db.execute(sql`
    select a.num::int num, a.text, a.created_at, u.username author
    from accounts a left join users u on u.id = a.created_by
    where a.status = 'ready' order by a.num`)) as unknown as {
    num: number;
    text: string;
    created_at: string;
    author: string | null;
  }[];
  const priv = ctx.chat?.type === 'private';
  const kb = new InlineKeyboard();
  const lines = [`👤 Аккаунты — готово к регистрации: ${rows.length}`, ''];
  for (const a of rows) {
    const t = a.text.length > 300 ? `${a.text.slice(0, 300)}…` : a.text;
    lines.push(`#${a.num} · @${a.author ?? '—'}, ${fmtMsk(new Date(a.created_at))}`, t, '');
    if (priv) {
      kb.text(`✅ Зарегистрирован #${a.num}`, `${ACC_CB}reg:${a.num}`).text(`🗑 #${a.num}`, `${ACC_CB}del:${a.num}`).row();
    }
  }
  if (rows.length === 0) lines.push('Готовых аккаунтов нет.');
  if (priv) kb.text('➕ Добавить аккаунт', `${ACC_CB}add`);
  await ctx.reply(lines.join('\n').trimEnd(), { reply_markup: priv ? kb : menuFor(ctx) });
}

// ---------- Добавить ----------

async function startAdd(ctx: AppContext): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  ctx.session.flow = { kind: 'account_text' };
  await ctx.reply('Пришли аккаунт одним сообщением — так, как он должен появиться в теме «👤 Аккаунты»:', {
    reply_markup: cancelKb(),
  });
}

export async function onAccountText(ctx: AppContext, text: string): Promise<void> {
  if (ctx.session.flow?.kind !== 'account_text') return;
  const body = text.trim();
  if (!body || body.length > 3000) {
    await ctx.reply('Нужен текст до 3000 символов. Попробуй ещё раз:', { reply_markup: cancelKb() });
    return;
  }
  const user = ctx.dbUser;
  if (!user) return;
  ctx.session.flow = undefined;
  const r = await createAccount(ctx.api, user.id, user.username, body);
  await ctx.reply(
    r === null
      ? '✅ Этот аккаунт уже добавлен — второй раз не записываю.'
      : `✅ Аккаунт #${r.num} добавлен${r.posted ? ' и опубликован в «👤 Аккаунты»' : ''}. Готово к регистрации: ${r.count}.`,
    { reply_markup: mainMenu() },
  );
}

/**
 * Записать аккаунт и опубликовать в теме. null — такой же текст от того же
 * человека уже записан за последние 10 минут: повторная доставка апдейта
 * Telegram или двойная отправка не создают второй аккаунт (дубль опаснее потери).
 */
async function createAccount(
  api: Api,
  userId: string,
  username: string | null,
  body: string,
): Promise<{ num: number; count: number; posted: boolean } | null> {
  const ins = (await db.execute(sql`
    insert into accounts (text, created_by)
    select ${body}, ${userId}::uuid
    where not exists (select 1 from accounts where created_by = ${userId}::uuid and text = ${body}
                        and created_at > now() - interval '10 minutes')
    returning id::text id, num::int num, created_at`)) as unknown as { id: string; num: number; created_at: string }[];
  const a = ins[0];
  if (!a) return null;
  const acc: PostAccount = { num: Number(a.num), text: body, author: username, createdAt: new Date(a.created_at) };
  const count = await readyCount();
  const msgId = await postToTopic(api, readyPost(acc, count));
  if (msgId) await db.execute(sql`update accounts set topic_message_id = ${msgId} where id = ${a.id}`);
  return { num: acc.num, count, posted: msgId !== null };
}

// ---------- Аккаунт сообщением прямо в теме (02.11.2026) ----------
//
// Оператору удобнее писать аккаунт прямо в тему «👤 Аккаунты», а бот в группе
// обычные сообщения не читает — и 02.11 так «потерялись» несколько аккаунтов:
// в теме они были, а в базе (и в списке «👤 Акки») — 0. Теперь сообщение
// оператора/модератора в ЭТОЙ теме = новый аккаунт: бот записывает его, ставит
// на место свой пост «👤 Аккаунт #N» (с номером и кнопками у владельца), а
// исходное сообщение удаляет, чтобы в теме не было двух копий.
// Одно сообщение — один аккаунт. Команды («/…») сюда не попадают.

/** Сообщение — текст в теме «👤 Аккаунты» нашей группы, не команда. */
// Определение одно — в update-filter.ts: им же webhook отсекает лишнее до загрузки бота.
export function isAccountsTopicText(ctx: AppContext): boolean {
  return isAccountsTopicMessage(ctx.message, env);
}

export async function onTopicAccount(ctx: AppContext): Promise<void> {
  const user = ctx.dbUser;
  // Посторонние в теме (если появятся) аккаунтов не добавляют — молча.
  if (!user || (user.role !== 'operator' && user.role !== 'moderator')) return;
  const m = ctx.message!;
  const body = m.text!.trim();
  const topic = inTopic('accounts');
  if (!body) return;
  if (body.length > 3000) {
    await ctx.reply('⚠️ Слишком длинно для одного аккаунта (до 3000 символов) — не записал.', {
      ...topic,
      reply_parameters: { message_id: m.message_id },
    });
    return;
  }
  const r = await createAccount(ctx.api, user.id, user.username, body);
  if (r === null) return; // повтор того же сообщения — уже записан
  if (!r.posted) return; // свой пост не вышел — исходное сообщение оставляем, чтобы не потерять
  try {
    await ctx.api.deleteMessage(m.chat.id, m.message_id);
  } catch (err) {
    // Нет права удалять — останутся оба сообщения, но аккаунт уже в базе.
    console.error('Не удалось удалить исходное сообщение аккаунта:', err);
  }
}

// ---------- Зарегистрировать ----------

async function askPhone(ctx: AppContext, num: number): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const a = await loadByNum(num);
  if (!a || a.status !== 'ready') {
    await ctx.reply(`Аккаунт #${num} уже не в списке готовых.`, { reply_markup: mainMenu() });
    return;
  }
  // Регистрируют на телефон из резерва (готовят) или уже работающий.
  const phonesList = (await db.execute(sql`
    select id::text id, imei_last4 imei, label, status from phones
    where status in ('prepared', 'active') order by status, created_at desc limit 12`)) as unknown as {
    id: string;
    imei: string;
    label: string | null;
    status: string;
  }[];
  const kb = new InlineKeyboard();
  for (const p of phonesList) {
    const mark = p.status === 'active' ? '📱' : '🧰';
    kb.text(`${mark} …${p.imei}${p.label ? ` ${p.label}` : ''}`, `${ACC_CB}ph:${num}:${p.id}`).row();
  }
  kb.text('Без телефона', `${ACC_CB}ph:${num}:none`).row().text('❌ Отмена', CANCEL_CB);
  await ctx.reply(`На какой телефон зарегистрирован аккаунт #${num}?\n(🧰 — подготовленные, 📱 — в работе)`, {
    reply_markup: kb,
  });
}

async function register(ctx: AppContext, num: number, phoneId: string | null): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const user = ctx.dbUser;
  if (!user) return;
  const before = await readyCount();
  // Только из «готов»: повторное нажатие или второй человек ничего не меняют.
  const upd = (await db.execute(sql`
    update accounts set status = 'registered', registered_by = ${user.id}, registered_at = now(),
      phone_id = ${phoneId}::uuid, updated_at = now()
    where num = ${num} and status = 'ready' returning registered_at`)) as unknown as { registered_at: string }[];
  if (upd.length === 0) {
    await ctx.reply(`Аккаунт #${num} уже отмечен.`, { reply_markup: mainMenu() });
    return;
  }
  const a = (await loadByNum(num))!;
  let phone: string | null = null;
  if (phoneId) {
    const p = (await db.execute(sql`select imei_last4 imei, label from phones where id = ${phoneId}::uuid`)) as unknown as {
      imei: string;
      label: string | null;
    }[];
    if (p[0]) phone = `…${p[0].imei}${p[0].label ? ` «${p[0].label}»` : ''}`;
  }
  await updateTopicPost(
    ctx.api,
    a.topicMessageId,
    registeredPost(a, { user: user.username, at: new Date(upd[0]!.registered_at), phone }),
  );
  const after = before - 1;
  await alertIfLow(ctx.api, before, after);
  await ctx.reply(`✅ Аккаунт #${num} зарегистрирован${phone ? ` на ${phone}` : ''}. Готовых осталось: ${after}.`, {
    reply_markup: mainMenu(),
  });
}

// ---------- Отменить ----------

async function askCancel(ctx: AppContext, num: number): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const a = await loadByNum(num);
  if (!a || a.status !== 'ready') {
    await ctx.reply(`Аккаунт #${num} уже не в списке готовых.`, { reply_markup: mainMenu() });
    return;
  }
  const kb = new InlineKeyboard().text('🗑 Да, отменить', `${ACC_CB}delc:${num}`).text('❌ Нет', CANCEL_CB);
  await ctx.reply(`Отменить аккаунт #${num}? Он уйдёт из списка готовых, пост в теме пометится «отменён».`, {
    reply_markup: kb,
  });
}

async function cancelAccount(ctx: AppContext, num: number): Promise<void> {
  if (!(await requirePrivate(ctx))) return;
  if (!(await requireOperator(ctx))) return;
  const before = await readyCount();
  const upd = (await db.execute(sql`
    update accounts set status = 'cancelled', updated_at = now()
    where num = ${num} and status = 'ready' returning id`)) as unknown as { id: string }[];
  if (upd.length === 0) {
    await ctx.reply(`Аккаунт #${num} уже не в списке готовых.`, { reply_markup: mainMenu() });
    return;
  }
  const a = (await loadByNum(num))!;
  await updateTopicPost(ctx.api, a.topicMessageId, cancelledPost(a, ctx.dbUser?.username ?? null, new Date()));
  await alertIfLow(ctx.api, before, before - 1);
  await ctx.reply(`🗑 Аккаунт #${num} отменён. Готовых осталось: ${before - 1}.`, { reply_markup: mainMenu() });
}

/** Аккаунты, зарегистрированные на телефон, — для «📜 История». */
export async function accountsOfPhone(phoneId: string): Promise<number[]> {
  const r = (await db.execute(sql`
    select num::int num from accounts where phone_id = ${phoneId}::uuid and status = 'registered' order by num`)) as unknown as {
    num: number;
  }[];
  return r.map((x) => Number(x.num));
}

/** Роутинг callback'ов «acc:…». */
export async function onAccountsCallback(ctx: AppContext, rest: string): Promise<void> {
  if (rest === 'add') return startAdd(ctx);
  if (rest === 'list') return showAccounts(ctx);
  const [action, numStr, phone] = rest.split(':');
  const num = Number(numStr);
  if (!Number.isInteger(num)) return;
  if (action === 'reg') return askPhone(ctx, num);
  if (action === 'ph') return register(ctx, num, phone && phone !== 'none' ? phone : null);
  if (action === 'del') return askCancel(ctx, num);
  if (action === 'delc') return cancelAccount(ctx, num);
}
