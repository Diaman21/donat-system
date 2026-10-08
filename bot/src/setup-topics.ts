import { Bot, GrammyError } from 'grammy';
import { env } from './config.js';

// Темы в группе «Pattern_analyst 🧮»: «📊 Сводки», «🗄 Бэкапы», «📥 Заказы».
//
//   npx tsx src/setup-topics.ts           — только проверка, ничего не создаёт
//   npx tsx src/setup-topics.ts --create  — создать три темы и вывести их номера
//
// ⚠️ ЧТО СДЕЛАТЬ ВЛАДЕЛЬЦУ ДО ЗАПУСКА (в Telegram, в настройках группы):
//   1. Включить «Темы» (Topics). Обычная группа при этом становится
//      СУПЕРГРУППОЙ, и у неё МЕНЯЕТСЯ ID. Скрипт найдёт новый сам.
//   2. Сделать бота администратором с правом «Управление темами».
// ПОСЛЕ ЗАПУСКА — в Vercel → Settings → Environment Variables:
//   TELEGRAM_GROUP_ID (если сменился), TELEGRAM_TOPIC_SUMMARY,
//   TELEGRAM_TOPIC_BACKUP, TELEGRAM_TOPIC_ORDERS → Redeploy.
//   Пока переменные не заданы, бот пишет в группу как раньше.
// ⚠️ Повторный запуск с --create создаст ВТОРОЙ комплект тем — не надо.

const TOPICS = [
  { env: 'TELEGRAM_TOPIC_SUMMARY', name: '📊 Сводки' },
  { env: 'TELEGRAM_TOPIC_BACKUP', name: '🗄 Бэкапы' },
  { env: 'TELEGRAM_TOPIC_ORDERS', name: '📥 Заказы' },
] as const;

async function main(): Promise<void> {
  const create = process.argv.includes('--create');
  const bot = new Bot(env.botToken);
  let chatId: number | string = env.groupChatId;

  // Обычная группа после включения тем становится супергруппой с новым ID.
  // Telegram в ответ на старый ID сообщает новый — ловим и переходим на него.
  let chat;
  try {
    chat = await bot.api.getChat(chatId);
  } catch (e) {
    const moved = e instanceof GrammyError ? e.parameters?.migrate_to_chat_id : undefined;
    if (!moved) throw e;
    console.log(`⚠️ Группа стала супергруппой: новый ID ${moved}`);
    console.log(`   → поменяйте TELEGRAM_GROUP_ID на ${moved} в Vercel и в .env`);
    chatId = moved;
    chat = await bot.api.getChat(chatId);
  }

  const me = await bot.api.getMe();
  const member = await bot.api.getChatMember(chatId, me.id);
  const isForum = 'is_forum' in chat && chat.is_forum === true;
  const canTopics = member.status === 'creator' || (member.status === 'administrator' && member.can_manage_topics === true);

  console.log(`Группа: ${'title' in chat ? chat.title : chatId} (${chat.type}, ID ${chatId})`);
  console.log(`Темы включены: ${isForum ? 'да' : 'НЕТ'} · бот может управлять темами: ${canTopics ? 'да' : 'НЕТ'}`);
  if (!isForum || !canTopics) {
    console.log('\nСначала в настройках группы:');
    if (!isForum) console.log('  • включите «Темы» (группа станет супергруппой — ID сменится)');
    if (!canTopics) console.log('  • сделайте бота администратором с правом «Управление темами»');
    console.log('Затем запустите скрипт снова.');
    return;
  }
  if (!create) {
    console.log('\nВсё готово. Создать темы: npx tsx src/setup-topics.ts --create');
    return;
  }

  console.log('\nСоздаю темы. Пропишите в Vercel → Environment Variables (и в .env):');
  if (String(chatId) !== String(env.groupChatId)) console.log(`TELEGRAM_GROUP_ID=${chatId}`);
  for (const t of TOPICS) {
    const topic = await bot.api.createForumTopic(chatId, t.name);
    console.log(`${t.env}=${topic.message_thread_id}`);
  }
  console.log('\nПотом Redeploy в Vercel. До этого бот пишет в группу как раньше.');
}

main().catch((err) => {
  console.error('Ошибка настройки тем:', err);
  process.exit(1);
});
