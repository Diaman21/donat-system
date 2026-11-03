import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Update } from 'grammy/types';
import { isIgnoredGroupUpdate, isAccountsTopicMessage } from './update-filter.js';

const S = { groupChatId: '-1004387053786', topicAccounts: '157' };
const GROUP = { id: -1004387053786, type: 'supergroup', title: 'g', is_forum: true };
const TIM = { id: 1, is_bot: false, first_name: 'Тим' };

function msg(extra: Record<string, unknown>): Update {
  return {
    update_id: 1,
    message: { message_id: 1, date: 0, chat: GROUP, from: TIM, ...extra },
  } as unknown as Update;
}

test('фильтр webhook: разговоры в группе отсекаются, нужное — нет', () => {
  // болтовня в теме «Заказы» и фото без подписи-команды — бот их и так игнорирует
  assert.equal(isIgnoredGroupUpdate(msg({ text: 'привет', message_thread_id: 4 }), S), true);
  assert.equal(isIgnoredGroupUpdate(msg({ photo: [], caption: 'x' }), S), true);
  // команда в группе — к боту
  assert.equal(isIgnoredGroupUpdate(msg({ text: '/order 2 банки', message_thread_id: 4 }), S), false);
  // аккаунт текстом в теме «👤 Аккаунты» — к боту
  assert.equal(isIgnoredGroupUpdate(msg({ text: 'login: x', message_thread_id: 157 }), S), false);
  // личка — всегда к боту
  const priv = { update_id: 2, message: { message_id: 1, date: 0, chat: { id: 1, type: 'private', first_name: 'Тим' }, from: TIM, text: 'привет' } };
  assert.equal(isIgnoredGroupUpdate(priv as unknown as Update, S), false);
  // кнопки и прочие типы апдейтов — решает бот
  assert.equal(isIgnoredGroupUpdate({ update_id: 3, callback_query: {} } as unknown as Update, S), false);
});

test('тема аккаунтов: не та группа, бот, тема не настроена — не аккаунт', () => {
  const m = (extra: Record<string, unknown>) => msg({ text: 'acc', message_thread_id: 157, ...extra }).message;
  assert.equal(isAccountsTopicMessage(m({}), S), true);
  assert.equal(isAccountsTopicMessage(m({ chat: { ...GROUP, id: -100999 } }), S), false);
  assert.equal(isAccountsTopicMessage(m({ from: { ...TIM, is_bot: true } }), S), false);
  assert.equal(isAccountsTopicMessage(m({ text: '/accounts' }), S), false);
  assert.equal(isAccountsTopicMessage(m({}), { ...S, topicAccounts: '' }), false);
});
